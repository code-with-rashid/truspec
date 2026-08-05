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
    log::info!("sidecar: open_collection_flow force_picker={force_picker} persisted={persisted:?}");
    match persisted {
        Some(dir) => start(app, dir),
        None => {
            let app_for_closure = app.clone();
            app.dialog().file().pick_folder(move |folder| {
                log::info!("sidecar: folder picker result={folder:?}");
                let Some(path) = folder else {
                    return; // user cancelled the picker — leave things as they are
                };
                let Ok(dir_path) = path.into_path() else {
                    return;
                };
                let dir = dir_path.to_string_lossy().to_string();
                config::set_last_dir(&app_for_closure, &dir);
                start(app_for_closure, dir);
            });
        }
    }
}

/// "File > New Collection…" — unlike "Open Collection", the picked folder is scaffolded with a
/// minimal `folder.tspec.yaml` + `environments/local.env.yaml` (if not already present) before
/// switching to it, so a brand-new empty directory is immediately a usable collection.
pub fn new_collection_flow(app: AppHandle) {
    let app_for_closure = app.clone();
    app.dialog().file().pick_folder(move |folder| {
        log::info!("sidecar: new-collection folder picker result={folder:?}");
        let Some(path) = folder else {
            return; // user cancelled the picker
        };
        let Ok(dir_path) = path.into_path() else {
            return;
        };
        if let Err(e) = scaffold_collection(&dir_path) {
            log::info!("sidecar: failed to scaffold new collection at {dir_path:?}: {e}");
            return;
        }
        let dir = dir_path.to_string_lossy().to_string();
        config::set_last_dir(&app_for_closure, &dir);
        start(app_for_closure, dir);
    });
}

/// Writes just enough for the directory to parse as a collection — `folder.tspec.yaml` (schema
/// version + a `name` derived from the directory) and a starter `local` environment. Leaves any
/// existing files alone (an already-populated folder picked via "New Collection" isn't touched).
fn scaffold_collection(dir: &std::path::Path) -> std::io::Result<()> {
    use std::fs;

    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("collection");
    // JSON string escaping doubles as valid YAML double-quoted-scalar escaping, so this stays
    // correct for names with quotes/backslashes without pulling in a YAML-writing crate.
    let name_yaml = serde_json::to_string(name).unwrap_or_else(|_| "\"collection\"".to_string());

    let folder_cfg = dir.join("folder.tspec.yaml");
    if !folder_cfg.exists() {
        fs::write(&folder_cfg, format!("tspec: \"0.1\"\nname: {name_yaml}\n"))?;
    }

    let env_dir = dir.join("environments");
    fs::create_dir_all(&env_dir)?;
    let env_file = env_dir.join("local.env.yaml");
    if !env_file.exists() {
        fs::write(
            &env_file,
            "tspec: \"0.1\"\nname: local\nvariables:\n  baseUrl: \"http://localhost:3000\"\n",
        )?;
    }
    Ok(())
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
    log::info!("sidecar: starting with dir={dir} script={script:?} client_dir={client_dir:?}");

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
    log::info!("sidecar: spawned pid={}", child.pid());

    app.state::<Mutex<SidecarState>>().lock().unwrap().child = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("sidecar stdout: {}", String::from_utf8_lossy(&line));
                    if let Ok(ready) = serde_json::from_slice::<Ready>(&line) {
                        navigate_to(&app_handle, &ready.url);
                    }
                    // keep draining rx after the ready line so the sidecar's stdout pipe never backs up
                }
                CommandEvent::Stderr(line) => {
                    log::info!("sidecar stderr: {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Error(err) => {
                    log::info!("sidecar error event: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    log::info!("sidecar terminated: {payload:?}");
                }
                _ => {}
            }
        }
    });
}

fn navigate_to(app: &AppHandle, url: &str) {
    log::info!("sidecar: navigating to {url}");
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
