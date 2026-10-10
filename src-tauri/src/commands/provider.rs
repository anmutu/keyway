//! 供应商相关命令。

use serde::Deserialize;
use tauri::State;

use crate::db::provider_dao;
use crate::services::provider as svc;
use crate::state::AppState;
use crate::types::{AppType, Protocol, Provider, ProviderInput};

#[derive(Debug, Deserialize)]
struct RelayHandoffEnvelope {
    success: Option<bool>,
    data: Option<RelayHandoffData>,
    key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RelayHandoffData {
    key: Option<String>,
    api_key: Option<String>,
}

fn valid_relay_handoff_code(code: &str) -> bool {
    (16..=256).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn valid_relay_handoff_base(base_url: &str) -> Result<reqwest::Url, String> {
    let parsed =
        reqwest::Url::parse(base_url.trim()).map_err(|_| "invalid RELAY URL".to_string())?;
    let is_local_http =
        parsed.scheme() == "http" && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1"));
    if (parsed.scheme() != "https" && !is_local_http)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("RELAY handoff requires a clean HTTPS base URL".into());
    }
    Ok(parsed)
}

/// Exchange a short-lived RELAY handoff grant. The returned key stays in memory
/// long enough for the caller to pass it to `create_relay_provider`; it is never
/// put in the deep link or logged.
#[tauri::command]
pub async fn exchange_relay_handoff(base_url: String, code: String) -> Result<String, String> {
    if !valid_relay_handoff_code(&code) {
        return Err("invalid handoff code".into());
    }
    let _ = valid_relay_handoff_base(&base_url)?;
    let endpoint = format!(
        "{}/api/keyway/handoff/exchange",
        base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| "could not prepare RELAY connection".to_string())?;
    let response = client
        .post(endpoint)
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
        .map_err(|_| "RELAY handoff could not be reached".to_string())?;
    if !response.status().is_success() {
        return Err("RELAY rejected or expired this handoff".into());
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| "invalid RELAY handoff response".to_string())?;
    if body.len() > 32 * 1024 {
        return Err("invalid RELAY handoff response".into());
    }
    let envelope: RelayHandoffEnvelope =
        serde_json::from_slice(&body).map_err(|_| "invalid RELAY handoff response".to_string())?;
    if envelope.success == Some(false) {
        return Err("RELAY rejected or expired this handoff".into());
    }
    let key = envelope
        .data
        .and_then(|data| data.key.or(data.api_key))
        .or(envelope.key)
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| "RELAY did not return an API key".to_string())?;
    Ok(key)
}

#[cfg(test)]
mod relay_handoff_tests {
    use super::{valid_relay_handoff_base, valid_relay_handoff_code};

    #[test]
    fn validates_opaque_one_time_code() {
        assert!(valid_relay_handoff_code(&"A".repeat(64)));
        assert!(!valid_relay_handoff_code("short"));
        assert!(!valid_relay_handoff_code(&"A".repeat(257)));
        assert!(!valid_relay_handoff_code(&format!("{}-", "A".repeat(63))));
    }

    #[test]
    fn rejects_credentialed_or_non_https_handoff_bases() {
        assert!(valid_relay_handoff_base("https://relay.example/api").is_ok());
        assert!(valid_relay_handoff_base("http://localhost:3000").is_ok());
        assert!(valid_relay_handoff_base("http://relay.example").is_err());
        assert!(valid_relay_handoff_base("https://user:pass@relay.example").is_err());
        assert!(valid_relay_handoff_base("https://relay.example?key=secret").is_err());
    }
}

#[tauri::command]
pub fn list_providers(
    state: State<'_, AppState>,
    app_type: AppType,
) -> Result<Vec<Provider>, String> {
    svc::list_by_app(&state.db, app_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_providers(state: State<'_, AppState>) -> Result<Vec<Provider>, String> {
    svc::list_all(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_current_provider(
    state: State<'_, AppState>,
    app_type: AppType,
) -> Result<Option<Provider>, String> {
    svc::get_current(&state.db, app_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_provider(
    state: State<'_, AppState>,
    input: ProviderInput,
) -> Result<Provider, String> {
    svc::create(&state.db, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_relay_provider(
    state: State<'_, AppState>,
    input: ProviderInput,
) -> Result<Provider, String> {
    svc::create_unique(&state.db, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn switch_provider(
    state: State<'_, AppState>,
    id: String,
    app_type: AppType,
) -> Result<(), String> {
    svc::switch(&state.db, &id, app_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_provider(state: State<'_, AppState>, id: String) -> Result<(), String> {
    svc::delete(&state.db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_provider(state: State<'_, AppState>, id: String, name: String) -> Result<(), String> {
    svc::update(&state.db, &id, &name).map_err(|e| e.to_string())
}

/// 新增/更新某协议端点(anthropic / openai / gemini)
#[tauri::command]
pub fn upsert_provider_endpoint(
    state: State<'_, AppState>,
    id: String,
    protocol: Protocol,
    base_url: String,
) -> Result<(), String> {
    svc::upsert_endpoint(&state.db, &id, protocol, &base_url).map_err(|e| e.to_string())
}

/// 移除某协议端点(至少保留一个)
#[tauri::command]
pub fn remove_provider_endpoint(
    state: State<'_, AppState>,
    id: String,
    protocol: Protocol,
) -> Result<(), String> {
    svc::remove_endpoint(&state.db, &id, protocol).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_provider_key(
    state: State<'_, AppState>,
    id: String,
    api_key: String,
) -> Result<(), String> {
    svc::set_api_key(&state.db, &id, &api_key).map_err(|e| e.to_string())
}

/// 连通性测试:向该供应商对应协议端点发一个最小请求,返回状态/延迟。
#[tauri::command]
pub async fn test_provider(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    app_type: AppType,
) -> Result<svc::TestResult, String> {
    let r = svc::test_provider(&state.db, &id, app_type)
        .await
        .map_err(|e| e.to_string())?;
    // 测速结果落库(meta.last_test)→ 托盘 ✗ 标记即时刷新
    let _ = crate::rebuild_tray_menu(&app);
    Ok(r)
}

/// 批量连通性测试:该分组全部供应商并发测速。
#[tauri::command]
pub async fn test_all_providers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    app_type: AppType,
) -> Result<Vec<svc::BatchTestItem>, String> {
    let r = svc::test_all_providers(&state.db, app_type)
        .await
        .map_err(|e| e.to_string())?;
    let _ = crate::rebuild_tray_menu(&app);
    Ok(r)
}

/// Responses 桥接开关:开启后该供应商把 Codex 的 /v1/responses 请求
/// 转成 chat/completions 转发(适用于不支持 Responses API 的中转站)。
#[tauri::command]
pub fn set_responses_bridge(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let key = format!("responses.bridge.{id}");
    if enabled {
        crate::db::kv::set(&state.db, &key, "1").map_err(|e| e.to_string())
    } else {
        crate::db::kv::del(&state.db, &key).map_err(|e| e.to_string())
    }
}

/// 拖拽排序:按 id 顺序写 sort_index
#[tauri::command]
pub fn reorder_providers(state: State<'_, AppState>, ids: Vec<String>) -> Result<(), String> {
    crate::db::provider_dao::reorder(&state.db, &ids).map_err(|e| e.to_string())
}

/// 读取 /v1/responses 桥接开关(某供应商)。
#[tauri::command]
pub fn get_responses_bridge(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    Ok(
        crate::db::kv::get(&state.db, &format!("responses.bridge.{id}"))
            .map_err(|e| e.to_string())?
            .as_deref()
            == Some("1"),
    )
}

/// 供应商余额:依次尝试 OpenRouter 兼容(/auth/key)与 OpenAI 计费端点
/// (/dashboard/billing/*,one-api/new-api 系中转均实现),两者都不支持才报错。
#[tauri::command]
pub async fn get_provider_balance(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let (pool, provider) = {
        let db = state.inner().db.clone();
        let p = provider_dao::get_by_id(&db, &id).map_err(|e| e.to_string())?;
        (db, p)
    };
    let p = provider.ok_or("provider not found")?;
    let key = crate::services::keys::load_async(&pool, &p).await;
    let key = key.filter(|k| !k.is_empty()).ok_or("no api key")?;
    let base = p
        .endpoints
        .get("openai")
        .cloned()
        .unwrap_or_else(|| p.base_url.clone());
    // 以 /v1 结尾的端点直接拼子路径,否则补 /v1 前缀
    let v1 = {
        let b = base.trim_end_matches('/');
        if b.ends_with("/v1") {
            b.to_string()
        } else {
            format!("{b}/v1")
        }
    };
    let client = reqwest::Client::new();
    let timeout = std::time::Duration::from_secs(10);

    // 1) OpenRouter 兼容:GET /auth/key → {data:{label,usage,limit,is_free_tier}}
    if let Ok(resp) = client
        .get(format!("{v1}/auth/key"))
        .bearer_auth(&key)
        .timeout(timeout)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<serde_json::Value>().await {
                if let Some(d) = v.get("data") {
                    return Ok(serde_json::json!({
                        "label": d.get("label").cloned().unwrap_or(serde_json::Value::Null),
                        "usage": d.get("usage").and_then(|x| x.as_f64()),
                        "limit": d.get("limit").and_then(|x| x.as_f64()),
                        "is_free_tier": d.get("is_free_tier").and_then(|x| x.as_bool()).unwrap_or(false),
                    }));
                }
            }
        }
    }

    // 2) OpenAI 计费端点:subscription → 总额度;usage → 已用(美分)
    let sub = client
        .get(format!("{v1}/dashboard/billing/subscription"))
        .bearer_auth(&key)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !sub.status().is_success() {
        return Err(format!("HTTP {}", sub.status()));
    }
    let sub_v: serde_json::Value = sub.json().await.map_err(|e| e.to_string())?;
    let limit = sub_v
        .get("hard_limit_usd")
        .and_then(|x| x.as_f64())
        .or_else(|| sub_v.get("system_hard_limit_usd").and_then(|x| x.as_f64()))
        // one-api/new-api 未设额度时返回 1e8 哨兵值,视为无上限,不展示
        .filter(|l| *l < 99_999_999.0);
    let usage = match client
        .get(format!("{v1}/dashboard/billing/usage"))
        .bearer_auth(&key)
        .timeout(timeout)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("total_usage").and_then(|x| x.as_f64()))
            .map(|cents| cents / 100.0),
        _ => None,
    };
    if usage.is_none() && limit.is_none() {
        return Err("not_supported".into());
    }
    Ok(serde_json::json!({
        "label": serde_json::Value::Null,
        "usage": usage,
        "limit": limit,
        "is_free_tier": false,
    }))
}

/// 更新供应商模型列表(逗号分隔字符串)。
#[tauri::command]
pub fn set_provider_models(
    state: State<'_, AppState>,
    id: String,
    models: Vec<String>,
) -> Result<(), String> {
    provider_dao::set_models(&state.db, &id, &models).map_err(|e| e.to_string())
}

/// 故障转移候选链(名称序):仅当该分组开启 failover 时返回,否则空数组。
#[tauri::command]
pub fn get_failover_chain(
    state: State<'_, AppState>,
    app_type: AppType,
) -> Result<Vec<String>, String> {
    let on = crate::db::kv::get(&state.db, &format!("failover:{}", app_type.as_str()))
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("1");
    if !on {
        return Ok(vec![]);
    }
    Ok(provider_dao::failover_candidates(&state.db, app_type)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|p| p.name)
        .collect())
}

/// 近 1 小时错误率超 30% 的供应商(≥5 次请求才统计),首页告警横幅用。
#[tauri::command]
pub fn get_degraded_providers(
    state: State<'_, AppState>,
    app_type: AppType,
) -> Result<Vec<serde_json::Value>, String> {
    Ok(
        crate::db::usage_dao::recent_error_rates(&state.db, app_type.as_str())
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|(_, total, errs)| *errs as f64 / *total as f64 > 0.3)
            .map(|(pid, total, errs)| {
                let name = provider_dao::get_by_id(&state.db, &pid)
                    .ok()
                    .flatten()
                    .map(|p| p.name)
                    .unwrap_or_else(|| pid.clone());
                serde_json::json!({ "id": pid, "name": name, "total": total, "errors": errs })
            })
            .collect(),
    )
}
