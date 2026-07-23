mod config;
mod menu;
mod sidecar;

use std::sync::Mutex;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.manage(Mutex::new(sidecar::SidecarState::default()));
            menu::build(app.handle())?;
            sidecar::open_collection_flow(app.handle().clone(), false);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the tauri application")
        .run(|app_handle, event| match event {
            // Window-close and true process exit are both handled here (rather than a
            // per-window hook) so there's one place that guarantees the sidecar never
            // outlives the app — window-close events aren't reliably fired on every
            // force-quit path, hence the RunEvent::Exit backstop.
            RunEvent::WindowEvent { event: WindowEvent::CloseRequested { .. }, .. } => {
                sidecar::kill_sidecar(app_handle);
            }
            RunEvent::Exit => {
                sidecar::kill_sidecar(app_handle);
            }
            _ => {}
        });
}
