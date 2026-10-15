//! CC Switch 的只读发现与迁移适配器。
//!
//! 这个模块只读取 CC Switch 的 SQLite 数据库，不写入其文件、数据库或 live 配置。
//! 供应商记录里的 `settings_config` 可能包含 CC Switch 的本地代理地址和占位
//! token，因此必须先还原出真实上游端点，再交给 Keyway 的加密存储入口。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::Pool;
use crate::services::provider;
use crate::types::{AppType, ProviderInput};

const CC_SWITCH_PROXY_MARKER: &str = "PROXY_MANAGED";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportBlockReason {
    MissingUrl,
    LocalProxy,
    UnsafeUrl,
    MissingKey,
    Duplicate,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredProvider {
    pub source_id: String,
    pub app_type: AppType,
    pub name: String,
    pub base_url: String,
    pub has_key: bool,
    pub is_current: bool,
    pub importable: bool,
    pub reason: Option<ImportBlockReason>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportRequest {
    pub source_id: String,
    pub app_type: AppType,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportedProvider {
    pub source_id: String,
    pub app_type: AppType,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported: Vec<ImportedProvider>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone)]
struct SourceProvider {
    source_id: String,
    app_type: AppType,
    name: String,
    settings: Value,
    endpoints: Vec<String>,
    is_current: bool,
}

fn candidate_paths(home: &Path) -> Vec<PathBuf> {
    [
        home.join(".cc-switch/cc-switch.db"),
        home.join("Library/Application Support/cc-switch/cc-switch.db"),
        home.join(".config/cc-switch/cc-switch.db"),
        home.join("AppData/Roaming/cc-switch/cc-switch.db"),
    ]
    .into_iter()
    .collect()
}

fn db_path(home: &Path) -> Result<PathBuf> {
    candidate_paths(home)
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| anyhow!("未找到 CC Switch 数据库"))
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
        )",
        [table],
        |row| row.get::<_, i64>(0),
    )? != 0)
}

fn table_columns(conn: &Connection, table: &str) -> Result<HashSet<String>> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&sql)?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(columns
        .into_iter()
        .map(|column| column.to_ascii_lowercase())
        .collect())
}

fn sql_value_is_true(value: &SqlValue) -> bool {
    match value {
        SqlValue::Integer(value) => *value != 0,
        SqlValue::Real(value) => *value != 0.0,
        SqlValue::Text(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        SqlValue::Blob(_) | SqlValue::Null => false,
    }
}

fn active_column_value(
    conn: &Connection,
    table: &str,
    columns: &HashSet<String>,
    column: &str,
    app: AppType,
) -> Result<bool> {
    if !columns.contains(column) {
        return Ok(false);
    }
    let sql = if columns.contains("app_type") {
        format!("SELECT {column} FROM {table} WHERE app_type = ?1 LIMIT 1")
    } else {
        format!("SELECT {column} FROM {table} LIMIT 1")
    };
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = if columns.contains("app_type") {
        stmt.query(rusqlite::params![app.as_str()])?
    } else {
        stmt.query([])?
    };
    while let Some(row) = rows.next()? {
        let value: SqlValue = row.get(0)?;
        if sql_value_is_true(&value) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn has_backup_for_app(conn: &Connection, app: AppType) -> Result<bool> {
    if !table_exists(conn, "proxy_live_backup")? {
        return Ok(false);
    }
    let columns = table_columns(conn, "proxy_live_backup")?;
    if !columns.contains("app_type") {
        return Err(anyhow!("CC Switch proxy_live_backup 表缺少 app_type 列"));
    }
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM proxy_live_backup WHERE app_type = ?1",
        [app.as_str()],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn has_legacy_settings_flag(conn: &Connection, app: AppType) -> Result<bool> {
    if !table_exists(conn, "settings")? {
        return Ok(false);
    }
    let columns = table_columns(conn, "settings")?;
    if !columns.contains("key") || !columns.contains("value") {
        return Err(anyhow!("CC Switch settings 表结构无法识别"));
    }
    let key = format!("proxy_takeover_{}", app.as_str());
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1 LIMIT 1")?;
    let mut rows = stmt.query([key])?;
    let Some(row) = rows.next()? else {
        return Ok(false);
    };
    let value: SqlValue = row.get(0)?;
    Ok(sql_value_is_true(&value))
}

/// 只读判断 CC Switch 是否仍拥有某个 CLI 的 live 配置。
///
/// 返回 `Ok(false)` 只表示没有发现接管信号；数据库存在但无法解析时返回错误，
/// 调用方应按外部占用处理，避免 Keyway 在不确定时覆盖配置。
pub(crate) fn takeover_active_at(home: &Path, app: AppType) -> Result<bool> {
    let Some(path) = candidate_paths(home)
        .into_iter()
        .find(|path| path.is_file())
    else {
        return Ok(false);
    };
    let conn = Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("无法读取 CC Switch 数据库: {}", path.display()))?;

    let proxy_config_active = if table_exists(&conn, "proxy_config")? {
        let columns = table_columns(&conn, "proxy_config")?;
        active_column_value(&conn, "proxy_config", &columns, "enabled", app)?
            || active_column_value(&conn, "proxy_config", &columns, "live_takeover_active", app)?
    } else {
        false
    };
    Ok(proxy_config_active
        || has_backup_for_app(&conn, app)?
        || has_legacy_settings_flag(&conn, app)?)
}

fn app_type(value: &str) -> Option<AppType> {
    match value {
        "claude" => Some(AppType::Claude),
        "codex" => Some(AppType::Codex),
        "gemini" => Some(AppType::Gemini),
        _ => None,
    }
}

fn read_source_provider(row: &Row<'_>) -> rusqlite::Result<Option<SourceProvider>> {
    let source_id: String = row.get("id")?;
    let app_name: String = row.get("app_type")?;
    let Some(app_type) = app_type(&app_name) else {
        return Ok(None);
    };
    let name: String = row.get("name")?;
    let settings_raw: String = row.get("settings_config")?;
    let settings = serde_json::from_str::<Value>(&settings_raw).unwrap_or(Value::Null);
    let is_current = row
        .get::<_, i64>("is_current")
        .map(|value| value != 0)
        .unwrap_or(false);
    Ok(Some(SourceProvider {
        source_id,
        app_type,
        name,
        settings,
        endpoints: Vec::new(),
        is_current,
    }))
}

fn read_endpoint_map(conn: &Connection) -> Result<HashMap<(String, String), Vec<String>>> {
    if !table_exists(conn, "provider_endpoints")? {
        return Ok(HashMap::new());
    }
    let columns = table_columns(conn, "provider_endpoints")?;
    if !["provider_id", "app_type", "url"]
        .into_iter()
        .all(|column| columns.contains(column))
    {
        return Err(anyhow!("CC Switch provider_endpoints 表结构无法识别"));
    }
    let order = match (columns.contains("added_at"), columns.contains("id")) {
        (true, true) => " ORDER BY added_at ASC, id ASC",
        (true, false) => " ORDER BY added_at ASC",
        (false, true) => " ORDER BY id ASC",
        (false, false) => "",
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT provider_id, app_type, url FROM provider_endpoints{order}"
    ))?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut endpoints = HashMap::new();
    for row in rows {
        let (provider_id, app_type, url) = row?;
        endpoints
            .entry((provider_id, app_type))
            .or_insert_with(Vec::new)
            .push(url);
    }
    Ok(endpoints)
}

fn read_sources_from(path: &Path) -> Result<Vec<SourceProvider>> {
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("无法读取 CC Switch 数据库: {}", path.display()))?;
    let mut stmt = conn.prepare(
        "SELECT id, app_type, name, settings_config, is_current
         FROM providers ORDER BY app_type, sort_index, created_at",
    )?;
    let rows = stmt.query_map([], read_source_provider)?;
    let mut sources = rows
        .filter_map(|row| row.transpose())
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let endpoints = read_endpoint_map(&conn)?;
    for source in &mut sources {
        source.endpoints = endpoints
            .get(&(
                source.source_id.clone(),
                source.app_type.as_str().to_string(),
            ))
            .cloned()
            .unwrap_or_default();
    }
    Ok(sources)
}

fn local_proxy_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value.trim()) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false)
}

fn display_url(value: &str) -> String {
    let Ok(mut url) = reqwest::Url::parse(value.trim()) else {
        return String::new();
    };
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string().trim_end_matches('/').to_string()
}

fn safe_import_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value.trim()) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}

fn usable_key(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && *value != CC_SWITCH_PROXY_MARKER
                && !value.starts_with("${")
                && !value.starts_with("{env:")
        })
        .map(ToOwned::to_owned)
}

fn string_field<'a>(object: &'a Value, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn claude_details(settings: &Value) -> Option<(String, Option<String>)> {
    let env = settings.get("env")?;
    let base = string_field(env, "ANTHROPIC_BASE_URL")?.trim();
    let key = [
        string_field(env, "ANTHROPIC_AUTH_TOKEN"),
        string_field(env, "ANTHROPIC_AUTH_KEY"),
        string_field(env, "ANTHROPIC_API_KEY"),
    ]
    .into_iter()
    .find_map(usable_key);
    Some((base.to_string(), key))
}

fn codex_details(settings: &Value) -> Option<(String, Option<String>)> {
    let auth = settings.get("auth");
    let auth_key = auth
        .and_then(|value| string_field(value, "OPENAI_API_KEY"))
        .and_then(|value| usable_key(Some(value)));
    let config = string_field(settings, "config")?;
    let doc = config.parse::<toml_edit::DocumentMut>().ok()?;
    let profile = doc.get("profile").and_then(|value| value.as_str());
    let selected = profile
        .and_then(|name| {
            doc.get("profiles")?
                .get(name)?
                .get("model_provider")?
                .as_str()
        })
        .or_else(|| doc.get("model_provider").and_then(|value| value.as_str()))
        .unwrap_or("openai");
    let provider = doc
        .get("model_providers")
        .and_then(|value| value.as_table_like())
        .and_then(|providers| providers.get(selected));
    let base = provider
        .and_then(|value| value.get("base_url"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            doc.get("base_url")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })?;
    let config_key = provider
        .and_then(|value| value.get("experimental_bearer_token"))
        .and_then(|value| value.as_str())
        .or_else(|| {
            doc.get("experimental_bearer_token")
                .and_then(|value| value.as_str())
        })
        .and_then(|value| usable_key(Some(value)));
    Some((base.to_string(), auth_key.or(config_key)))
}

fn gemini_details(settings: &Value) -> Option<(String, Option<String>)> {
    let env = settings.get("env")?;
    let base = string_field(env, "GOOGLE_GEMINI_BASE_URL")?.trim();
    let key = [
        string_field(env, "GEMINI_API_KEY"),
        string_field(env, "GOOGLE_API_KEY"),
    ]
    .into_iter()
    .find_map(usable_key);
    Some((base.to_string(), key))
}

fn settings_key(source: &SourceProvider) -> Option<String> {
    match source.app_type {
        AppType::Claude => source.settings.get("env").and_then(|env| {
            [
                string_field(env, "ANTHROPIC_AUTH_TOKEN"),
                string_field(env, "ANTHROPIC_AUTH_KEY"),
                string_field(env, "ANTHROPIC_API_KEY"),
            ]
            .into_iter()
            .find_map(usable_key)
        }),
        AppType::Gemini => source.settings.get("env").and_then(|env| {
            [
                string_field(env, "GEMINI_API_KEY"),
                string_field(env, "GOOGLE_API_KEY"),
            ]
            .into_iter()
            .find_map(usable_key)
        }),
        AppType::Codex => {
            let auth_key = source
                .settings
                .get("auth")
                .and_then(|auth| string_field(auth, "OPENAI_API_KEY"))
                .and_then(|value| usable_key(Some(value)));
            let config_key = string_field(&source.settings, "config").and_then(|config| {
                let doc = config.parse::<toml_edit::DocumentMut>().ok()?;
                let profile = doc.get("profile").and_then(|value| value.as_str());
                let selected = profile
                    .and_then(|name| {
                        doc.get("profiles")?
                            .get(name)?
                            .get("model_provider")?
                            .as_str()
                    })
                    .or_else(|| doc.get("model_provider").and_then(|value| value.as_str()))
                    .unwrap_or("openai");
                doc.get("model_providers")
                    .and_then(|value| value.as_table_like())
                    .and_then(|providers| providers.get(selected))
                    .and_then(|provider| provider.get("experimental_bearer_token"))
                    .and_then(|value| value.as_str())
                    .and_then(|value| usable_key(Some(value)))
                    .or_else(|| {
                        doc.get("experimental_bearer_token")
                            .and_then(|value| value.as_str())
                            .and_then(|value| usable_key(Some(value)))
                    })
            });
            auth_key.or(config_key)
        }
        _ => None,
    }
}

fn endpoint_fallback(source: &SourceProvider) -> Option<&str> {
    source
        .endpoints
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .find(|url| !url.is_empty() && !local_proxy_url(url) && safe_import_url(url))
        .or_else(|| {
            source
                .endpoints
                .iter()
                .map(String::as_str)
                .map(str::trim)
                .find(|url| !url.is_empty() && !local_proxy_url(url))
        })
}

fn details(source: &SourceProvider) -> Option<(String, Option<String>)> {
    let configured = match source.app_type {
        AppType::Claude => claude_details(&source.settings),
        AppType::Codex => codex_details(&source.settings),
        AppType::Gemini => gemini_details(&source.settings),
        _ => None,
    };
    let fallback = endpoint_fallback(source);
    match configured {
        Some((base_url, key)) if !local_proxy_url(&base_url) || fallback.is_none() => {
            Some((base_url, key))
        }
        Some((_, key)) => fallback.map(|url| (url.to_string(), key)),
        None => fallback.map(|url| (url.to_string(), settings_key(source))),
    }
}

fn describe(source: &SourceProvider) -> DiscoveredProvider {
    let (base_url, key) = details(source).unwrap_or_default();
    let mut reason = None;
    let importable = if base_url.is_empty() {
        reason = Some(ImportBlockReason::MissingUrl);
        false
    } else if local_proxy_url(&base_url) {
        reason = Some(ImportBlockReason::LocalProxy);
        false
    } else if !safe_import_url(&base_url) {
        reason = Some(ImportBlockReason::UnsafeUrl);
        false
    } else if key.is_none() {
        reason = Some(ImportBlockReason::MissingKey);
        false
    } else {
        true
    };
    DiscoveredProvider {
        source_id: source.source_id.clone(),
        app_type: source.app_type,
        name: source.name.clone(),
        base_url: display_url(&base_url),
        has_key: key.is_some(),
        is_current: source.is_current,
        importable,
        reason,
    }
}

pub fn discover(pool: &Pool) -> Result<Vec<DiscoveredProvider>> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("无法定位用户目录"))?;
    let path = db_path(&home)?;
    discover_from(pool, &path)
}

fn discover_from(pool: &Pool, path: &Path) -> Result<Vec<DiscoveredProvider>> {
    let sources = read_sources_from(path)?;
    sources
        .iter()
        .map(|source| {
            let mut discovered = describe(source);
            if discovered.importable && already_imported(pool, source, &discovered.base_url)? {
                discovered.importable = false;
                discovered.reason = Some(ImportBlockReason::Duplicate);
            }
            Ok(discovered)
        })
        .collect()
}

fn unique_name(pool: &Pool, name: &str) -> Result<String> {
    let base = name.trim();
    let mut candidate = base.to_string();
    let mut index = 2;
    while crate::db::provider_dao::find_by_name(pool, &candidate)?.is_some() {
        candidate = format!("{base} (CC Switch {index})");
        index += 1;
    }
    Ok(candidate)
}

fn normalized_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn already_imported(pool: &Pool, source: &SourceProvider, base_url: &str) -> Result<bool> {
    let expected = normalized_url(base_url);
    let protocol = source.app_type.protocol();
    let source_name = source.name.trim();
    let variant_prefix = format!("{source_name} (CC Switch ");
    for provider in crate::db::provider_dao::list_all(pool)? {
        if provider.app_type != source.app_type {
            continue;
        }
        let Some(url) = provider.endpoint(protocol).or_else(|| {
            (provider.app_type == source.app_type).then_some(provider.base_url.as_str())
        }) else {
            continue;
        };
        if normalized_url(url) != expected {
            continue;
        }
        if provider.name.trim().eq_ignore_ascii_case(source_name) {
            return Ok(true);
        }
        if provider.name.starts_with(&variant_prefix) && provider.name.ends_with(')') {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn import_selected(pool: &Pool, requests: &[ImportRequest]) -> Result<ImportResult> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("无法定位用户目录"))?;
    import_selected_from(pool, &db_path(&home)?, requests)
}

fn import_selected_from(
    pool: &Pool,
    source_path: &Path,
    requests: &[ImportRequest],
) -> Result<ImportResult> {
    let sources = read_sources_from(source_path)?;
    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    for request in requests {
        let Some(source) = sources.iter().find(|source| {
            source.source_id == request.source_id && source.app_type == request.app_type
        }) else {
            skipped.push(request.source_id.clone());
            continue;
        };
        let Some((base_url, key)) = details(source) else {
            skipped.push(source.name.clone());
            continue;
        };
        let Some(key) = key else {
            skipped.push(source.name.clone());
            continue;
        };
        if base_url.is_empty() || local_proxy_url(&base_url) || !safe_import_url(&base_url) {
            skipped.push(source.name.clone());
            continue;
        }
        if already_imported(pool, source, &base_url)? {
            skipped.push(source.name.clone());
            continue;
        }
        let name = unique_name(pool, &source.name)?;
        provider::create_unique(
            pool,
            ProviderInput {
                app_type: source.app_type,
                name: name.clone(),
                base_url,
                models: vec![],
                api_key: Some(key),
            },
        )?;
        imported.push(ImportedProvider {
            source_id: source.source_id.clone(),
            app_type: source.app_type,
            name,
        });
    }
    Ok(ImportResult { imported, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keyway_db(tag: &str) -> (Pool, PathBuf) {
        let directory =
            std::env::temp_dir().join(format!("keyway_cc_switch_{tag}_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("keyway.db");
        let pool = crate::db::init_pool(&path, &"0".repeat(64)).unwrap();
        (pool, directory)
    }

    fn source_db(directory: &Path, rows: &[(&str, &str, &str, &str, i64)]) -> PathBuf {
        let path = directory.join("cc-switch.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE providers (
                id TEXT PRIMARY KEY,
                app_type TEXT NOT NULL,
                name TEXT NOT NULL,
                settings_config TEXT NOT NULL,
                is_current INTEGER NOT NULL DEFAULT 0,
                sort_index INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        for (id, app, name, settings, current) in rows {
            conn.execute(
                "INSERT INTO providers
                    (id, app_type, name, settings_config, is_current, sort_index, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, 0)",
                rusqlite::params![id, app, name, settings, current],
            )
            .unwrap();
        }
        path
    }

    fn source(app_type: AppType, settings: &str) -> SourceProvider {
        SourceProvider {
            source_id: "id".into(),
            app_type,
            name: "A".into(),
            settings: serde_json::from_str(settings).unwrap(),
            endpoints: Vec::new(),
            is_current: false,
        }
    }

    #[test]
    fn codex_uses_selected_provider_not_proxy_or_unselected_entry() {
        let config = "model_provider = \"custom\"\n[model_providers.custom]\nbase_url = \"https://upstream.example/v1\"\n[model_providers.other]\nbase_url = \"http://127.0.0.1:15721/v1\"";
        let source = SourceProvider {
            source_id: "id".into(),
            app_type: AppType::Codex,
            name: "A".into(),
            settings: serde_json::json!({
                "auth": { "OPENAI_API_KEY": "real-key" },
                "config": config,
            }),
            endpoints: Vec::new(),
            is_current: false,
        };
        let (url, key) = codex_details(&source.settings).unwrap();
        assert_eq!(url, "https://upstream.example/v1");
        assert_eq!(key.as_deref(), Some("real-key"));
    }

    #[test]
    fn codex_falls_back_to_active_bearer_token_and_top_level_base_url() {
        let source = SourceProvider {
            source_id: "id".into(),
            app_type: AppType::Codex,
            name: "A".into(),
            settings: serde_json::json!({
                "auth": { "OPENAI_API_KEY": "${OPENAI_API_KEY}" },
                "config": "experimental_bearer_token = \"bearer-key\"\nbase_url = \"https://fallback.example/v1\"\nmodel_provider = \"custom\"\n[model_providers.custom]\nbase_url = \"\"",
            }),
            endpoints: Vec::new(),
            is_current: false,
        };
        let (url, key) = codex_details(&source.settings).unwrap();
        assert_eq!(url, "https://fallback.example/v1");
        assert_eq!(key.as_deref(), Some("bearer-key"));
    }

    #[test]
    fn proxy_and_placeholder_are_not_importable() {
        let local = source(
            AppType::Claude,
            r#"{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:15721","ANTHROPIC_AUTH_TOKEN":"PROXY_MANAGED"}}"#,
        );
        let found = describe(&local);
        assert!(!found.importable);
        assert!(found.reason.is_some());
    }

    #[test]
    fn loopback_without_explicit_port_is_not_importable_and_url_secrets_are_redacted() {
        let local = source(
            AppType::Claude,
            r#"{"env":{"ANTHROPIC_BASE_URL":"http://localhost/v1?token=secret#fragment","ANTHROPIC_AUTH_TOKEN":"real-key"}}"#,
        );
        let found = describe(&local);
        assert!(!found.importable);
        assert_eq!(found.base_url, "http://localhost/v1");

        let public = source(
            AppType::Claude,
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://user:password@example.com/v1?token=secret","ANTHROPIC_AUTH_TOKEN":"real-key"}}"#,
        );
        assert_eq!(describe(&public).base_url, "https://example.com/v1");
    }

    #[test]
    fn malformed_url_is_not_echoed_back_to_the_frontend() {
        let source = source(
            AppType::Claude,
            r#"{"env":{"ANTHROPIC_BASE_URL":"not a url?token=secret","ANTHROPIC_AUTH_TOKEN":"real-key"}}"#,
        );

        let found = describe(&source);

        assert!(!found.importable);
        assert_eq!(found.reason, Some(ImportBlockReason::UnsafeUrl));
        assert!(found.base_url.is_empty());
    }

    #[test]
    fn real_key_is_used_when_an_earlier_auth_field_is_proxy_managed() {
        let source = source(
            AppType::Claude,
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://upstream.example","ANTHROPIC_AUTH_TOKEN":"PROXY_MANAGED","ANTHROPIC_API_KEY":"real-key"}}"#,
        );
        let found = describe(&source);
        assert!(found.importable);
        assert!(found.has_key);
    }

    #[test]
    fn official_or_env_only_provider_is_explained() {
        let source = source(
            AppType::Gemini,
            r#"{"env":{"GOOGLE_GEMINI_BASE_URL":"https://generativelanguage.googleapis.com","GEMINI_API_KEY":"${GEMINI_API_KEY}"}}"#,
        );
        let found = describe(&source);
        assert!(!found.importable);
        assert!(!found.has_key);
    }

    #[test]
    fn gemini_accepts_google_api_key_fallback() {
        let source = source(
            AppType::Gemini,
            r#"{"env":{"GOOGLE_GEMINI_BASE_URL":"https://generativelanguage.googleapis.com","GOOGLE_API_KEY":"google-key"}}"#,
        );
        let found = describe(&source);
        assert!(found.importable);
        assert!(found.has_key);
    }

    #[test]
    fn provider_endpoints_table_supplies_missing_upstream_url() {
        let (pool, directory) = keyway_db("endpoint_fallback");
        let source_path = source_db(
            &directory,
            &[(
                "source-endpoint",
                "claude",
                "Endpoint provider",
                r#"{"env":{"ANTHROPIC_API_KEY":"real-key"}}"#,
                0,
            )],
        );
        let conn = Connection::open(&source_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE provider_endpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_id TEXT NOT NULL,
                app_type TEXT NOT NULL,
                url TEXT NOT NULL
            );
            INSERT INTO provider_endpoints(provider_id, app_type, url)
            VALUES ('source-endpoint', 'claude', 'https://endpoint.example/v1');",
        )
        .unwrap();

        let found = discover_from(&pool, &source_path).unwrap();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].base_url, "https://endpoint.example/v1");
        assert!(found[0].importable);

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn provider_endpoints_table_replaces_a_local_proxy_url() {
        let (pool, directory) = keyway_db("endpoint_proxy_fallback");
        let source_path = source_db(
            &directory,
            &[(
                "source-endpoint-proxy",
                "claude",
                "Proxy provider",
                r#"{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:15721","ANTHROPIC_AUTH_TOKEN":"PROXY_MANAGED","ANTHROPIC_API_KEY":"real-key"}}"#,
                0,
            )],
        );
        let conn = Connection::open(&source_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE provider_endpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_id TEXT NOT NULL,
                app_type TEXT NOT NULL,
                url TEXT NOT NULL
            );
            INSERT INTO provider_endpoints(provider_id, app_type, url)
            VALUES ('source-endpoint-proxy', 'claude', 'https://upstream.example/v1');",
        )
        .unwrap();

        let found = discover_from(&pool, &source_path).unwrap();

        assert_eq!(found[0].base_url, "https://upstream.example/v1");
        assert!(found[0].importable);

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn importing_same_source_twice_skips_without_replacing_existing_key() {
        let (pool, directory) = keyway_db("same");
        let source_path = source_db(
            &directory,
            &[(
                "source-a",
                "claude",
                "A",
                r#"{"env":{"ANTHROPIC_BASE_URL":"https://a.example/v1","ANTHROPIC_API_KEY":"new-key"}}"#,
                1,
            )],
        );
        provider::create(
            &pool,
            ProviderInput {
                app_type: AppType::Claude,
                name: "A".into(),
                base_url: "https://a.example/v1".into(),
                models: vec![],
                api_key: Some("old-key".into()),
            },
        )
        .unwrap();

        let request = ImportRequest {
            source_id: "source-a".into(),
            app_type: AppType::Claude,
        };
        let first =
            import_selected_from(&pool, &source_path, std::slice::from_ref(&request)).unwrap();
        let second = import_selected_from(&pool, &source_path, &[request]).unwrap();

        assert!(first.imported.is_empty());
        assert_eq!(first.skipped, vec!["A"]);
        assert!(second.imported.is_empty());
        assert_eq!(second.skipped, vec!["A"]);
        let provider = crate::db::provider_dao::list_all(&pool).unwrap();
        assert_eq!(provider.len(), 1);
        assert_eq!(
            crate::db::api_key_dao::get(&pool, &provider[0].id)
                .unwrap()
                .as_deref(),
            Some("old-key")
        );

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn scan_marks_an_existing_provider_as_duplicate() {
        let (pool, directory) = keyway_db("scan_duplicate");
        let source_path = source_db(
            &directory,
            &[(
                "source-a",
                "claude",
                "A",
                r#"{"env":{"ANTHROPIC_BASE_URL":"https://a.example/v1/","ANTHROPIC_API_KEY":"new-key"}}"#,
                1,
            )],
        );
        provider::create(
            &pool,
            ProviderInput {
                app_type: AppType::Claude,
                name: "A".into(),
                base_url: "https://a.example/v1".into(),
                models: vec![],
                api_key: Some("old-key".into()),
            },
        )
        .unwrap();

        let found = discover_from(&pool, &source_path).unwrap();

        assert_eq!(found.len(), 1);
        assert!(!found[0].importable);
        assert_eq!(found[0].reason, Some(ImportBlockReason::Duplicate));

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn importing_same_name_with_new_url_gets_a_stable_disambiguated_record() {
        let (pool, directory) = keyway_db("rename");
        let source_path = source_db(
            &directory,
            &[(
                "source-b",
                "claude",
                "A",
                r#"{"env":{"ANTHROPIC_BASE_URL":"https://new.example/v1","ANTHROPIC_API_KEY":"new-key"}}"#,
                0,
            )],
        );
        provider::create(
            &pool,
            ProviderInput {
                app_type: AppType::Claude,
                name: "A".into(),
                base_url: "https://old.example/v1".into(),
                models: vec![],
                api_key: Some("old-key".into()),
            },
        )
        .unwrap();

        let result = import_selected_from(
            &pool,
            &source_path,
            &[ImportRequest {
                source_id: "source-b".into(),
                app_type: AppType::Claude,
            }],
        )
        .unwrap();

        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].name, "A (CC Switch 2)");
        assert_eq!(result.imported[0].app_type, AppType::Claude);
        assert_eq!(result.imported[0].source_id, "source-b");
        assert!(result.skipped.is_empty());
        Connection::open(&source_path)
            .unwrap()
            .execute(
                "UPDATE providers SET settings_config = ?1 WHERE id = 'source-b'",
                [r#"{"env":{"ANTHROPIC_BASE_URL":"https://new.example/v1","ANTHROPIC_API_KEY":"rotated-key"}}"#],
            )
            .unwrap();
        let repeated = import_selected_from(
            &pool,
            &source_path,
            &[ImportRequest {
                source_id: "source-b".into(),
                app_type: AppType::Claude,
            }],
        )
        .unwrap();
        assert!(repeated.imported.is_empty());
        assert_eq!(repeated.skipped, vec!["A"]);
        let providers = crate::db::provider_dao::list_all(&pool).unwrap();
        assert_eq!(providers.len(), 2);
        assert!(providers.iter().any(|item| item.name == "A (CC Switch 2)"));

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }
}
