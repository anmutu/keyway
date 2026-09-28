//! 配置导出/导入:供应商、路由规则与预设的可移植 JSON(不含 API Key 与用量)。

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::db::{kv, provider_dao, route_dao};
use crate::state::AppState;
use crate::types::{AppType, ProviderInput};

const CONFIG_KEYS: [&str; 3] = ["route.", "responses.bridge.", "failover:"];

fn profile_names(providers: &[crate::types::Provider], raw: Option<&str>) -> Value {
    let Some(profiles) = raw.and_then(|value| serde_json::from_str::<Value>(value).ok()) else {
        return json!({});
    };
    let by_id: std::collections::HashMap<&str, &str> = providers
        .iter()
        .map(|provider| (provider.id.as_str(), provider.name.as_str()))
        .collect();
    let mut output = json!({});
    if let Some(profile_map) = profiles.as_object() {
        for (name, apps) in profile_map {
            let mut app_map = json!({});
            if let Some(apps) = apps.as_object() {
                for (app, provider_id) in apps {
                    if let Some(provider_name) =
                        provider_id.as_str().and_then(|id| by_id.get(id).copied())
                    {
                        app_map[app] = json!(provider_name);
                    }
                }
            }
            output[name] = app_map;
        }
    }
    output
}

fn build_config(state: &AppState) -> Result<Value, String> {
    let provider_records = provider_dao::list_all(&state.db).map_err(|e| e.to_string())?;
    let providers: Vec<Value> = provider_records
        .iter()
        .map(|p| {
            let pid = p.id.clone();
            json!({
                "app_type": p.app_type, "name": p.name, "id": pid,
                "base_url": p.base_url, "endpoints": p.endpoints,
            })
        })
        .collect();
    let mut rules = Vec::new();
    for app in [AppType::Claude, AppType::Codex, AppType::Gemini] {
        for r in route_dao::list_by_app(&state.db, app.as_str()).map_err(|e| e.to_string())? {
            rules.push(json!({
                "app": app.as_str(), "pattern": r.pattern, "provider_id": r.provider_id,
                "match_type": r.match_type, "enabled": r.enabled,
                "fallback_provider": r.fallback_provider_id, "priority": r.priority,
            }));
        }
    }
    let presets: Vec<Value> = kv::all(&state.db)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|(k, _)| CONFIG_KEYS.iter().any(|p| k.starts_with(p)))
        .map(|(k, v)| json!({ "key": k, "value": v }))
        .collect();
    // 配置档案:name → {app → 供应商名}(用名称而非 ID,导入端可移植)
    let profiles = profile_names(
        &provider_records,
        kv::get(&state.db, "profiles")
            .map_err(|e| e.to_string())?
            .as_deref(),
    );
    Ok(
        json!({ "format": "keyway-config", "version": 1, "providers": providers,
                "route_rules": rules, "presets": presets, "profiles": profiles }),
    )
}

#[tauri::command]
pub fn export_config(
    app: AppHandle,
    state: State<'_, AppState>,
    target: Option<String>,
) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| e.to_string())?;
    let path = match target {
        Some(t) if !t.trim().is_empty() => std::path::PathBuf::from(t),
        _ => dir.join("keyway-config.json"),
    };
    let cfg = build_config(&state)?;
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn import_config(
    state: State<'_, AppState>,
    path: String,
) -> Result<(usize, usize, usize), String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let cfg: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    do_import(&state.db, &cfg)
}

fn do_import(db: &crate::db::Pool, cfg: &Value) -> Result<(usize, usize, usize), String> {
    let state_db = db;
    if cfg.get("format").and_then(|f| f.as_str()) != Some("keyway-config") {
        return Err("不是 Keyway 配置文件".into());
    }
    // 供应商:按 (app_type, name) 去重,导入后名称里的 ID 引用通过 name 映射回本机 ID
    let mut id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut created = 0usize;
    for p in cfg
        .get("providers")
        .and_then(|v| v.as_array())
        .unwrap_or(&vec![])
    {
        let app: AppType =
            serde_json::from_value(p["app_type"].clone()).map_err(|e| e.to_string())?;
        let name = p["name"].as_str().unwrap_or("").trim().to_string();
        if name.is_empty() {
            continue;
        }
        let existing = provider_dao::find_by_name(state_db, &name)
            .map_err(|e| e.to_string())?
            .filter(|x| x.app_type == app);
        let is_new = existing.is_none();
        let pid = match existing {
            Some(x) => x.id,
            None => {
                let input = ProviderInput {
                    app_type: app,
                    name: name.clone(),
                    base_url: p["base_url"].as_str().unwrap_or("").to_string(),
                    models: vec![],
                    api_key: None,
                };
                crate::services::provider::create(state_db, input)
                    .map_err(|e| e.to_string())?
                    .id
            }
        };
        // 端点逐协议补配(已存在时也同步,不覆盖 Key)
        if let Some(eps) = p.get("endpoints").and_then(|v| v.as_object()) {
            for (proto, url) in eps {
                if let (Ok(protocol), Some(u)) = (
                    serde_json::from_value::<crate::types::Protocol>(json!(proto)),
                    url.as_str(),
                ) {
                    if !u.trim().is_empty() {
                        provider_dao::upsert_endpoint(state_db, &pid, protocol, u)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        if let Some(src_id) = p.get("id").and_then(|x| x.as_str()) {
            id_map.insert(src_id.to_string(), pid.clone());
        }
        if is_new {
            created += 1;
        }
    }
    // 路由规则:同名供应商映射回本机 ID;与本机已有规则(同 app/pattern/供应商/匹配方式)重复时跳过
    let mut rules_added = 0usize;
    let mut rules_skipped = 0usize;
    let mut existing_cache: std::collections::HashMap<
        String,
        std::collections::HashSet<(String, String, String)>,
    > = std::collections::HashMap::new();
    for r in cfg
        .get("route_rules")
        .and_then(|v| v.as_array())
        .unwrap_or(&vec![])
    {
        let app_str = r["app"].as_str().unwrap_or("claude");
        let app: AppType = serde_json::from_value(json!(app_str)).map_err(|e| e.to_string())?;
        let src_pid = r["provider_id"].as_str().unwrap_or("");
        let Some(pid) = id_map.get(src_pid).cloned() else {
            continue;
        };
        let mt = r["match_type"].as_str().unwrap_or("contains").to_string();
        let pattern = r["pattern"].as_str().unwrap_or("").to_string();
        let app_key = app.as_str().to_string();
        if !existing_cache.contains_key(&app_key) {
            let seen = route_dao::list_by_app(state_db, app.as_str())
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|x| (x.pattern, x.provider_id, x.match_type))
                .collect();
            existing_cache.insert(app_key.clone(), seen);
        }
        let seen = existing_cache
            .get_mut(&app_key)
            .ok_or_else(|| format!("无法初始化 {app_key} 路由缓存"))?;
        let key = (pattern.clone(), pid.clone(), mt.clone());
        if seen.contains(&key) {
            rules_skipped += 1;
            continue;
        }
        route_dao::insert(state_db, app.as_str(), &pattern, &pid, &mt)
            .map_err(|e| e.to_string())?;
        seen.insert(key);
        rules_added += 1;
    }
    // 预设:provider_id 是导出机器上的 ID;本机不存在同名映射时跳过(值里的 ID 无法对应)
    for kv_item in cfg
        .get("presets")
        .and_then(|v| v.as_array())
        .unwrap_or(&vec![])
    {
        let key = kv_item["key"].as_str().unwrap_or("").to_string();
        let val = kv_item["value"].as_str().unwrap_or("").to_string();
        // 形态一:JSON 值内嵌 provider_id
        if let Ok(v) = serde_json::from_str::<Value>(&val) {
            if let Some(pid) = v.get("provider_id").and_then(|x| x.as_str()) {
                if provider_dao::get_by_id(state_db, pid)
                    .map_err(|e| e.to_string())?
                    .is_none()
                {
                    continue;
                }
            }
        }
        // 形态二:纯字符串值就是 provider_id
        if !val.starts_with('{')
            && provider_dao::get_by_id(state_db, &val)
                .map_err(|e| e.to_string())?
                .is_none()
            && key.starts_with("route.")
        {
            continue;
        }
        kv::set(state_db, &key, &val).map_err(|e| e.to_string())?;
    }
    // 配置档案:按名称解析回本机 ID(供应商缺失的分组条目丢弃)
    if let Some(ps) = cfg.get("profiles").and_then(|v| v.as_object()) {
        let by_name: std::collections::HashMap<String, String> = provider_dao::list_all(db)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|p| (format!("{}:{}", p.app_type.as_str(), p.name), p.id))
            .collect();
        let mut out = serde_json::Map::new();
        for (name, apps) in ps {
            let mut m = serde_json::Map::new();
            if let Some(apps) = apps.as_object() {
                for (app, pname) in apps {
                    if let Some(pid) = pname
                        .as_str()
                        .and_then(|n| by_name.get(&format!("{app}:{n}")))
                    {
                        m.insert(app.clone(), json!(pid));
                    }
                }
            }
            if !m.is_empty() {
                out.insert(name.clone(), Value::Object(m));
            }
        }
        if !out.is_empty() {
            kv::set(db, "profiles", &Value::Object(out).to_string()).map_err(|e| e.to_string())?;
        }
    }
    Ok((created, rules_added, rules_skipped))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> crate::db::Pool {
        let dir = std::env::temp_dir().join(format!("cfg_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        crate::db::init_pool(dir.join("t.db"), &"ab".repeat(32)).unwrap()
    }

    #[test]
    fn profile_export_uses_loaded_provider_records() {
        let providers = vec![crate::types::Provider {
            id: "known".into(),
            app_type: AppType::Claude,
            name: "Known provider".into(),
            base_url: "http://known".into(),
            keychain_id: None,
            endpoints: std::collections::HashMap::new(),
            models: vec![],
            is_current: false,
            is_healthy: true,
            sort_index: 0,
            created_at: 0,
            has_key: false,
            meta_has_key: None,
            last_test: None,
        }];

        let exported = profile_names(
            &providers,
            Some(r#"{"work":{"claude":"known","codex":"missing"}}"#),
        );

        assert_eq!(exported["work"]["claude"], "Known provider");
        assert!(exported["work"].get("codex").is_none());
    }

    #[test]
    fn export_import_roundtrip() {
        let pool = db();
        let state = crate::state::AppState::new(pool.clone());
        // 两个供应商 + 一条规则 + 一个预设
        crate::db::provider_dao::insert(
            &pool,
            &crate::types::Provider {
                id: "src-a".into(),
                app_type: AppType::Claude,
                name: "RelayA".into(),
                base_url: "http://a".into(),
                keychain_id: None,
                endpoints: [("openai".to_string(), "http://a/v1".to_string())]
                    .into_iter()
                    .collect(),
                models: vec![],
                is_current: true,
                is_healthy: true,
                sort_index: 0,
                created_at: 0,
                has_key: false,
                meta_has_key: None,
                last_test: None,
            },
        )
        .unwrap();
        crate::db::route_dao::insert(&pool, "claude", "deep", "src-a", "contains").unwrap();
        kv::set(&pool, "responses.bridge.src-a", "1").unwrap();
        kv::set(&pool, "profiles", r#"{"work":{"claude":"src-a"}}"#).unwrap();

        let cfg = build_config(&state).unwrap();
        assert_eq!(cfg["providers"].as_array().unwrap().len(), 1);
        assert_eq!(cfg["route_rules"].as_array().unwrap().len(), 1);
        assert_eq!(cfg["presets"].as_array().unwrap().len(), 1);
        assert_eq!(cfg["profiles"]["work"]["claude"], "RelayA");
        // 密钥与用量不在导出里
        let raw = cfg.to_string();
        assert!(!raw.contains("api_key"));

        // 全新库导入:按 name 重建,id_map 把规则指到新 ID
        let pool2 = db();
        let path = std::env::temp_dir().join(format!("cfg_{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, &raw).unwrap();
        let (created, rules, skipped) =
            do_import(&pool2, &serde_json::from_str::<Value>(&raw).unwrap()).unwrap();
        assert_eq!(created, 1);
        assert_eq!(rules, 1);
        assert_eq!(skipped, 0);
        // 同一文件重复导入:供应商与规则都不重复,重复规则被跳过并计数
        let (created2, rules2, skipped2) =
            do_import(&pool2, &serde_json::from_str::<Value>(&raw).unwrap()).unwrap();
        assert_eq!(created2, 0);
        assert_eq!(rules2, 0);
        assert_eq!(skipped2, 1);
        let new_p = crate::db::provider_dao::find_by_name(&pool2, "RelayA")
            .unwrap()
            .expect("导入后应存在");
        assert_eq!(
            new_p.endpoints.get("openai").map(String::as_str),
            Some("http://a/v1")
        );
        let rules = crate::db::route_dao::list_by_app(&pool2, "claude").unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].provider_id, new_p.id);
        let bridged = kv::get(&pool2, &format!("responses.bridge.{}", new_p.id)).unwrap();
        // 旧 ID 的预设值在本机无对应供应商 → 被跳过
        assert_ne!(bridged.as_deref(), Some("1"));
        // profile 按名称映射到本机新 ID
        let profiles = kv::get(&pool2, "profiles").unwrap().unwrap();
        assert!(
            profiles.contains(&format!(r#""{}""#, new_p.id)),
            "{profiles}"
        );
    }
}
