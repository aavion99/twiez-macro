#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod hotkey;
mod input;
mod settings;
mod discord;

use crate::engine::{MacroEngine, MacroStatus};
use crate::hotkey::HotkeyController;
use crate::settings::{load_settings, persist_settings, MacroSettings};
use crate::discord::DiscordClient;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuEvent, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use thiserror::Error;

#[derive(Debug, Error)]
#[allow(dead_code)]
enum AppError {
    #[error("invalid input: {0}")]
    Validation(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("engine error: {0}")]
    Engine(String),
    #[error("system error: {0}")]
    System(String),
}

#[derive(Clone)]
struct AppState {
    engine: Arc<MacroEngine>,
    settings: Arc<Mutex<MacroSettings>>,
    hotkey: Arc<HotkeyController>,
    discord: Arc<DiscordClient>,
}

impl AppState {
    fn new(settings: MacroSettings) -> Self {
        let discord = Arc::new(DiscordClient::new());
        if settings.discord_enabled {
             let _ = discord.connect();
             discord.set_idle();
        }
        
        let mut hotkey = HotkeyController::new();
        hotkey.set_discord(discord.clone());
        
        Self {
            engine: Arc::new(MacroEngine::new()),
            settings: Arc::new(Mutex::new(settings)),
            hotkey: Arc::new(hotkey),
            discord,
        }
    }
}

#[tauri::command]
fn load_persisted_settings(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<MacroSettings, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    match load_settings(&base) {
        Ok(Some(saved)) => {
            *state.settings.lock() = saved.clone();
            let _ = state.hotkey.register(
                app.clone(),
                state.engine.clone(),
                state.settings.clone(),
                saved.hotkey.clone(),
            );
            Ok(saved)
        }
        Ok(None) => {
            Ok(state.settings.lock().clone())
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
fn update_settings(app: tauri::AppHandle, state: tauri::State<AppState>, payload: MacroSettings) -> Result<MacroSettings, String> {
    let mut settings = state.settings.lock();
    if payload.min_cps == 0 || payload.max_cps == 0 {
        return Err(AppError::Validation("CPS cannot be zero".into()).to_string());
    }
    if payload.min_cps > payload.max_cps {
        return Err(AppError::Validation("Min CPS cannot exceed Max CPS".into()).to_string());
    }
    // Check for discord toggle
    if settings.discord_enabled != payload.discord_enabled {
        if payload.discord_enabled {
            let _ = state.discord.connect();
             state.discord.set_idle();
        } else {
            state.discord.disconnect();
        }
    }
    
    *settings = payload.clone();
    
    // Async file write to prevent blocking UI
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let settings_clone = payload.clone();
    std::thread::spawn(move || {
        if let Err(err) = persist_settings(&base, &settings_clone) {
            eprintln!("settings save failed: {err}");
        }
    });
    
    // Async hotkey registration to prevent blocking UI
    let app_clone = app.clone();
    let engine_clone = state.engine.clone();
    let settings_arc = state.settings.clone();
    let hotkey_clone = state.hotkey.clone();
    let hotkey_str = payload.hotkey.clone();
    std::thread::spawn(move || {
        let _ = hotkey_clone.register(
            app_clone,
            engine_clone,
            settings_arc,
            hotkey_str,
        );
    });
    
    Ok(payload)
}

#[tauri::command]
fn start_macro(_app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<MacroStatus, String> {
    let settings = state.settings.lock().clone();
    println!("start_macro called (ARMING ONLY). Mode: {:?}", settings.activation_mode);
    
    // Just ARM it. The hotkey listener will start the engine if needed.
    match state.engine.arm() {
        status => {
            // Update Discord if armed/running involved? 
            // Actually start_macro just arms it. The user has to press the key.
            // But we can say "Ready" or "Idle"
            Ok(status)
        }
    }
}

use crate::engine::EngineError;

#[tauri::command]
fn stop_macro(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<MacroStatus, String> {
    // Disarm first so hotkeys stop working
    let _ = state.engine.disarm();
    
    state.discord.set_idle();

    // Try to stop
    match state.engine.stop(app.clone()) {
        Ok(status) => Ok(status),
        Err(EngineError::NotRunning) => Ok(state.engine.status()), // It was just armed, not running. This is success.
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn get_status(state: tauri::State<AppState>) -> Result<MacroStatus, String> {
    Ok(state.engine.status())
}

#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, state: tauri::State<AppState>, key: Option<String>) -> Result<(), String> {
    state
        .hotkey
        .register(app, state.engine.clone(), state.settings.clone(), key)
        .map_err(|e| e.to_string())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let initial_settings = MacroSettings::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(AppState::new(initial_settings))
        .invoke_handler(tauri::generate_handler![
            load_persisted_settings,
            update_settings,
            start_macro,
            stop_macro,
            get_status,
            set_hotkey,
            open_url
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                state.discord.disconnect();
            }
        })
        .setup(|app| {
            let state = app.state::<AppState>();
            // auto-register default hotkey if configured
            let hotkey = state.settings.lock().hotkey.clone();
            let _ = state
                .hotkey
                .register(app.handle().clone(), state.engine.clone(), state.settings.clone(), hotkey);

            // tray
            let show = MenuItemBuilder::with_id("show", "Show").build(app)?;
            let toggle = MenuItemBuilder::with_id("toggle", "Start / Stop").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show)
                .item(&toggle)
                .separator()
                .item(&quit)
                .build()?;

            TrayIconBuilder::with_id("twiez-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Twiez Macro")
                .menu(&menu)
                .on_menu_event(|app: &tauri::AppHandle, event: MenuEvent| {
                    handle_tray_menu(app, event.id().as_ref())
                })
                .on_tray_icon_event(|tray, _event| {
                    let app = tray.app_handle();
                    show_main_window(&app);
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())?;

    Ok(())
}

fn handle_tray_menu(app: &tauri::AppHandle, id: &str) {
    match id {
        "quit" => {
            let state = app.state::<AppState>();
            state.discord.disconnect();
            std::process::exit(0);
        }
        "show" => show_main_window(app),
        "toggle" => {
            let state = app.state::<AppState>();
            let settings = state.settings.lock().clone();
            let _ = state.engine.toggle_with_settings(app.clone(), settings);
        }
        _ => {}
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    println!("Opening URL: {}", url);
    match open::that(&url) {
        Ok(_) => {
            println!("URL opened successfully");
            Ok(())
        }
        Err(e) => {
            eprintln!("Failed to open URL: {}", e);
            Err(e.to_string())
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

