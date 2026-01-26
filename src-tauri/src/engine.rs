use crate::input::send_mouse_click;
use crate::settings::{MacroButton, MacroSettings};
use parking_lot::Mutex;
use rand::Rng;
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

#[derive(Debug, Clone, serde::Serialize)]
pub struct MacroStatus {
    pub running: bool,
    pub armed: bool,
    pub min_cps: u32,
    pub max_cps: u32,
    pub button: MacroButton,
    pub keyboard_enabled: bool,
    pub randomization: f32,
    pub click_limit_enabled: bool,
    pub click_limit: u32,
    pub duty_cycle: f32,
}

impl MacroStatus {
    pub fn from_settings(running: bool, settings: &MacroSettings) -> Self {
        Self {
            running,
            armed: false, // Default
            min_cps: settings.min_cps,
            max_cps: settings.max_cps,
            button: settings.button.clone(),
            keyboard_enabled: settings.keyboard_enabled,
            randomization: settings.randomization,
            click_limit_enabled: settings.click_limit_enabled,
            click_limit: settings.click_limit,
            duty_cycle: settings.duty_cycle,
        }
    }
}

#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum EngineError {
    #[error("macro already running")]
    AlreadyRunning,
    #[error("macro not running")]
    NotRunning,
    #[error("input dispatch failed: {0}")]
    Input(String),
    #[error("thread error: {0}")]
    Thread(String),
}

struct Inner {
    running: bool,
    armed: bool,
    stop_tx: Option<Sender<()>>,
    worker: Option<JoinHandle<()>>,
    last_status: MacroStatus,
}

#[derive(Clone)]
pub struct MacroEngine {
    inner: std::sync::Arc<Mutex<Inner>>,
}

impl MacroEngine {
    pub fn new() -> Self {
        Self {
            inner: std::sync::Arc::new(Mutex::new(Inner {
                running: false,
                armed: false,
                stop_tx: None,
                worker: None,
                last_status: MacroStatus {
                    running: false,
                    armed: false,
                    min_cps: 8,
                    max_cps: 12,
                    button: MacroButton::Left,
                    keyboard_enabled: false,
                    randomization: 0.18,
                    click_limit_enabled: false,
                    click_limit: 0,
                    duty_cycle: 0.5,
                },
            })),
        }
    }

    pub fn status(&self) -> MacroStatus {
        let mut status = self.inner.lock().last_status.clone();
        status.running = self.inner.lock().running;
        status.armed = self.inner.lock().armed;
        status
    }

    pub fn is_armed(&self) -> bool {
        self.inner.lock().armed
    }

    pub fn arm(&self) -> MacroStatus {
        let mut inner = self.inner.lock();
        inner.armed = true;
        inner.last_status.armed = true;
        inner.last_status.clone()
    }

    pub fn disarm(&self) -> MacroStatus {
        let mut inner = self.inner.lock();
        inner.armed = false;
        inner.last_status.armed = false;
        inner.last_status.clone()
    }

    pub fn start(&self, app: AppHandle, settings: MacroSettings) -> Result<MacroStatus, EngineError> {
        {
            let inner = self.inner.lock();
            if inner.running {
                return Err(EngineError::AlreadyRunning);
            }
        }

        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let engine_handle = self.clone();
        let settings_clone = settings.clone();
        let app_for_thread = app.clone();
        let click_limit = settings.click_limit;
        let limit_enabled = settings.click_limit_enabled;

        let handle = thread::Builder::new()
            .name("macro-engine".into())
            .spawn(move || {
                let mut rng = rand::thread_rng();
                let mut last_emit = std::time::Instant::now();
                let mut click_count: u32 = 0;
                let mut loop_start = std::time::Instant::now();

                loop {
                    if stop_rx.try_recv().is_ok() {
                        break;
                    }


                    // mouse click
                    if let Err(err) = send_mouse_click(&settings_clone.button) {
                        eprintln!("send input failed: {err}");
                    }
                    click_count = click_count.saturating_add(1);
                    if limit_enabled && click_limit > 0 && click_count >= click_limit {
                        break;
                    }

                    // emit status every ~1s to avoid chatty channel
                    if last_emit.elapsed() > Duration::from_millis(900) {
                        let status = MacroStatus::from_settings(true, &settings_clone);
                        let _ = app_for_thread.emit("macro://status", status);
                        last_emit = std::time::Instant::now();
                    }

                    let cps = if settings_clone.randomize_cps {
                        rng.gen_range(settings_clone.min_cps..=settings_clone.max_cps).max(1)
                    } else {
                        settings_clone.max_cps.max(1)
                    };
                    let base_ms = 1000.0 / cps as f64;
                    let jitter_ratio = settings_clone.randomization.clamp(0.0, 0.45) as f64;
                    let jitter_ms = rng.gen_range(-(base_ms * jitter_ratio)..=(base_ms * jitter_ratio));
                    let cycle_time = (base_ms + jitter_ms).max(1.0);
                    
                    // High-precision timing: use Instant instead of thread::sleep
                    let target_time = loop_start + Duration::from_micros((cycle_time * 1000.0) as u64);
                    while std::time::Instant::now() < target_time {
                        std::hint::spin_loop();
                    }
                    loop_start = std::time::Instant::now();
                }

                let status = MacroStatus::from_settings(false, &settings_clone);
                let _ = app_for_thread.emit("macro://status", status);
                engine_handle.finish();
            })
            .map_err(|e| EngineError::Thread(e.to_string()))?;

        let status = MacroStatus::from_settings(true, &settings);
        {
            let mut inner = self.inner.lock();
            inner.running = true;
            inner.stop_tx = Some(stop_tx);
            inner.worker = Some(handle);
            inner.last_status = status.clone();
        }

        self.emit_status(app, &status);
        Ok(status)
    }

    pub fn stop(&self, app: AppHandle) -> Result<MacroStatus, EngineError> {
        let worker = {
            let mut inner = self.inner.lock();
            if !inner.running {
                return Err(EngineError::NotRunning);
            }
            if let Some(tx) = inner.stop_tx.take() {
                let _ = tx.send(());
            }
            inner.running = false;
            inner.last_status.running = false;
            inner.worker.take()
        };

        if let Some(handle) = worker {
            let _ = handle.join();
        }

        let status = self.status();
        self.emit_status(app, &status);
        Ok(status)
    }

    pub fn toggle_with_settings(&self, app: AppHandle, settings: MacroSettings) -> Result<(), EngineError> {
        if self.status().running {
            let _ = self.stop(app);
        } else {
            let _ = self.start(app, settings);
        }
        Ok(())
    }

    fn emit_status(&self, app: AppHandle, status: &MacroStatus) {
        let _ = app.emit("macro://status", status.clone());
    }

    fn finish(&self) {
        let mut inner = self.inner.lock();
        inner.running = false;
        inner.stop_tx = None;
        inner.worker = None;
    }
}


