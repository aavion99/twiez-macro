use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

// Placeholder ID - User needs to replace this!
const CLIENT_ID: &str = "1463867993909104671"; 

pub struct DiscordClient {
    client: Arc<Mutex<Option<DiscordIpcClient>>>,
}

impl DiscordClient {
    pub fn new() -> Self {
        DiscordClient {
            client: Arc::new(Mutex::new(None)),
        }
    }

    pub fn connect(&self) -> Result<(), String> {
        let mut client_guard = self.client.lock().unwrap();
        if client_guard.is_some() {
            return Ok(());
        }

        let mut client = DiscordIpcClient::new(CLIENT_ID);

        match client.connect() {
            Ok(_) => {
                *client_guard = Some(client);
                Ok(())
            }
            Err(e) => Err(format!("Failed to connect to Discord: {}", e)),
        }
    }

    pub fn disconnect(&self) {
        let mut client_guard = self.client.lock().unwrap();
        if let Some(mut client) = client_guard.take() {
            let _ = client.clear_activity();
            let _ = client.close();
        }
    }

    pub fn set_idle(&self) {
        let mut client_guard = self.client.lock().unwrap();
        if let Some(client) = client_guard.as_mut() {
            let payload = activity::Activity::new()
                .details("Idle");
            
            let _ = client.set_activity(payload);
        }
    }

    pub fn set_active(&self, cps: u32) {
        let mut client_guard = self.client.lock().unwrap();
        if let Some(client) = client_guard.as_mut() {
            let start = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let details_text = format!("Clicking at {} CPS", cps);
            let payload = activity::Activity::new()
                .details(&details_text)
                .timestamps(activity::Timestamps::new().start(start));

            let _ = client.set_activity(payload);
        }
    }
}
