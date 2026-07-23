use std::sync::Mutex;

use serde::Deserialize;
use tauri::{path::BaseDirectory, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

use crate::config;

/// Managed app state (`app.manage(Mutex::new(SidecarState::default()))` in `lib.rs`) holding the
/// currently-running sidecar child, so the close/exit handlers can kill it.
#[derive(Default)]
pub struct SidecarState {
    child: Option<CommandChild>,
}

#[derive(Deserialize)]
struct Ready {
    url: String,
}

/// The single entry point for "get a collection directory, (re)spawn its sidecar, point the
/// window at it" — used both at startup (persisted directory, or a folder picker if none yet)
/// and from the "File > Open Collection…" menu item (`force_picker = true`).
pub fn open_collection_flow(app: AppHandle, force_picker: bool) {
    let persisted = if force_picker { None } else { config::get_last_dir(&app) };
    match persisted {
        Some(dir) => start(app, dir),
        None => {
            app.dialog().file().pick_folder(move |folder| {
                let Some(path) = folder else {
                    return; // user cancelled the picker — leave things as they are
                };
                let Ok(dir_path) = path.into_path() else {
                    return;
                };
                let dir = dir_path.to_string_lossy().to_string();
                config::set_last_dir(&app, &dir);
                start(app, dir);
            });
        }
    }
}

fn start(app: AppHandle, dir: String) {
    kill_sidecar(&app);

    let script = app
        .path()
        .resolve("server/cli-entry.cjs", BaseDirectory::Resource)
        .expect("bundled sidecar script missing from app resources");
    let client_dir = app
        .path()
        .resolve("client", BaseDirectory::Resource)
        .expect("bundled client assets missing from app resources");

    let args: Vec<String> = vec![
        script.to_string_lossy().to_string(),
        "--dir".to_string(),
        dir,
        "--client-dir".to_string(),
        client_dir.to_string_lossy().to_string(),
        "--port".to_string(),
        "0".to_string(),
    ];

    let (mut rx, child) = app
        .shell()
        .sidecar("node")
        .expect("node sidecar binary not declared in bundle.externalBin")
        .args(args)
        .spawn()
        .expect("failed to spawn the desktop sidecar");

    app.state::<Mutex<SidecarState>>().lock().unwrap().child = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
                if let Ok(ready) = serde_json::from_slice::<Ready>(&line) {
                    navigate_to(&app_handle, &ready.url);
                }
                // keep draining rx after the ready line so the sidecar's stdout pipe never backs up
            }
        }
    });
}

fn navigate_to(app: &AppHandle, url: &str) {
    let Ok(url) = url.parse() else { return };
    match app.get_webview_window("main") {
        Some(w) => {
            let _ = w.navigate(url);
        }
        None => {
            let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("TruSpec")
                .inner_size(1200.0, 800.0)
                .build();
        }
    }
}

/// Kill the running sidecar, if any — called on window close AND as a `RunEvent::Exit` backstop
/// (window-close events aren't guaranteed to fire on every force-quit path).
pub fn kill_sidecar(app: &AppHandle) {
    if let Some(child) = app.state::<Mutex<SidecarState>>().lock().unwrap().child.take() {
        let _ = child.kill();
    }
}
