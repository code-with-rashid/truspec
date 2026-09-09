use std::sync::Mutex;

use serde::Deserialize;
use tauri::{path::BaseDirectory, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
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
    /// Bumped whenever a sidecar is deliberately replaced or killed, so the reader task belonging
    /// to an older process can tell "I was retired" from "I died on my own" and stay quiet.
    generation: u64,
}

/// Report a startup failure the user can actually see.
///
/// Every one of these paths used to be an `.expect()`. A panic here takes the whole app down with
/// nothing on screen: the sidecar is spawned from `setup` and from a menu action, so the only
/// symptom a user gets is a window that never appears, or one that never navigates anywhere. A
/// missing execute bit or a quarantined bundled `node` — the likeliest causes in the wild — are
/// exactly the cases that deserve a sentence of explanation instead.
fn report_failure(app: &AppHandle, detail: &str) {
    log::error!("sidecar: {detail}");
    // Non-blocking: `blocking_show` on the main thread deadlocks the event loop it is waiting on.
    app.dialog()
        .message(detail)
        .title("TruSpec could not start")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

#[derive(Deserialize)]
struct Ready {
    url: String,
}

/// The single entry point for "get a collection directory, (re)spawn its sidecar, point the
/// window at it" — used both at startup (persisted directory, or a folder picker if none yet)
/// and from the "File > Open Collection…" menu item (`force_picker = true`).
pub fn open_collection_flow(app: AppHandle, force_picker: bool) {
    // A persisted directory that's since been deleted, renamed, or lives on a now-disconnected
    // removable/network drive must not be handed to the sidecar as-is — `truspec serve --dir`
    // would start against a path that doesn't exist, and with no picker offered as a fallback the
    // window would be stuck on whatever failure state that produces with no visible way out short
    // of already knowing about "File > Open Collection…".
    let persisted = if force_picker {
        None
    } else {
        config::get_last_dir(&app).filter(|dir| std::path::Path::new(dir).is_dir())
    };
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

    const REINSTALL: &str = "Reinstalling TruSpec should restore it.";

    let Ok(script) = app.path().resolve("server/cli-entry.cjs", BaseDirectory::Resource) else {
        report_failure(&app, &format!("The bundled server files are missing from this installation. {REINSTALL}"));
        return;
    };
    let Ok(client_dir) = app.path().resolve("client", BaseDirectory::Resource) else {
        report_failure(&app, &format!("The bundled app interface is missing from this installation. {REINSTALL}"));
        return;
    };
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

    let command = match app.shell().sidecar("node") {
        Ok(c) => c,
        Err(e) => {
            report_failure(&app, &format!("The bundled Node runtime is missing from this installation. {REINSTALL} ({e})"));
            return;
        }
    };
    let (mut rx, child) = match command.args(args).spawn() {
        Ok(v) => v,
        Err(e) => {
            report_failure(
                &app,
                &format!("Could not start the TruSpec server process: {e}\n\nThis usually means the bundled Node runtime was blocked or lost its permission to run."),
            );
            return;
        }
    };
    log::info!("sidecar: spawned pid={}", child.pid());

    let generation = {
        let handle = app.state::<Mutex<SidecarState>>();
        let mut state = handle.lock().unwrap();
        state.generation += 1;
        state.child = Some(child);
        state.generation
    };

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
                    // Only speak up if this is still the live sidecar. Switching collections and
                    // quitting both kill it on purpose, and neither is worth a dialog.
                    let handle = app_handle.state::<Mutex<SidecarState>>();
                    let current = handle.lock().unwrap().generation;
                    if current == generation {
                        report_failure(
                            &app_handle,
                            &format!(
                                "The TruSpec server stopped unexpectedly ({payload:?}). Try opening the collection again."
                            ),
                        );
                    }
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
            // No floor on the OS window itself, only in the web UI's own CSS (which degrades
            // gracefully down to ~620px by turning the toolbar and sidebar/rail into scrollable
            // regions — see the web package's round 14/15 UX passes) — meant as a last resort for
            // a window that's already narrower than ideal, not as license to let the *native*
            // window shrink to a sliver a user can't recover from without knowing to drag it back.
            let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("TruSpec")
                .inner_size(1200.0, 800.0)
                .min_inner_size(680.0, 480.0)
                .build();
        }
    }
}

/// Kill the running sidecar, if any — called on window close AND as a `RunEvent::Exit` backstop
/// (window-close events aren't guaranteed to fire on every force-quit path).
pub fn kill_sidecar(app: &AppHandle) {
    let handle = app.state::<Mutex<SidecarState>>();
    let mut state = handle.lock().unwrap();
    // Retire the current generation first, so the reader task treats this exit as expected.
    state.generation += 1;
    if let Some(child) = state.child.take() {
        let _ = child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::scaffold_collection;

    /// A scratch directory that cleans itself up, so the tests leave nothing behind on failure.
    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!("tspec-scaffold-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).expect("temp dir");
            Self(p)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn writes_a_folder_config_and_a_starter_environment() {
        let dir = TempDir::new("fresh");
        scaffold_collection(&dir.0).expect("scaffold");

        let cfg = std::fs::read_to_string(dir.0.join("folder.tspec.yaml")).expect("folder config");
        assert!(cfg.contains("tspec: \"0.1\""), "{cfg}");
        let env = std::fs::read_to_string(dir.0.join("environments/local.env.yaml")).expect("env");
        assert!(env.contains("name: local"), "{env}");
    }

    #[test]
    fn leaves_existing_files_alone() {
        let dir = TempDir::new("existing");
        std::fs::write(dir.0.join("folder.tspec.yaml"), "keep me").expect("seed");
        scaffold_collection(&dir.0).expect("scaffold");
        assert_eq!(
            std::fs::read_to_string(dir.0.join("folder.tspec.yaml")).expect("read"),
            "keep me",
        );
    }

    #[test]
    fn quotes_a_directory_name_that_would_otherwise_break_the_yaml() {
        let dir = TempDir::new("quote");
        let inner = dir.0.join("we\"ird: name");
        std::fs::create_dir_all(&inner).expect("inner");
        scaffold_collection(&inner).expect("scaffold");

        let cfg = std::fs::read_to_string(inner.join("folder.tspec.yaml")).expect("folder config");
        // The name is a double-quoted scalar with the quote escaped — not a raw name that would
        // make the file this app just created fail to parse.
        assert!(cfg.contains("name: \"we\\\"ird: name\""), "{cfg}");
    }
}
