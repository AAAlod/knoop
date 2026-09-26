use std::{collections::HashMap, fs, path::PathBuf, sync::{Arc, Mutex}, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";
const DEEPSEEK_MODEL: &str = "deepseek-flash";
const MAX_INPUT_BYTES: usize = 48 * 1024;
const MAX_RESPONSE_BYTES: usize = 128 * 1024;

#[derive(Serialize, Deserialize)]
struct SavedAiConfig { api_key: String }

#[derive(Clone)]
struct AiConfig {
    endpoint: reqwest::Url,
    api_key: String,
    model: String,
}

#[derive(Default)]
pub struct AiState {
    config: Mutex<Option<AiConfig>>,
    pending: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigStatus {
    configured: bool,
    base_url: Option<String>,
    model: Option<String>,
}

fn endpoint_for(base_url: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base_url.trim()).map_err(|_| "Base URL 无效".to_string())?;
    if url.username() != "" || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Base URL 不能包含账号、查询参数或片段".into());
    }
    match url.scheme() {
        "https" => {}
        "http" if matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")) => {}
        _ => return Err("远程 API 必须使用 HTTPS".into()),
    }
    if url.path().trim_end_matches('/').ends_with("/chat/completions") {
        return Ok(url);
    }
    let path = format!("{}/chat/completions", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url)
}

fn config_for_key(key: &str) -> Result<AiConfig, String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 4096 {
        return Err("请填写有效的 DeepSeek API Key".into());
    }
    Ok(AiConfig {
        endpoint: endpoint_for(DEEPSEEK_BASE_URL)?,
        api_key: key.to_owned(),
        model: DEEPSEEK_MODEL.to_owned(),
    })
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("ai-config.json"))
        .map_err(|_| "无法定位应用配置目录".to_string())
}

fn read_saved_key(path: &std::path::Path) -> Result<Option<String>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取已保存的 AI 配置".into()),
    };
    let saved: SavedAiConfig =
        serde_json::from_slice(&bytes).map_err(|_| "已保存的 AI 配置格式无效".to_string())?;
    Ok(Some(saved.api_key))
}

fn persist_key(path: &std::path::Path, key: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "无法定位应用配置目录".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "无法创建应用配置目录".to_string())?;
    let saved = serde_json::to_vec(&SavedAiConfig { api_key: key.to_owned() })
        .map_err(|_| "无法序列化 AI 配置".to_string())?;
    fs::write(path, saved).map_err(|_| "无法保存 AI 配置".to_string())
}

pub fn load_saved_ai_config(app: &AppHandle, state: &AiState) -> Result<(), String> {
    let path = config_path(app)?;
    let Some(key) = read_saved_key(&path)? else { return Ok(()); };
    let config = config_for_key(&key)?;
    *state.config.lock().map_err(|_| "AI 配置暂不可用".to_string())? = Some(config);
    Ok(())
}

#[tauri::command]
pub fn set_ai_config(
    app: AppHandle,
    state: State<'_, AiState>,
    api_key: String,
) -> Result<AiConfigStatus, String> {
    let config = config_for_key(&api_key)?;
    let path = config_path(&app)?;
    persist_key(&path, &config.api_key)?;
    *state.config.lock().map_err(|_| "AI 配置暂不可用".to_string())? = Some(config);
    Ok(AiConfigStatus {
        configured: true,
        base_url: Some(DEEPSEEK_BASE_URL.to_owned()),
        model: Some(DEEPSEEK_MODEL.to_owned()),
    })
}

#[tauri::command]
pub fn get_ai_config_status(state: State<'_, AiState>) -> Result<AiConfigStatus, String> {
    let configured = state.config.lock().map_err(|_| "AI 配置暂不可用".to_string())?.is_some();
    Ok(AiConfigStatus {
        configured,
        base_url: Some(DEEPSEEK_BASE_URL.to_owned()),
        model: Some(DEEPSEEK_MODEL.to_owned()),
    })
}

#[tauri::command]
pub fn clear_ai_config(app: AppHandle, state: State<'_, AiState>) -> Result<(), String> {
    let path = config_path(&app)?;
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("无法清除已保存的 AI 配置".into()),
    }
    *state.config.lock().map_err(|_| "AI 配置暂不可用".to_string())? = None;
    for (_, task) in state.pending.lock().map_err(|_| "AI 请求暂不可用".to_string())?.drain() {
        task.abort();
    }
    Ok(())
}

const SYSTEM_PROMPT: &str = r#"你是 Knoop 错题变式题生成器。只输出一个严格 JSON 对象，不要 Markdown、说明文字或代码围栏。
输出必须符合 knoop-bank v1.1。顶层只能有 format、version、import、nodes、questions：
format="knoop-bank"，version="1.1"，import={"mode":"new","bankId":"knoop-ai-preview","bankTitle":"AI 临时回炉"}，nodes=[{"id":"review","parentId":null,"title":"AI 回炉","order":0}]。
questions 恰好包含 2 道新的近距离变式题。每题必须有新的字符串 id、nodeId="review"、整数 order、非空 stem、非空 explanation、type 和 answer。不能出现 source 字段或其他未定义字段。
题型和答案格式必须逐字遵守：
- 单选：type="single_choice"，options=[{"id":"A","text":"..."},{"id":"B","text":"..."}]，answer="A"（字符串，必须是一个选项 id）。
- 多选：type="multiple_choice"，options 同上，answer=["A","B"]（字符串数组，每个值必须是选项 id）。
- 填空：type="blank"，不要 options，answer="完整答案"（字符串，不能是数组）。
仅允许以上三种英文 type；原题若为 recall 或 memorization，也必须转换为上述题型，不能照抄原题 type。不要把单选或填空的 answer 写成数组，也不要把多选的 answer 写成字符串。
不得返回原题修订版，不得编造教材出处，不得扩大原题知识边界。答案必须能从题干和选项确定。"#;

fn ai_tls_config() -> Result<rustls::ClientConfig, String> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|_| "无法初始化 TLS 协议".to_string())
        .map(|builder| builder.with_root_certificates(roots).with_no_client_auth())
}

async fn request_review(config: AiConfig, input: Value) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .tls_backend_preconfigured(ai_tls_config()?)
        .timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化 AI 网络请求".to_string())?;
    let body = json!({
        "model": config.model,
        "temperature": 0.3,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": input.to_string()}
        ]
    });
    let mut response = client
        .post(config.endpoint)
        .bearer_auth(config.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| if error.is_timeout() { "AI 请求超时，请重试".to_string() } else { "AI 网络请求失败，请检查连接和配置".to_string() })?;
    if !response.status().is_success() {
        return Err(format!("AI 服务返回 HTTP {}", response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取 AI 响应失败".to_string())? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("AI 响应过大，请换用更短的输入".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let envelope: Value = serde_json::from_slice(&bytes).map_err(|_| "AI 服务响应不是有效 JSON".to_string())?;
    envelope.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "AI 服务未返回可用的题目内容".to_string())
}

#[tauri::command]
pub async fn generate_ai_review(
    state: State<'_, AiState>,
    request_id: String,
    input: Value,
) -> Result<String, String> {
    if request_id.len() > 80 || request_id.is_empty() {
        return Err("请求 ID 无效".into());
    }
    if input.to_string().len() > MAX_INPUT_BYTES {
        return Err("错题内容过长，无法单次生成".into());
    }
    let config = state.config.lock().map_err(|_| "AI 配置暂不可用".to_string())?
        .clone().ok_or_else(|| "请先配置 AI API".to_string())?;
    let task = tokio::spawn(request_review(config, input));
    {
        let mut pending = state.pending.lock().map_err(|_| "AI 请求暂不可用".to_string())?;
        if pending.contains_key(&request_id) {
            task.abort();
            return Err("请求 ID 重复".into());
        }
        pending.insert(request_id.clone(), task.abort_handle());
    }
    let result = match task.await {
        Ok(result) => result,
        Err(error) if error.is_cancelled() => Err("AI 请求已取消".into()),
        Err(_) => Err("AI 请求未能完成".into()),
    };
    state.pending.lock().map_err(|_| "AI 请求暂不可用".to_string())?.remove(&request_id);
    result
}

#[tauri::command]
pub fn cancel_ai_review(state: State<'_, AiState>, request_id: String) -> Result<(), String> {
    if let Some(task) = state.pending.lock().map_err(|_| "AI 请求暂不可用".to_string())?.remove(&request_id) {
        task.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepseek_defaults_and_key_persist_across_reload() {
        let path = std::env::temp_dir().join(format!(
            "knoop-ai-config-test-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        assert!(read_saved_key(&path).unwrap().is_none());
        let config = config_for_key(" test-key ").unwrap();
        assert_eq!(config.endpoint.as_str(), "https://api.deepseek.com/chat/completions");
        assert_eq!(config.model, "deepseek-flash");
        assert!(reqwest::Client::builder().tls_backend_preconfigured(ai_tls_config().unwrap()).build().is_ok());
        persist_key(&path, &config.api_key).unwrap();
        assert_eq!(read_saved_key(&path).unwrap().as_deref(), Some("test-key"));
        fs::remove_file(&path).unwrap();
        assert!(read_saved_key(&path).unwrap().is_none());
    }
}
