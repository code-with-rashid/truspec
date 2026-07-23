use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const CONFIG_FILE: &str = "config.json";
const LAST_DIR_KEY: &str = "last_dir";

/// The directory opened last time, if any — persisted via `tauri-plugin-store` under the OS's
/// app-config directory, so a relaunch doesn't ask for a folder again.
pub fn get_last_dir(app: &AppHandle) -> Option<String> {
    let store = match app.store(CONFIG_FILE) {
        Ok(s) => s,
        Err(e) => {
            log::info!("config: app.store({CONFIG_FILE}) failed: {e}");
            return None;
        }
    };
    let value = store.get(LAST_DIR_KEY);
    log::info!("config: last_dir raw value={value:?}");
    value?.as_str().map(|s| s.to_string())
}

pub fn set_last_dir(app: &AppHandle, dir: &str) {
    if let Ok(store) = app.store(CONFIG_FILE) {
        store.set(LAST_DIR_KEY, serde_json::json!(dir));
        let _ = store.save();
    }
}
