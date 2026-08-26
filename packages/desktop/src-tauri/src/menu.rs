use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    AppHandle, Manager,
};
use tauri_plugin_dialog::DialogExt;

use crate::sidecar::{new_collection_flow, open_collection_flow};

/// Native "File > New Collection… / Open Collection… / Quit", "Edit" (Undo/Redo/Cut/Copy/Paste/
/// Select All — without these predefined items the OS never routes Cmd+C/Cmd+V/etc. into the
/// webview at all on macOS, since there's no app-level Edit menu for it to bind the shortcut to),
/// and "Help > About TruSpec" menus.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let file_menu = SubmenuBuilder::new(app, "File")
        .text("new-collection", "New Collection…")
        .text("open-collection", "Open Collection…")
        .separator()
        .text("quit", "Quit")
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .text("about", "About TruSpec")
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &help_menu])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| match event.id().as_ref() {
        "new-collection" => new_collection_flow(app.clone()),
        "open-collection" => open_collection_flow(app.clone(), true),
        "quit" => app.exit(0),
        "about" => {
            let version = app.package_info().version.to_string();
            app.dialog()
                .message(format!("TruSpec\nVersion {version}"))
                .title("About TruSpec")
                .show(|_| {});
        }
        _ => {}
    });
    Ok(())
}
