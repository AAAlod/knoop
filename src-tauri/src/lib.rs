mod ai;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ai::AiState::default())
        .setup(|app| {
            let state = app.state::<ai::AiState>();
            if let Err(error) = ai::load_saved_ai_config(app.handle(), &state) {
                eprintln!("AI configuration could not be restored: {error}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            ai::set_ai_config,
            ai::get_ai_config_status,
            ai::clear_ai_config,
            ai::generate_ai_review,
            ai::cancel_ai_review
        ])
        .run(tauri::generate_context!())
        .expect("error while running application");
}
