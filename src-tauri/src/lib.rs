mod ai;
mod storage;
mod eink;

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
        .plugin(eink::init())
        .invoke_handler(tauri::generate_handler![
            storage::atomic_write,
            storage::save_restore_safety_copy,
            storage::list_restore_safety_copies,
            storage::read_restore_safety_copy,
            eink::get_eink_status,
            eink::refresh_eink_screen,
            ai::set_ai_config,
            ai::get_ai_config_status,
            ai::clear_ai_config,
            ai::generate_ai_review,
            ai::cancel_ai_review
        ])
        .run(tauri::generate_context!())
        .expect("error while running application");
}
