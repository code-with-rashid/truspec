use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    AppHandle,
};

use crate::sidecar::{new_collection_flow, open_collection_flow};

/// Native "File > New Collection… / Open Collection… / Quit" menu — the only way (besides
/// relaunching) to point the window at a different directory.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let file_menu = SubmenuBuilder::new(app, "File")
        .text("new-collection", "New Collection…")
        .text("open-collection", "Open Collection…")
        .separator()
        .text("quit", "Quit")
        .build()?;
    let menu = MenuBuilder::new(app).items(&[&file_menu]).build()?;
    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| match event.id().as_ref() {
        "new-collection" => new_collection_flow(app.clone()),
        "open-collection" => open_collection_flow(app.clone(), true),
        "quit" => app.exit(0),
        _ => {}
    });
    Ok(())
}
