//! Provider 数据访问层。
//!
//! 所有读写经 r2d2 池获取连接。`Provider` 行与 [`crate::types::Provider`] 的映射在此完成;
//! 注意 DB 里 `models` / `endpoints` 以 JSON 字符串存储,读取时反序列化。
//!
//! v2 语义:供应商是跨分组的逻辑实体(一行 = 一个商家,`endpoints` 存各协议端点);
//! "某分组的当前供应商"存于 `current_map` 表,`providers.is_current` 列停用(恒 0)。

use anyhow::{anyhow, Result};
use rusqlite::{params, Row};

use crate::db::{Pool, PooledConn};
use crate::types::{AppType, Protocol, Provider};

const PROVIDER_COLS: &str = "id, app_type, name, base_url, keychain_id, models, is_current,
                is_healthy, sort_index, created_at, endpoints, meta";

fn row_to_provider(row: &Row<'_>) -> rusqlite::Result<Provider> {
    let app_type_str: String = row.get("app_type")?;
    let models_json: String = row.get("models")?;
    let models: Vec<String> = serde_json::from_str(&models_json).unwrap_or_default();
    let endpoints_json: String = row.get("endpoints")?;
    let endpoints: std::collections::HashMap<String, String> =
        serde_json::from_str(&endpoints_json).unwrap_or_default();
    // meta.has_key 落库后启动无需查 keychain(未签名二进制每次读取都可能弹授权框)
    let meta_json: String = row.get("meta")?;
    let meta: serde_json::Value =
        serde_json::from_str(&meta_json).unwrap_or_else(|_| serde_json::json!({}));
    let meta_has_key: Option<bool> = meta.get("has_key").and_then(|v| v.as_bool());
    let last_test: Option<crate::types::LastTest> = meta
        .get("last_test")
        .and_then(|v| serde::Deserialize::deserialize(v).ok());
    Ok(Provider {
        id: row.get("id")?,
        app_type: AppType::from_str(&app_type_str).unwrap_or(AppType::Claude),
        name: row.get("name")?,
        base_url: row.get("base_url")?,
        endpoints,
        keychain_id: row.get("keychain_id")?,
        models,
        is_current: row.get::<_, i64>("is_current")? != 0,
        is_healthy: row.get::<_, i64>("is_healthy")? != 0,
        sort_index: row.get("sort_index")?,
        created_at: row.get("created_at")?,
        has_key: meta_has_key.unwrap_or(false), // 运行时由 service 层按 meta/keychain 填充
        meta_has_key,
        last_test,
    })
}

/// 全部供应商(跨分组)。is_current 恒 false,由 list_by_app/get_current 结合 current_map 计算。
pub fn list_all(pool: &Pool) -> Result<Vec<Provider>> {
    let conn = get_conn(pool)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROVIDER_COLS} FROM providers ORDER BY sort_index, created_at"
    ))?;
    let rows = stmt.query_map([], row_to_provider)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 指定分组的供应商视图:返回全部供应商(is_current 按 current_map 标注)。
/// 前端依据 endpoints 是否包含该分组协议的端点决定置灰。
pub fn list_by_app(pool: &Pool, app: AppType) -> Result<Vec<Provider>> {
    let conn = get_conn(pool)?;
    let current_id: Option<String> = conn
        .query_row(
            "SELECT provider_id FROM current_map WHERE app_type = ?1",
            params![app.as_str()],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| {
            if e == rusqlite::Error::QueryReturnedNoRows {
                Ok(None)
            } else {
                Err(e)
            }
        })?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROVIDER_COLS} FROM providers ORDER BY sort_index, created_at"
    ))?;
    let rows = stmt.query_map([], row_to_provider)?;
    let mut list: Vec<Provider> = rows
        .filter_map(|r| r.ok())
        .map(|mut p| {
            if let Some(cid) = &current_id {
                p.is_current = &p.id == cid;
            }
            p
        })
        .collect();
    // 当前供应商置顶,其余保持排序
    list.sort_by_key(|p| !p.is_current);
    Ok(list)
}

pub fn get_by_id(pool: &Pool, id: &str) -> Result<Option<Provider>> {
    let conn = get_conn(pool)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROVIDER_COLS} FROM providers WHERE id = ?1"
    ))?;
    let mut rows = stmt.query_map(params![id], row_to_provider)?;
    Ok(rows.next().and_then(|r| r.ok()))
}

pub fn insert(pool: &Pool, p: &Provider) -> Result<()> {
    let conn = get_conn(pool)?;
    let models_json = serde_json::to_string(&p.models).unwrap_or_else(|_| "[]".into());
    let endpoints_json = serde_json::to_string(&p.endpoints).unwrap_or_else(|_| "{}".into());
    let meta_json = format!(r#"{{"has_key":{}}}"#, p.has_key);
    conn.execute(
        "INSERT INTO providers
            (id, app_type, name, base_url, keychain_id, models, is_current,
             is_healthy, sort_index, created_at, meta, endpoints)
         VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8,?9,?10,?11)",
        params![
            p.id,
            p.app_type.as_str(),
            p.name,
            p.base_url,
            p.keychain_id,
            models_json,
            p.is_healthy as i64,
            p.sort_index,
            p.created_at,
            meta_json,
            endpoints_json,
        ],
    )?;
    Ok(())
}

/// 持久化 `has_key` 标记到 meta 列(避免后续启动查 keychain)。
pub fn set_meta_has_key(pool: &Pool, id: &str, has_key: bool) -> Result<()> {
    let conn = get_conn(pool)?;
    let meta_json: String = conn
        .query_row(
            "SELECT meta FROM providers WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| anyhow!("供应商不存在: {id}"))?;
    let mut meta: serde_json::Value =
        serde_json::from_str(&meta_json).unwrap_or_else(|_| serde_json::json!({}));
    meta["has_key"] = serde_json::json!(has_key);
    let affected = conn.execute(
        "UPDATE providers SET meta = ?2 WHERE id = ?1",
        params![id, meta.to_string()],
    )?;
    if affected == 0 {
        return Err(anyhow!("供应商不存在: {id}"));
    }
    Ok(())
}

/// 持久化最近一次测速结果到 meta 列。
pub fn set_meta_last_test(pool: &Pool, id: &str, t: &crate::types::LastTest) -> Result<()> {
    let conn = get_conn(pool)?;
    let meta_json: String = conn
        .query_row(
            "SELECT meta FROM providers WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| anyhow!("供应商不存在: {id}"))?;
    let mut meta: serde_json::Value =
        serde_json::from_str(&meta_json).unwrap_or_else(|_| serde_json::json!({}));
    meta["last_test"] = serde_json::to_value(t)?;
    let affected = conn.execute(
        "UPDATE providers SET meta = ?2 WHERE id = ?1",
        params![id, meta.to_string()],
    )?;
    if affected == 0 {
        return Err(anyhow!("供应商不存在: {id}"));
    }
    Ok(())
}

/// 按名称查找(归一:忽略大小写与首尾空白)
pub fn find_by_name(pool: &Pool, name: &str) -> Result<Option<Provider>> {
    let conn = get_conn(pool)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROVIDER_COLS} FROM providers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?1)) LIMIT 1"
    ))?;
    let mut rows = stmt.query_map(params![name], row_to_provider)?;
    Ok(rows.next().and_then(|r| r.ok()))
}

/// 新增/更新某协议的端点(写 endpoints JSON;base_url 同步为首个端点)
pub fn upsert_endpoint(pool: &Pool, id: &str, protocol: Protocol, base_url: &str) -> Result<()> {
    let conn = get_conn(pool)?;
    let mut p = {
        let mut stmt = conn.prepare(&format!(
            "SELECT {PROVIDER_COLS} FROM providers WHERE id = ?1"
        ))?;
        let mut rows = stmt.query_map(params![id], row_to_provider)?;
        rows.next()
            .and_then(|r| r.ok())
            .ok_or_else(|| anyhow!("供应商不存在: {id}"))?
    };
    p.endpoints
        .insert(protocol.as_str().to_string(), base_url.to_string());
    let endpoints_json = serde_json::to_string(&p.endpoints)?;
    let primary = p
        .endpoints
        .get(Protocol::Anthropic.as_str())
        .or_else(|| p.endpoints.values().next())
        .cloned()
        .unwrap_or_default();
    let affected = conn.execute(
        "UPDATE providers SET endpoints = ?2, base_url = ?3 WHERE id = ?1",
        params![id, endpoints_json, primary],
    )?;
    if affected == 0 {
        return Err(anyhow!("供应商不存在: {id}"));
    }
    Ok(())
}

/// 移除某协议的端点(至少保留一个,否则报错)
pub fn remove_endpoint(pool: &Pool, id: &str, protocol: Protocol) -> Result<()> {
    let conn = get_conn(pool)?;
    let mut p = {
        let mut stmt = conn.prepare(&format!(
            "SELECT {PROVIDER_COLS} FROM providers WHERE id = ?1"
        ))?;
        let mut rows = stmt.query_map(params![id], row_to_provider)?;
        rows.next()
            .and_then(|r| r.ok())
            .ok_or_else(|| anyhow!("供应商不存在: {id}"))?
    };
    if p.endpoints.len() <= 1 {
        return Err(anyhow!("至少保留一个端点"));
    }
    p.endpoints.remove(protocol.as_str());
    let endpoints_json = serde_json::to_string(&p.endpoints)?;
    conn.execute(
        "UPDATE providers SET endpoints = ?2 WHERE id = ?1",
        params![id, endpoints_json],
    )?;
    Ok(())
}

/// 切换当前供应商:写 current_map(同分组仅一个)。
pub fn set_current(pool: &Pool, id: &str, app: AppType) -> Result<()> {
    let mut conn = get_conn(pool)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT OR REPLACE INTO current_map (app_type, provider_id) VALUES (?1, ?2)",
        params![app.as_str(), id],
    )?;
    // 校验供应商存在
    let exists: bool = tx
        .query_row(
            "SELECT COUNT(1) FROM providers WHERE id = ?1",
            params![id],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;
    if !exists {
        return Err(anyhow!("未找到供应商 {id} (app={})", app.as_str()));
    }
    tx.commit()?;
    Ok(())
}

/// 删除供应商。若它是某分组的当前供应商,同分组内自动顶替:
/// 按 sort_index 顺序取下一个「有 Key 且有可用端点」的供应商(判定与故障转移
/// 候选链一致),避免长跑 CLI 因指针悬空收到一片 502;无可顶替者才悬空。
pub fn delete(pool: &Pool, id: &str) -> Result<()> {
    let mut conn = get_conn(pool)?;
    let tx = conn.transaction()?;
    let mut stmt = tx.prepare("SELECT app_type FROM current_map WHERE provider_id = ?1")?;
    let current_apps: Vec<String> = stmt
        .query_map(params![id], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    tx.execute("DELETE FROM providers WHERE id = ?1", params![id])?;
    tx.execute(
        "DELETE FROM current_map WHERE provider_id = ?1",
        params![id],
    )?;
    for app in current_apps {
        match current_successor(&tx, &app)? {
            Some(successor) => {
                tx.execute(
                    "INSERT OR REPLACE INTO current_map (app_type, provider_id) VALUES (?1, ?2)",
                    params![app, successor.id],
                )?;
                tracing::info!(
                    app = %app,
                    deleted = %id,
                    successor = %successor.id,
                    "删除了当前供应商,同分组自动顶替"
                );
            }
            None => tracing::warn!(app = %app, "删除当前供应商后无可顶替者,分组当前供应商悬空"),
        }
    }
    tx.commit()?;
    Ok(())
}

/// 在删除事务内选出 app 分组的顶替者:有 Key(api_keys 行或 meta 标记)且
/// 有端点,按 sort_index, created_at 排序取第一个。
fn current_successor(tx: &rusqlite::Transaction<'_>, app: &str) -> Result<Option<Provider>> {
    let mut stmt = tx.prepare(&format!(
        "SELECT {PROVIDER_COLS}
         FROM providers WHERE app_type = ?1
         ORDER BY sort_index, created_at"
    ))?;
    let candidates: Vec<Provider> = stmt
        .query_map(params![app], row_to_provider)?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    if candidates.is_empty() {
        return Ok(None);
    }
    let ids: Vec<String> = candidates.iter().map(|p| p.id.clone()).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut key_stmt = tx.prepare(&format!(
        "SELECT provider_id FROM api_keys WHERE provider_id IN ({placeholders})"
    ))?;
    let with_key: std::collections::HashSet<String> = key_stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            r.get::<_, String>(0)
        })?
        .filter_map(|r| r.ok())
        .collect();
    let protocol = crate::types::AppType::from_str(app)
        .unwrap_or(crate::types::AppType::Claude)
        .protocol();
    Ok(candidates
        .into_iter()
        .find(|p| {
            (p.has_key || p.meta_has_key == Some(true) || with_key.contains(&p.id))
                && (p.endpoint(protocol).is_some() || !p.base_url.trim().is_empty())
        }))
}

/// 更新供应商名称。
pub fn update(pool: &Pool, id: &str, name: &str) -> Result<()> {
    let conn = get_conn(pool)?;
    let affected = conn.execute(
        "UPDATE providers SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    if affected == 0 {
        return Err(anyhow!("供应商不存在: {id}"));
    }
    Ok(())
}

/// 读取指定分组的当前供应商(代理转发时使用)。
pub fn get_current(pool: &Pool, app: AppType) -> Result<Option<Provider>> {
    let conn = get_conn(pool)?;
    let current_id: Option<String> = conn
        .query_row(
            "SELECT provider_id FROM current_map WHERE app_type = ?1",
            params![app.as_str()],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| {
            if e == rusqlite::Error::QueryReturnedNoRows {
                Ok(None)
            } else {
                Err(e)
            }
        })?;
    let Some(id) = current_id else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROVIDER_COLS} FROM providers WHERE id = ?1"
    ))?;
    let mut rows = stmt.query_map(params![id], row_to_provider)?;
    Ok(rows.next().and_then(|r| r.ok()))
}

fn get_conn(pool: &Pool) -> Result<PooledConn> {
    pool.get().map_err(|e| anyhow!("获取数据库连接失败: {e}"))
}

/// 故障转移候选:当前供应商 + 其余已配置 Key 且**具备该分组协议端点**的供应商,上限 3。
pub fn failover_candidates(pool: &Pool, app: AppType) -> Result<Vec<Provider>> {
    let conn = get_conn(pool)?;
    let current_id: Option<String> = conn
        .query_row(
            "SELECT provider_id FROM current_map WHERE app_type = ?1",
            params![app.as_str()],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| {
            if e == rusqlite::Error::QueryReturnedNoRows {
                Ok(None)
            } else {
                Err(e)
            }
        })?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROVIDER_COLS}
         FROM providers
         ORDER BY sort_index, created_at"
    ))?;
    let rows = stmt.query_map([], row_to_provider)?;
    let protocol = app.protocol();
    let mut list: Vec<Provider> = rows
        .filter_map(|r| r.ok())
        .filter(|p| p.endpoint(protocol).is_some() || !p.base_url.trim().is_empty())
        .collect();
    drop(stmt);
    drop(conn);
    // 有 Key 才进故障转移链:keychain_id 自 v4 起不再代表 Key 存在
    // (备份导入的行是 None,创建时即使没填 Key 也是 Some),
    // 以加密库 api_keys 为准(meta.has_key 标记兜底,省一次查询)。
    let ids: Vec<String> = list.iter().map(|p| p.id.clone()).collect();
    let with_key: std::collections::HashSet<String> = if ids.is_empty() {
        Default::default()
    } else {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let conn2 = get_conn(pool)?;
        let mut stmt2 = conn2.prepare(&format!(
            "SELECT provider_id FROM api_keys WHERE provider_id IN ({placeholders})"
        ))?;
        let set: std::collections::HashSet<String> = stmt2
            .query_map(rusqlite::params_from_iter(ids.iter()), |r| {
                r.get::<_, String>(0)
            })?
            .filter_map(|r| r.ok())
            .collect();
        set
    };
    list.retain(|p| {
        Some(&p.id) == current_id.as_ref()
            || p.has_key
            || p.meta_has_key == Some(true)
            || with_key.contains(&p.id)
    });
    // 当前供应商优先(无条件入链:没配 Key 也不该把"仅剩的当前"排除掉)
    if let Some(cid) = &current_id {
        if let Some(pos) = list.iter().position(|p| &p.id == cid) {
            let cur = list.remove(pos);
            list.insert(0, cur);
        }
    }
    list.truncate(3);
    Ok(list)
}

/// 按传入 id 顺序重排(sort_index = 下标)。仅更新存在的 id。
pub fn reorder(pool: &Pool, ids: &[String]) -> Result<()> {
    let mut conn = get_conn(pool)?;
    let tx = conn.transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE providers SET sort_index = ?1 WHERE id = ?2",
            params![i as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 更新模型列表(卡片展示/CLI 提示用,不参与路由)。
pub fn set_models(pool: &Pool, id: &str, models: &[String]) -> Result<()> {
    let conn = get_conn(pool)?;
    let models_json = serde_json::to_string(models)?;
    let affected = conn.execute(
        "UPDATE providers SET models = ?2 WHERE id = ?1",
        params![id, models_json],
    )?;
    if affected == 0 {
        return Err(anyhow!("供应商不存在: {id}"));
    }
    Ok(())
}

#[cfg(test)]
mod delete_tests {
    use super::*;
    use crate::services::provider::create;
    use crate::types::ProviderInput;
    use std::path::PathBuf;

    fn test_pool(tag: &str) -> (Pool, PathBuf) {
        let directory =
            std::env::temp_dir().join(format!("keyway_dao_{tag}_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("keyway.db");
        let pool = crate::db::init_pool(&path, &"0".repeat(64)).unwrap();
        (pool, directory)
    }

    fn input(name: &str, key: Option<&str>) -> ProviderInput {
        ProviderInput {
            app_type: AppType::Claude,
            name: name.into(),
            base_url: format!("https://{name}.example/v1"),
            models: vec![],
            api_key: key.map(str::to_string),
        }
    }

    #[test]
    fn deleting_current_promotes_next_keyed_provider() {
        let (pool, directory) = test_pool("promote_keyed");
        let a = create(&pool, input("A", Some("key-a"))).unwrap();
        let b = create(&pool, input("B", None)).unwrap();
        let c = create(&pool, input("C", Some("key-c"))).unwrap();
        reorder(&pool, &[a.id.clone(), b.id.clone(), c.id.clone()]).unwrap();
        assert_eq!(get_current(&pool, AppType::Claude).unwrap().unwrap().name, "A");

        delete(&pool, &a.id).unwrap();

        // B 排序在前但没有 Key,顶替者必须是有 Key 的 C
        let current = get_current(&pool, AppType::Claude).unwrap().unwrap();
        assert_eq!(current.name, "C");

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn deleting_current_without_keyed_successor_leaves_current_empty() {
        let (pool, directory) = test_pool("promote_none");
        let a = create(&pool, input("A", Some("key-a"))).unwrap();
        let b = create(&pool, input("B", None)).unwrap();
        reorder(&pool, &[a.id.clone(), b.id.clone()]).unwrap();

        delete(&pool, &a.id).unwrap();

        // 唯一候选 B 没有 Key,宁可直接悬空也不路由到注定失败的供应商
        assert!(get_current(&pool, AppType::Claude).unwrap().is_none());

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn deleting_non_current_keeps_current() {
        let (pool, directory) = test_pool("keep_current");
        let a = create(&pool, input("A", Some("key-a"))).unwrap();
        let b = create(&pool, input("B", Some("key-b"))).unwrap();
        reorder(&pool, &[a.id.clone(), b.id.clone()]).unwrap();

        delete(&pool, &b.id).unwrap();

        let current = get_current(&pool, AppType::Claude).unwrap().unwrap();
        assert_eq!(current.name, "A");

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn deleting_last_provider_clears_current() {
        let (pool, directory) = test_pool("last");
        let a = create(&pool, input("A", Some("key-a"))).unwrap();

        delete(&pool, &a.id).unwrap();

        assert!(get_current(&pool, AppType::Claude).unwrap().is_none());
        assert!(list_all(&pool).unwrap().is_empty());

        drop(pool);
        let _ = std::fs::remove_dir_all(directory);
    }
}
