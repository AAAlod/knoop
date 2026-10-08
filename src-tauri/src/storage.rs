use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{Column, Row, SqlitePool, TypeInfo, ValueRef};
use tauri_plugin_sql::{DbInstances, DbPool};
use std::{io::Write, path::Path, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
    expected_rows: Option<Vec<Value>>,
    affected_rows: Option<u64>,
}

// Use the plugin's existing pool, but hold one connection for the whole operation.
async fn write(pool: &SqlitePool, steps: Vec<Step>) -> Result<(), String> {
    let mut transaction = pool.begin().await.map_err(|e| e.to_string())?;
    for step in steps {
        let mut query = sqlx::query(&step.sql);
        for value in step.params {
            query = match value {
                Value::Null => query.bind(Option::<String>::None),
                Value::String(value) => query.bind(value),
                Value::Bool(value) => query.bind(value),
                Value::Number(value) if value.is_i64() => query.bind(value.as_i64().unwrap()),
                Value::Number(value) => query.bind(value.as_f64().ok_or("无效数字")?),
                _ => return Err("SQL 参数必须是标量".into()),
            };
        }
        if let Some(expected) = step.expected_rows {
            let rows = query.fetch_all(&mut *transaction).await.map_err(|e| e.to_string())?;
            let mut actual = Vec::new();
            for row in rows {
                let mut object = Map::new();
                for (i, column) in row.columns().iter().enumerate() {
                    let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
                    let value = if raw.is_null() { Value::Null } else {
                        match raw.type_info().name() {
                            "INTEGER" | "NUMERIC" => Value::from(row.try_get::<i64, _>(i).map_err(|e| e.to_string())?),
                            "REAL" => Value::from(row.try_get::<f64, _>(i).map_err(|e| e.to_string())?),
                            "BOOLEAN" => Value::from(row.try_get::<bool, _>(i).map_err(|e| e.to_string())?),
                            "TEXT" => Value::from(row.try_get::<String, _>(i).map_err(|e| e.to_string())?),
                            _ => return Err("不支持的事务检查类型".into()),
                        }
                    };
                    object.insert(column.name().into(), value);
                }
                actual.push(Value::Object(object));
            }
            if actual != expected { return Err("数据已变化，请重试本次操作".into()); }
        } else {
            let result = query.execute(&mut *transaction).await.map_err(|e| e.to_string())?;
            if step.affected_rows.is_some_and(|n| n != result.rows_affected()) {
                return Err("学习进度已变化，请重新打开本轮练习".into());
            }
        }
    }
    transaction.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn atomic_write(state: tauri::State<'_, DbInstances>, steps: Vec<Step>) -> Result<(), String> {
    let pool = {
        let instances = state.0.read().await;
        match instances.get("sqlite:knoop.db").ok_or("数据库尚未初始化")? {
            DbPool::Sqlite(pool) => pool.clone(),
        }
    };
    write(&pool, steps).await
}

fn safety_name(name: &str) -> bool {
    name.strip_prefix("before-restore-").and_then(|s| s.strip_suffix(".json"))
        .is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
}
fn save_safety(directory: &Path, data: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(data).map_err(|_| "安全副本不是有效 JSON")?;
    if value["format"] != "knoop-backup" || (value["version"] != "1.0" && value["version"] != "1.1") { return Err("安全副本格式无效".into()); }
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let name = format!("before-restore-{stamp}.json");
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(directory.join(&name)).map_err(|e| e.to_string())?;
    file.write_all(data.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    Ok(name)
}
#[tauri::command]
pub fn save_restore_safety_copy(app: tauri::AppHandle, data: String) -> Result<String, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backup-safety");
    save_safety(&directory, &data)
}
#[derive(Serialize)]
pub struct SafetyCopy { name: String, bytes: u64 }
#[tauri::command]
pub fn list_restore_safety_copies(app: tauri::AppHandle) -> Result<Vec<SafetyCopy>, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backup-safety");
    if !directory.exists() { return Ok(Vec::new()); }
    let mut copies = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if safety_name(&name) && entry.file_type().map_err(|e| e.to_string())?.is_file() {
            copies.push(SafetyCopy { name, bytes: entry.metadata().map_err(|e| e.to_string())?.len() });
        }
    }
    copies.sort_by(|a,b| b.name.cmp(&a.name));
    Ok(copies)
}
#[tauri::command]
pub fn read_restore_safety_copy(app: tauri::AppHandle, name: String) -> Result<String, String> {
    if !safety_name(&name) { return Err("安全副本名称无效".into()); }
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backup-safety").join(name);
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    fn steps(value: Value) -> Vec<Step> { serde_json::from_value(value).unwrap() }
    #[test]
    fn safety_copy_is_durable_and_names_cannot_traverse() {
        let directory = std::env::temp_dir().join(format!("knoop-safety-test-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let data = r#"{"format":"knoop-backup","version":"1.0","synthetic":true}"#;
        let name = save_safety(&directory, data).unwrap();
        assert!(safety_name(&name));
        assert_eq!(std::fs::read_to_string(directory.join(&name)).unwrap(), data);
        for invalid in ["../before-restore-1.json", "before-restore-1/2.json", "before-restore-.json", "api-config.json"] { assert!(!safety_name(invalid)); }
        assert!(save_safety(&directory, r#"{"format":"knoop-bank"}"#).is_err());
        std::fs::remove_file(directory.join(name)).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn transaction_rollback_preconditions_and_pool_connection() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
        let pool = SqlitePoolOptions::new().max_connections(4).connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE test(id INTEGER PRIMARY KEY, value TEXT)").execute(&pool).await.unwrap();
        for nth in 0..3 {
            let mut operations = vec![serde_json::json!({"sql":"INSERT INTO test VALUES(1,'a')"}),serde_json::json!({"sql":"UPDATE test SET value='b'"}),serde_json::json!({"sql":"INSERT INTO test VALUES(2,'c')"})];
            operations[nth] = serde_json::json!({"sql":"INSERT INTO nonexistent VALUES(1)"});
            assert!(write(&pool, steps(Value::Array(operations))).await.is_err());
            assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM test").fetch_one(&pool).await.unwrap(), 0);
        }
        write(&pool, steps(serde_json::json!([
            {"sql":"INSERT INTO test VALUES(1,'a')"},
            {"sql":"SELECT * FROM test","expectedRows":[{"id":1,"value":"a"}]},
            {"sql":"SELECT COUNT(*) n FROM test","expectedRows":[{"n":1}]},
            {"sql":"SELECT NULL AS missing, COALESCE(MAX(id),0) AS maximum FROM test","expectedRows":[{"missing":null,"maximum":1}]},
            {"sql":"UPDATE test SET value='b'","affectedRows":1}
        ]))).await.unwrap();
        for tail in [serde_json::json!({"sql":"SELECT * FROM test","expectedRows":[]}),serde_json::json!({"sql":"UPDATE test SET value='c' WHERE id=9","affectedRows":1})] {
            assert!(write(&pool, steps(serde_json::json!([{"sql":"UPDATE test SET value='changed'"},tail]))).await.is_err());
            assert_eq!(sqlx::query_scalar::<_, String>("SELECT value FROM test").fetch_one(&pool).await.unwrap(), "b");
        }
        });
    }
}
