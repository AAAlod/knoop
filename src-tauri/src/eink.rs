use serde_json::{json, Value};

#[cfg(target_os = "android")]
struct EinkState(Option<tauri::plugin::PluginHandle<tauri::Wry>>);

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("knoop-eink")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("com.kehai.knoop", "EinkPlugin").ok();
                _app.manage(EinkState(handle));
            }
            Ok(())
        })
        .build()
}

fn unavailable() -> Value {
    json!({"supported": false, "message": "当前设备没有已验证的全屏刷新接口"})
}

#[tauri::command]
pub async fn get_eink_status(_app: tauri::AppHandle) -> Value {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        if let Some(state) = _app.try_state::<EinkState>() {
            if let Some(handle) = &state.0 {
                return handle.run_mobile_plugin_async("status", json!({})).await.unwrap_or_else(|_| unavailable());
            }
        }
    }
    unavailable()
}

#[tauri::command]
pub async fn refresh_eink_screen(_app: tauri::AppHandle) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        if let Some(state) = _app.try_state::<EinkState>() {
            if let Some(handle) = &state.0 {
                return handle.run_mobile_plugin_async("refresh", json!({})).await.map_err(|_| "刷新请求失败，请稍后重试或使用设备的系统刷新功能".into());
            }
        }
    }
    Err("当前设备没有已验证的全屏刷新接口".into())
}
