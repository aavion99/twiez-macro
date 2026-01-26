use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MacroButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ActivationMode {
    Hold,
    Toggle,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MacroSettings {
    pub min_cps: u32,
    pub max_cps: u32,
    pub button: MacroButton,
    pub middle_button: bool,
    pub keyboard_enabled: bool,
    pub keyboard_key: Option<u16>,
    pub randomization: f32,
    pub safe_mode: bool,
    pub tray_mode: bool,
    pub startup_on_boot: bool,
    pub hotkey: Option<String>,
    pub activation_mode: ActivationMode,
    pub activation_key: String,
    pub click_limit_enabled: bool,
    pub click_limit: u32,
    pub duty_cycle: f32,
    pub randomize_cps: bool,
    pub discord_enabled: bool,
    pub language: String,
}

impl Default for MacroSettings {
    fn default() -> Self {
        Self {
            min_cps: 8,
            max_cps: 12,
            button: MacroButton::Left,
            middle_button: false,
            keyboard_enabled: false,
            keyboard_key: None,
            randomization: 0.18,
            safe_mode: true,
            tray_mode: true,
            startup_on_boot: false,
            hotkey: Some("F6".into()),
            activation_mode: ActivationMode::Toggle,
            activation_key: "F6".into(),
            click_limit_enabled: false,
            click_limit: 0,
            duty_cycle: 0.5,
            randomize_cps: false,
            discord_enabled: false,
            language: "en".into(),
        }
    }
}

pub fn load_settings(base_dir: &Path) -> io::Result<Option<MacroSettings>> {
    let path = settings_file(base_dir);
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path)?;
    let parsed: MacroSettings = serde_json::from_str(&data).unwrap_or_default();
    Ok(Some(parsed))
}

pub fn persist_settings(base_dir: &Path, settings: &MacroSettings) -> io::Result<()> {
    if !base_dir.exists() {
        fs::create_dir_all(base_dir)?;
    }
    let path = settings_file(base_dir);
    let data = serde_json::to_string_pretty(settings)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    fs::write(path, data)?;
    Ok(())
}

fn settings_file(base_dir: &Path) -> PathBuf {
    base_dir.join("settings.json")
}

