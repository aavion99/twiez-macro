use crate::engine::MacroEngine;
use crate::settings::{ActivationMode, MacroSettings};
use crate::discord::DiscordClient;
use parking_lot::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use tauri::AppHandle;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_F6, VK_F7, VK_F8, VK_F9, VK_SPACE, VK_XBUTTON1, VK_XBUTTON2,
};

#[derive(Clone)]
pub struct HotkeyController {
    listener: Arc<Mutex<Option<JoinHandle<()>>>>,
    running: Arc<AtomicBool>,
    discord: Option<Arc<DiscordClient>>,
}

impl HotkeyController {
    pub fn new() -> Self {
        Self {
            listener: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            discord: None,
        }
    }

    pub fn set_discord(&mut self, discord: Arc<DiscordClient>) {
        self.discord = Some(discord);
    }

    pub fn register(
        &self,
        app: AppHandle,
        engine: Arc<MacroEngine>,
        settings: Arc<Mutex<MacroSettings>>,
        key: Option<String>,
    ) -> Result<(), String> {
        let mut listener = self.listener.lock();
        
        // Stop previous thread
        self.running.store(false, Ordering::SeqCst);
        if let Some(prev) = listener.take() {
            let _ = prev.join();
        }

        let key_string = key.unwrap_or_else(|| "F6".into());
        let vk = parse_key(&key_string).unwrap_or(VK_F6.0 as u32);
        
        let running = self.running.clone();
        running.store(true, Ordering::SeqCst);
        
        let discord_clone = self.discord.clone();

        let handle = thread::Builder::new()
            .name("hotkey-listener".into())
            .spawn(move || {
                let mut was_down = false;
                
                while running.load(Ordering::SeqCst) {
                    // Start: Check if armed!
                    if !engine.is_armed() {
                        thread::sleep(std::time::Duration::from_millis(50));
                        continue;
                    }
                    
                    let is_down = unsafe { (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0 };
                    
                    if is_down && !was_down {
                        // Key Pressed (Transition from Up -> Down)
                        let state_snapshot = settings.lock().clone();
                        
                        match state_snapshot.activation_mode {
                            ActivationMode::Toggle => {
                                let _ = engine.toggle_with_settings(app.clone(), state_snapshot.clone());
                                // Update Discord based on engine status
                                if let Some(ref discord) = discord_clone {
                                    if engine.status().running {
                                        discord.set_active(state_snapshot.max_cps);
                                    } else {
                                        discord.set_idle();
                                    }
                                }
                            }
                            ActivationMode::Hold => {
                                let _ = engine.start(app.clone(), state_snapshot.clone());
                                if let Some(ref discord) = discord_clone {
                                    discord.set_active(state_snapshot.max_cps);
                                }
                            }
                        }
                    } else if !is_down && was_down {
                        // Key Released (Transition from Down -> Up)
                        let state_snapshot = settings.lock().clone();
                        if let ActivationMode::Hold = state_snapshot.activation_mode {
                            let _ = engine.stop(app.clone());
                            if let Some(ref discord) = discord_clone {
                                discord.set_idle();
                            }
                        }
                    }
                    
                    was_down = is_down;
                    thread::sleep(std::time::Duration::from_millis(15));
                }
            })
            .map_err(|e| e.to_string())?;

        *listener = Some(handle);
        Ok(())
    }
}

fn parse_key(key: &str) -> Option<u32> {
    match key.to_uppercase().as_str() {
        // Function keys
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(VK_F6.0 as u32),
        "F7" => Some(VK_F7.0 as u32),
        "F8" => Some(VK_F8.0 as u32),
        "F9" => Some(VK_F9.0 as u32),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        // Special keys
        "SPACE" | " " => Some(VK_SPACE.0 as u32),
        "XBUTTON1" => Some(VK_XBUTTON1.0 as u32),
        "XBUTTON2" => Some(VK_XBUTTON2.0 as u32),
        // Letter keys (A-Z)
        "A" => Some(0x41),
        "B" => Some(0x42),
        "C" => Some(0x43),
        "D" => Some(0x44),
        "E" => Some(0x45),
        "F" => Some(0x46),
        "G" => Some(0x47),
        "H" => Some(0x48),
        "I" => Some(0x49),
        "J" => Some(0x4A),
        "K" => Some(0x4B),
        "L" => Some(0x4C),
        "M" => Some(0x4D),
        "N" => Some(0x4E),
        "O" => Some(0x4F),
        "P" => Some(0x50),
        "Q" => Some(0x51),
        "R" => Some(0x52),
        "S" => Some(0x53),
        "T" => Some(0x54),
        "U" => Some(0x55),
        "V" => Some(0x56),
        "W" => Some(0x57),
        "X" => Some(0x58),
        "Y" => Some(0x59),
        "Z" => Some(0x5A),
        // Number keys
        "0" => Some(0x30),
        "1" => Some(0x31),
        "2" => Some(0x32),
        "3" => Some(0x33),
        "4" => Some(0x34),
        "5" => Some(0x35),
        "6" => Some(0x36),
        "7" => Some(0x37),
        "8" => Some(0x38),
        "9" => Some(0x39),
        _ => None,
    }
}


