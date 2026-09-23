//! takeover 接管:把各 CLI 的 live 配置改写为指向本地代理,实现免重启热切换。
//!
//! 覆盖:Claude / Codex / Gemini / OpenCode / OpenClaw。
//!
//! 安全设计:
//! - 接管前把原始数据备份进加密 DB(settings 表),可随时一键还原
//! - 原子写(临时文件 + rename),中断不损坏配置
//! - 状态三态:active(我们标记过)/ effective(配置当前确实指向代理,
//!   可检测被 CLI 或其他工具覆盖的情况)

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::Serialize;

use crate::db::Pool;
use crate::types::AppType;

/// 本地代理地址(与 core::proxy::PROXY_ADDR 保持一致)
pub const PROXY_URL: &str = "http://127.0.0.1:9527";

fn proxy_url_for(app: AppType) -> String {
    format!("{PROXY_URL}{}", app.proxy_prefix())
}

fn is_restore_proxy_url(value: &str, app: AppType) -> bool {
    value == PROXY_URL || value == proxy_url_for(app)
}

#[derive(Debug, Serialize)]
pub struct TakeoverStatus {
    pub app: String,
    /// 是否支持自动接管(当前覆盖 Claude/Codex/Gemini/OpenCode/OpenClaw)
    pub supported: bool,
    /// live 配置文件是否存在
    pub config_exists: bool,
    /// 已由 Keyway 接管(内部标记)
    pub active: bool,
    /// 配置当前确实指向代理(未被外部覆盖)
    pub effective: bool,
    /// 故障转移开关
    pub failover: bool,
}

// ---------- settings KV ----------

fn settings_get(pool: &Pool, key: &str) -> Result<Option<String>> {
    let conn = pool.get().map_err(|e| anyhow!("{e}"))?;
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query_map(rusqlite::params![key], |r| r.get::<_, String>(0))?;
    Ok(rows.next().and_then(|r| r.ok()))
}

fn settings_set(pool: &Pool, key: &str, value: &str) -> Result<()> {
    let conn = pool.get().map_err(|e| anyhow!("{e}"))?;
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1,?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

fn settings_del(pool: &Pool, key: &str) -> Result<()> {
    let conn = pool.get().map_err(|e| anyhow!("{e}"))?;
    conn.execute(
        "DELETE FROM settings WHERE key = ?1",
        rusqlite::params![key],
    )?;
    Ok(())
}

fn active_key(app: AppType) -> String {
    format!("takeover_active:{}", app.as_str())
}
fn backup_key(app: AppType) -> String {
    format!("takeover_backup:{}", app.as_str())
}

// ---------- 通用:原子写 ----------

fn write_atomic(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("conduit-tmp");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn home_path(rel: &[&str]) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("无法定位用户目录"))?;
    Ok(rel.iter().fold(home, |p, c| p.join(c)))
}

// ---------- Claude: ~/.claude/settings.json ----------

fn claude_settings_path() -> Result<PathBuf> {
    home_path(&[".claude", "settings.json"])
}

/// 备份内容:{"base_url": old-or-null}
pub fn apply_claude_at(path: &Path) -> Result<String> {
    let mut root: serde_json::Value = if path.exists() {
        let raw = std::fs::read_to_string(path)?;
        if raw.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&raw).context("claude settings.json 不是合法 JSON")?
        }
    } else {
        serde_json::json!({})
    };
    let old = root
        .get("env")
        .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let backup = serde_json::json!({ "base_url": old }).to_string();

    let target_url = proxy_url_for(AppType::Claude);
    root.as_object_mut()
        .ok_or_else(|| anyhow!("settings.json 顶层必须是对象"))?
        .entry("env")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| anyhow!("env 必须是对象"))?
        .insert(
            "ANTHROPIC_BASE_URL".into(),
            serde_json::Value::String(target_url),
        );
    write_atomic(path, &serde_json::to_string_pretty(&root)?)?;
    Ok(backup)
}

pub fn restore_claude_at(path: &Path, backup: &str) -> Result<()> {
    let b: serde_json::Value = serde_json::from_str(backup)?;
    let old = b.get("base_url").and_then(|v| v.as_str());
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("读取 Claude 配置失败,未执行还原: {e}"))?;
    let mut root: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| anyhow!("Claude 配置已被外部改写且无法解析,未执行还原: {e}"))?;
    let current = root
        .get("env")
        .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
        .and_then(|v| v.as_str());
    if !current.is_some_and(|value| is_restore_proxy_url(value, AppType::Claude)) {
        return Err(anyhow!(
            "Claude 配置已被外部修改,为避免覆盖请先检查后再还原"
        ));
    }
    let env = root
        .as_object_mut()
        .ok_or_else(|| anyhow!("settings.json 顶层必须是对象"))?
        .entry("env")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| anyhow!("env 必须是对象"))?;
    match old {
        Some(url) => {
            env.insert(
                "ANTHROPIC_BASE_URL".into(),
                serde_json::Value::String(url.into()),
            );
        }
        None => {
            env.remove("ANTHROPIC_BASE_URL");
        }
    }
    write_atomic(path, &serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

fn claude_effective(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| {
            v.get("env")
                .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
                .and_then(|u| u.as_str().map(|s| s == proxy_url_for(AppType::Claude)))
        })
        .unwrap_or(false)
}

// ---------- Codex: ~/.codex/config.toml ----------

fn codex_config_path() -> Result<PathBuf> {
    home_path(&[".codex", "config.toml"])
}

/// 改写所有 [model_providers.*].base_url 指向代理;无 model_providers 时创建最小条目。
/// 备份 = 原始 toml 全文。toml_edit 保注释保格式。
pub fn apply_codex_at(path: &Path) -> Result<String> {
    let original = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };
    let mut doc: toml_edit::DocumentMut = original
        .parse()
        .map_err(|e| anyhow!("config.toml 解析失败: {e}"))?;

    let providers = doc["model_providers"]
        .or_insert(toml_edit::Item::Table(toml_edit::Table::new()))
        .as_table_mut()
        .ok_or_else(|| anyhow!("model_providers 必须是表"))?;

    if providers.is_empty() {
        // 无任何 provider:创建指向代理的最小条目并设为默认
        let mut t = toml_edit::Table::new();
        t["name"] = toml_edit::value("Keyway");
        t["base_url"] = toml_edit::value(proxy_url_for(AppType::Codex));
        t["wire_api"] = toml_edit::value("responses");
        providers["keyway"] = toml_edit::Item::Table(t);
        doc["model_provider"] = toml_edit::value("keyway");
    } else {
        for (_, item) in providers.iter_mut() {
            if let Some(t) = item.as_table_mut() {
                if t.contains_key("base_url") {
                    t["base_url"] = toml_edit::value(proxy_url_for(AppType::Codex));
                }
            }
        }
    }
    write_atomic(path, &doc.to_string())?;
    Ok(original)
}

pub fn restore_codex_at(path: &Path, backup: &str) -> Result<()> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("读取 Codex 配置失败,未执行还原: {e}"))?;
    let original: toml_edit::DocumentMut = backup
        .parse()
        .map_err(|e| anyhow!("Codex 备份解析失败: {e}"))?;
    let mut current: toml_edit::DocumentMut = raw
        .parse()
        .map_err(|e| anyhow!("Codex 配置已被外部改写且无法解析,未执行还原: {e}"))?;
    let proxy = proxy_url_for(AppType::Codex);
    let original_providers = original
        .get("model_providers")
        .and_then(|item| item.as_table());
    for (name, original_item) in original_providers
        .into_iter()
        .flat_map(|table| table.iter())
    {
        let Some(original_url) = original_item
            .as_table()
            .and_then(|table| table.get("base_url"))
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        let current_url = current
            .get("model_providers")
            .and_then(|item| item.as_table())
            .and_then(|table| table.get(name))
            .and_then(|item| item.as_table())
            .and_then(|table| table.get("base_url"))
            .and_then(|value| value.as_str());
        match current_url {
            Some(value) if is_restore_proxy_url(value, AppType::Codex) => {
                current["model_providers"][name]["base_url"] = toml_edit::value(original_url);
            }
            Some(value) if value == original_url => {}
            Some(_) | None => {
                return Err(anyhow!(
                    "Codex 供应商 {name} 的接口地址已被外部修改,为避免覆盖请先检查后再还原"
                ));
            }
        }
    }
    let original_has_provider = original_providers.is_some_and(|table| !table.is_empty());
    if !original_has_provider {
        let generated = current
            .get("model_providers")
            .and_then(|item| item.as_table())
            .and_then(|table| table.get("keyway"))
            .and_then(|item| item.as_table())
            .is_some_and(|table| {
                table.len() == 3
                    && matches!(
                        table.get("wire_api").and_then(|value| value.as_str()),
                        Some("chat" | "responses")
                    )
                    && table.get("name").and_then(|value| value.as_str()) == Some("Keyway")
                    && table
                        .get("base_url")
                        .and_then(|value| value.as_str())
                        .is_some_and(|value| value == proxy || value == PROXY_URL)
            });
        if !generated {
            return Err(anyhow!("Codex 自动创建的供应商已被外部修改,未执行还原"));
        }
        if generated {
            if let Some(table) = current["model_providers"].as_table_mut() {
                table.remove("keyway");
            }
            if current
                .get("model_provider")
                .and_then(|value| value.as_str())
                == Some("keyway")
            {
                if let Some(selection) = original.get("model_provider") {
                    current["model_provider"] = selection.clone();
                } else {
                    current.as_table_mut().remove("model_provider");
                }
            }
            if original.get("model_providers").is_none()
                && current["model_providers"]
                    .as_table()
                    .is_some_and(|table| table.is_empty())
            {
                current.as_table_mut().remove("model_providers");
            }
        }
    }
    write_atomic(path, &current.to_string())?;
    Ok(())
}

fn codex_effective(path: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(doc) = raw.parse::<toml_edit::DocumentMut>() else {
        return false;
    };
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
        .and_then(|providers| providers.get(selected))
        .and_then(|provider| provider.get("base_url"))
        .and_then(|value| value.as_str())
        .is_some_and(|url| url == proxy_url_for(AppType::Codex))
}

// ---------- Gemini: ~/.gemini/.env ----------

const GEMINI_VAR: &str = "GOOGLE_GEMINI_BASE_URL";

fn gemini_env_path() -> Result<PathBuf> {
    home_path(&[".gemini", ".env"])
}

pub fn apply_gemini_at(path: &Path) -> Result<String> {
    let original = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };
    write_atomic(path, &gemini_content(&original))?;
    Ok(original)
}

fn gemini_assignment(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    let assignment = trimmed.strip_prefix("export ").unwrap_or(trimmed);
    let (name, value) = assignment.split_once('=')?;
    (name.trim() == GEMINI_VAR).then(|| value.trim().trim_matches(['\'', '"']))
}

fn gemini_content(original: &str) -> String {
    let target = format!("{GEMINI_VAR}={}", proxy_url_for(AppType::Gemini));
    let newline = if original.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut found = false;
    let mut output = String::new();
    for line in original.split_inclusive('\n') {
        if gemini_assignment(line).is_some() {
            found = true;
            output.push_str(&target);
            if line.ends_with('\n') {
                output.push_str(newline);
            }
        } else {
            output.push_str(line);
        }
    }
    if !found {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push_str(newline);
        }
        output.push_str(&target);
        output.push_str(newline);
    }
    output
}

pub fn restore_gemini_at(path: &Path, backup: &str) -> Result<()> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("读取 Gemini 配置失败,未执行还原: {e}"))?;
    let assignments: Vec<_> = raw.lines().filter_map(gemini_assignment).collect();
    let originals: Vec<_> = backup
        .split_inclusive('\n')
        .filter(|line| gemini_assignment(line).is_some())
        .collect();
    if assignments.len() != originals.len().max(1)
        || assignments
            .iter()
            .any(|value| !is_restore_proxy_url(value, AppType::Gemini))
    {
        return Err(anyhow!(
            "Gemini 配置已被外部修改,为避免覆盖请先检查后再还原"
        ));
    }
    if raw == gemini_content(backup) {
        return write_atomic(path, backup);
    }
    let mut original_lines = originals.into_iter();
    let mut output = String::new();
    for line in raw.split_inclusive('\n') {
        if gemini_assignment(line).is_some() {
            if let Some(original) = original_lines.next() {
                output.push_str(original);
                if !original.ends_with('\n') && line.ends_with('\n') {
                    output.push('\n');
                }
            }
        } else {
            output.push_str(line);
        }
    }
    write_atomic(path, &output)?;
    Ok(())
}

fn gemini_effective(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .map(|raw| {
            let values: Vec<_> = raw.lines().filter_map(gemini_assignment).collect();
            !values.is_empty()
                && values
                    .iter()
                    .all(|value| *value == proxy_url_for(AppType::Gemini))
        })
        .unwrap_or(false)
}

// ---------- OpenCode: ~/.config/opencode/opencode.json(JSON) ----------

/// OpenAI 兼容端点路径(@ai-sdk/openai-compatible 会在 baseURL 后拼 /chat/completions)
const PROXY_V1: &str = "http://127.0.0.1:9527/v1";

fn proxy_v1_for(app: AppType) -> String {
    format!("{}{}/v1", PROXY_URL, app.proxy_prefix())
}

fn opencode_config_path() -> Result<PathBuf> {
    home_path(&[".config", "opencode", "opencode.json"])
}

/// 改写所有 provider.*.options.baseURL 指向代理(apiKey 占位为 keyway);
/// 无任何带 baseURL 的 provider 时创建最小 keyway 条目。备份 = 原始文件全文。
pub fn apply_opencode_at(path: &Path) -> Result<String> {
    let original = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };
    let mut root: serde_json::Value = if original.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(&original).context("opencode.json 不是合法 JSON")?
    };
    let proxy_v1 = proxy_v1_for(AppType::OpenCode);
    let providers = root
        .as_object_mut()
        .ok_or_else(|| anyhow!("opencode.json 顶层必须是对象"))?
        .entry("provider")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| anyhow!("provider 必须是对象"))?;

    let mut patched = 0usize;
    for (_, item) in providers.iter_mut() {
        let Some(opts) = item.get_mut("options").and_then(|o| o.as_object_mut()) else {
            continue;
        };
        if opts.contains_key("baseURL") {
            opts.insert(
                "baseURL".into(),
                serde_json::Value::String(proxy_v1.clone()),
            );
            opts.insert("apiKey".into(), serde_json::Value::String("keyway".into()));
            patched += 1;
        }
    }
    if patched == 0 {
        providers.insert(
            "keyway".into(),
            serde_json::json!({
                "npm": "@ai-sdk/openai-compatible",
                "name": "Keyway",
                "options": { "baseURL": proxy_v1, "apiKey": "keyway" },
                "models": {}
            }),
        );
    }
    write_atomic(path, &serde_json::to_string_pretty(&root)?)?;
    Ok(original)
}

pub fn restore_opencode_at(path: &Path, backup: &str) -> Result<()> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("读取 OpenCode 配置失败,未执行还原: {e}"))?;
    let original: serde_json::Value = if backup.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(backup).map_err(|e| anyhow!("OpenCode 备份解析失败: {e}"))?
    };
    let mut current: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| anyhow!("OpenCode 配置已被外部改写且无法解析,未执行还原: {e}"))?;
    let proxy = proxy_v1_for(AppType::OpenCode);
    let original_providers = original.get("provider").and_then(|value| value.as_object());
    for (name, original_item) in original_providers
        .into_iter()
        .flat_map(|object| object.iter())
    {
        let Some(original_options) = original_item
            .get("options")
            .and_then(|value| value.as_object())
        else {
            continue;
        };
        let Some(original_url) = original_options
            .get("baseURL")
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        let current_options = current
            .get("provider")
            .and_then(|value| value.get(name))
            .and_then(|value| value.get("options"))
            .and_then(|value| value.as_object());
        let current_url = current_options
            .and_then(|options| options.get("baseURL"))
            .and_then(|value| value.as_str());
        let current_uses_keyway = current_options
            .and_then(|options| options.get("apiKey"))
            .and_then(|value| value.as_str())
            == Some("keyway");
        match current_url {
            Some(value) if value == proxy || value == PROXY_V1 => {
                let options = current["provider"][name]["options"]
                    .as_object_mut()
                    .unwrap();
                options.insert(
                    "baseURL".into(),
                    serde_json::Value::String(original_url.into()),
                );
                if current_uses_keyway {
                    if let Some(original_key) = original_options.get("apiKey") {
                        options.insert("apiKey".into(), original_key.clone());
                    } else {
                        options.remove("apiKey");
                    }
                }
            }
            Some(value) if value == original_url => {}
            Some(_) | None => {
                return Err(anyhow!(
                    "OpenCode 供应商 {name} 的接口地址已被外部修改,为避免覆盖请先检查后再还原"
                ));
            }
        }
    }
    if original_providers.is_none_or(|object| {
        object.values().all(|item| {
            item.get("options")
                .and_then(|options| options.get("baseURL"))
                .is_none()
        })
    }) {
        let generated = current
            .get("provider")
            .and_then(|value| value.get("keyway"));
        let expected = |url: &str| {
            serde_json::json!({
                "npm": "@ai-sdk/openai-compatible", "name": "Keyway",
                "options": {"baseURL": url, "apiKey": "keyway"}, "models": {}
            })
        };
        if generated != Some(&expected(&proxy)) && generated != Some(&expected(PROXY_V1)) {
            return Err(anyhow!("OpenCode 自动创建的供应商已被外部修改,未执行还原"));
        }
        let providers = current["provider"].as_object_mut().unwrap();
        if let Some(previous) = original_providers.and_then(|providers| providers.get("keyway")) {
            providers.insert("keyway".into(), previous.clone());
        } else {
            providers.remove("keyway");
        }
        if providers.is_empty() && original.get("provider").is_none() {
            current.as_object_mut().unwrap().remove("provider");
        }
    }
    if current == original {
        write_atomic(path, backup)?;
    } else {
        write_atomic(path, &serde_json::to_string_pretty(&current)?)?;
    }
    Ok(())
}

fn opencode_effective(path: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let urls: Vec<String> = root
        .get("provider")
        .and_then(|p| p.as_object())
        .map(|m| {
            m.values()
                .filter_map(|p| {
                    p.get("options")?
                        .get("baseURL")?
                        .as_str()
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();
    let proxy_v1 = proxy_v1_for(AppType::OpenCode);
    !urls.is_empty() && urls.iter().all(|u| u == &proxy_v1)
}

// ---------- OpenClaw: ~/.openclaw/openclaw.json(JSON5) ----------

fn openclaw_config_path() -> Result<PathBuf> {
    home_path(&[".openclaw", "openclaw.json"])
}

/// 改写所有 models.providers.*.baseUrl 指向代理(apiKey 占位为 keyway);
/// 无任何带 baseUrl 的 provider 时创建最小 keyway 条目。备份 = 原始文件全文。
/// OpenClaw 官方行为即"自有写入会重序列化为标准 JSON",故回写普通 JSON 无损。
pub fn apply_openclaw_at(path: &Path) -> Result<String> {
    let original = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };
    let mut root: serde_json::Value = if original.trim().is_empty() {
        serde_json::json!({})
    } else {
        json5::from_str(&original).context("openclaw.json 不是合法 JSON5/JSON")?
    };
    let proxy_v1 = proxy_v1_for(AppType::OpenClaw);
    let providers = root
        .as_object_mut()
        .ok_or_else(|| anyhow!("openclaw.json 顶层必须是对象"))?
        .entry("models")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| anyhow!("models 必须是对象"))?
        .entry("providers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| anyhow!("models.providers 必须是对象"))?;

    let mut patched = 0usize;
    for (_, item) in providers.iter_mut() {
        if let Some(t) = item.as_object_mut() {
            if t.contains_key("baseUrl") {
                t.insert(
                    "baseUrl".into(),
                    serde_json::Value::String(proxy_v1.clone()),
                );
                t.insert("apiKey".into(), serde_json::Value::String("keyway".into()));
                patched += 1;
            }
        }
    }
    if patched == 0 {
        providers.insert(
            "keyway".into(),
            serde_json::json!({
                "baseUrl": proxy_v1,
                "apiKey": "keyway",
                "api": "openai-completions",
                "models": []
            }),
        );
    }
    write_atomic(path, &serde_json::to_string_pretty(&root)?)?;
    Ok(original)
}

pub fn restore_openclaw_at(path: &Path, backup: &str) -> Result<()> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("读取 OpenClaw 配置失败,未执行还原: {e}"))?;
    let original: serde_json::Value = if backup.trim().is_empty() {
        serde_json::json!({})
    } else {
        json5::from_str(backup).map_err(|e| anyhow!("OpenClaw 备份解析失败: {e}"))?
    };
    let mut current: serde_json::Value = json5::from_str(&raw)
        .map_err(|e| anyhow!("OpenClaw 配置已被外部改写且无法解析,未执行还原: {e}"))?;
    let proxy = proxy_v1_for(AppType::OpenClaw);
    let original_providers = original
        .get("models")
        .and_then(|value| value.get("providers"))
        .and_then(|value| value.as_object());
    for (name, original_item) in original_providers
        .into_iter()
        .flat_map(|object| object.iter())
    {
        let Some(original_url) = original_item
            .get("baseUrl")
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        let current_item = current
            .get("models")
            .and_then(|value| value.get("providers"))
            .and_then(|value| value.get(name));
        let current_url = current_item
            .and_then(|value| value.get("baseUrl"))
            .and_then(|value| value.as_str());
        let current_uses_keyway = current_item
            .and_then(|item| item.get("apiKey"))
            .and_then(|value| value.as_str())
            == Some("keyway");
        match current_url {
            Some(value) if value == proxy || value == PROXY_V1 => {
                let provider = current["models"]["providers"][name]
                    .as_object_mut()
                    .unwrap();
                provider.insert(
                    "baseUrl".into(),
                    serde_json::Value::String(original_url.into()),
                );
                if current_uses_keyway {
                    if let Some(original_key) = original_item.get("apiKey") {
                        provider.insert("apiKey".into(), original_key.clone());
                    } else {
                        provider.remove("apiKey");
                    }
                }
            }
            Some(value) if value == original_url => {}
            Some(_) | None => {
                return Err(anyhow!(
                    "OpenClaw 供应商 {name} 的接口地址已被外部修改,为避免覆盖请先检查后再还原"
                ));
            }
        }
    }
    if original_providers
        .is_none_or(|object| object.values().all(|item| item.get("baseUrl").is_none()))
    {
        let generated = current
            .get("models")
            .and_then(|value| value.get("providers"))
            .and_then(|value| value.get("keyway"));
        let expected = |url: &str| {
            serde_json::json!({
                "baseUrl": url, "apiKey": "keyway", "api": "openai-completions", "models": []
            })
        };
        if generated != Some(&expected(&proxy)) && generated != Some(&expected(PROXY_V1)) {
            return Err(anyhow!("OpenClaw 自动创建的供应商已被外部修改,未执行还原"));
        }
        let providers = current["models"]["providers"].as_object_mut().unwrap();
        if let Some(previous) = original_providers.and_then(|providers| providers.get("keyway")) {
            providers.insert("keyway".into(), previous.clone());
        } else {
            providers.remove("keyway");
        }
        if providers.is_empty()
            && original
                .get("models")
                .and_then(|value| value.get("providers"))
                .is_none()
        {
            current["models"]
                .as_object_mut()
                .unwrap()
                .remove("providers");
        }
        if current["models"]
            .as_object()
            .is_some_and(|models| models.is_empty())
            && original.get("models").is_none()
        {
            current.as_object_mut().unwrap().remove("models");
        }
    }
    if current == original {
        write_atomic(path, backup)?;
    } else {
        write_atomic(path, &serde_json::to_string_pretty(&current)?)?;
    }
    Ok(())
}

fn openclaw_effective(path: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(root) = json5::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let urls: Vec<String> = root
        .get("models")
        .and_then(|m| m.get("providers"))
        .and_then(|p| p.as_object())
        .map(|m| {
            m.values()
                .filter_map(|p| p.get("baseUrl")?.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let proxy_v1 = proxy_v1_for(AppType::OpenClaw);
    !urls.is_empty() && urls.iter().all(|u| u == &proxy_v1)
}

// ---------- 对外接口 ----------

pub fn status(pool: &Pool) -> Vec<TakeoverStatus> {
    AppType::all()
        .iter()
        .map(|&app| {
            let supported = matches!(
                app,
                AppType::Claude
                    | AppType::Codex
                    | AppType::Gemini
                    | AppType::OpenCode
                    | AppType::OpenClaw
            );
            let (exists, effective) = if supported {
                match live_path(app) {
                    Ok(p) => (
                        p.exists(),
                        match app {
                            AppType::Claude => claude_effective(&p),
                            AppType::Codex => codex_effective(&p),
                            AppType::Gemini => gemini_effective(&p),
                            AppType::OpenCode => opencode_effective(&p),
                            AppType::OpenClaw => openclaw_effective(&p),
                            _ => false,
                        },
                    ),
                    Err(_) => (false, false),
                }
            } else {
                (false, false)
            };
            let active = settings_get(pool, &active_key(app))
                .ok()
                .flatten()
                .map(|v| v == "1")
                .unwrap_or(false);
            let failover = settings_get(pool, &format!("failover:{}", app.as_str()))
                .ok()
                .flatten()
                .map(|v| v == "1")
                .unwrap_or(false);
            TakeoverStatus {
                app: app.as_str().to_string(),
                supported,
                config_exists: exists,
                active,
                effective,
                failover,
            }
        })
        .collect()
}

fn live_path(app: AppType) -> Result<PathBuf> {
    match app {
        AppType::Claude => claude_settings_path(),
        AppType::Codex => codex_config_path(),
        AppType::Gemini => gemini_env_path(),
        AppType::OpenCode => opencode_config_path(),
        AppType::OpenClaw => openclaw_config_path(),
        _ => Err(anyhow!("该应用暂不支持接管")),
    }
}

pub fn apply(pool: &Pool, app: AppType) -> Result<()> {
    if !matches!(
        app,
        AppType::Claude | AppType::Codex | AppType::Gemini | AppType::OpenCode | AppType::OpenClaw
    ) {
        return Err(anyhow!("{} 暂不支持接管,下个版本支持", app.as_str()));
    }
    let path = live_path(app)?;
    apply_at(pool, app, &path)
}

fn apply_at(pool: &Pool, app: AppType, path: &Path) -> Result<()> {
    let existing_backup = settings_get(pool, &backup_key(app))?;
    if existing_backup.is_none() {
        let original = if path.exists() {
            std::fs::read_to_string(path)?
        } else {
            String::new()
        };
        let backup = if app == AppType::Claude {
            let root: serde_json::Value = if original.trim().is_empty() {
                serde_json::json!({})
            } else {
                serde_json::from_str(&original)?
            };
            serde_json::json!({"base_url": root.get("env").and_then(|env| env.get("ANTHROPIC_BASE_URL")).and_then(|value| value.as_str())}).to_string()
        } else {
            original
        };
        settings_set(pool, &backup_key(app), &backup)?;
    }
    let result = match app {
        AppType::Claude => apply_claude_at(path),
        AppType::Codex => apply_codex_at(path),
        AppType::Gemini => apply_gemini_at(path),
        AppType::OpenCode => apply_opencode_at(path),
        AppType::OpenClaw => apply_openclaw_at(path),
        _ => unreachable!(),
    };
    if let Err(error) = result {
        if existing_backup.is_none() {
            settings_del(pool, &backup_key(app))?;
        }
        return Err(error);
    }
    settings_set(pool, &active_key(app), "1")?;
    tracing::info!("已接管 {} → {PROXY_URL}({})", app.as_str(), path.display());
    Ok(())
}

pub fn restore(pool: &Pool, app: AppType) -> Result<()> {
    let backup = settings_get(pool, &backup_key(app))?
        .ok_or_else(|| anyhow!("没有 {} 的接管备份(从未接管过?)", app.as_str()))?;
    let path = live_path(app)?;
    match app {
        AppType::Claude => restore_claude_at(&path, &backup)?,
        AppType::Codex => restore_codex_at(&path, &backup)?,
        AppType::Gemini => restore_gemini_at(&path, &backup)?,
        AppType::OpenCode => restore_opencode_at(&path, &backup)?,
        AppType::OpenClaw => restore_openclaw_at(&path, &backup)?,
        _ => unreachable!(),
    }
    settings_del(pool, &active_key(app))?;
    settings_del(pool, &backup_key(app))?;
    tracing::info!("已还原 {} 的原始配置", app.as_str());
    Ok(())
}

// ---------- 单元测试(纯文件逻辑,不动真实 HOME) ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "conduit_takeover_test_{tag}_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn claude_apply_restore_roundtrip() {
        let p = tmp("claude").join("settings.json");
        std::fs::write(
            &p,
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://origin.example"},"other":true}"#,
        )
        .unwrap();

        let backup = apply_claude_at(&p).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains(PROXY_URL));
        assert!(raw.contains("other")); // 其他配置不动

        restore_claude_at(&p, &backup).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("https://origin.example"));
        assert!(!raw.contains(PROXY_URL));
    }

    #[test]
    fn claude_apply_creates_missing_file() {
        let p = tmp("claude_new").join("settings.json");
        let backup = apply_claude_at(&p).unwrap();
        assert!(p.exists());
        assert!(claude_effective(&p));
        restore_claude_at(&p, &backup).unwrap();
        assert!(!claude_effective(&p));
    }

    #[test]
    fn claude_restore_refuses_to_overwrite_external_base_url_change() {
        let p = tmp("claude_external").join("settings.json");
        std::fs::write(
            &p,
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://origin.example"},"theme":"dark"}"#,
        )
        .unwrap();
        let backup = apply_claude_at(&p).unwrap();
        std::fs::write(
            &p,
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://manual.example"},"theme":"light"}"#,
        )
        .unwrap();

        assert!(restore_claude_at(&p, &backup).is_err());
        let current = std::fs::read_to_string(&p).unwrap();
        assert!(current.contains("https://manual.example"));
        assert!(current.contains("light"));
    }

    #[test]
    fn codex_apply_keeps_comments_and_restores() {
        let p = tmp("codex").join("config.toml");
        let original = "# my comment\nmodel_provider = \"acme\"\n\n[model_providers.acme]\nname = \"Acme\"\nbase_url = \"https://acme.example\"\n";
        std::fs::write(&p, original).unwrap();

        let backup = apply_codex_at(&p).unwrap();
        assert_eq!(backup, original);
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("# my comment"), "注释必须保留");
        assert!(raw.contains(PROXY_URL));
        assert!(codex_effective(&p));

        restore_codex_at(&p, &backup).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), original);
    }

    #[test]
    fn codex_apply_creates_minimal_provider() {
        let p = tmp("codex_new").join("config.toml");
        apply_codex_at(&p).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("model_provider = \"keyway\""));
        assert!(raw.contains(PROXY_URL));
        assert!(raw.contains("wire_api = \"responses\""));
    }

    #[test]
    fn codex_status_only_checks_the_selected_provider() {
        let path = tmp("codex_selected").join("config.toml");
        let raw = format!("model_provider = \"direct\"\n[model_providers.direct]\nbase_url = \"https://direct.example\"\n[model_providers.keyway]\nbase_url = \"{}\"\n", proxy_url_for(AppType::Codex));
        std::fs::write(&path, &raw).unwrap();
        assert!(!codex_effective(&path));
        std::fs::write(
            &path,
            raw.replace("model_provider = \"direct\"", "model_provider = \"keyway\""),
        )
        .unwrap();
        assert!(codex_effective(&path));
    }

    #[test]
    fn codex_restore_preserves_unrelated_changes_while_proxy_is_intact() {
        let p = tmp("codex_unrelated").join("config.toml");
        std::fs::write(
            &p,
            "[model_providers.relay]\nname = \"Relay\"\nbase_url = \"https://origin.example\"\n",
        )
        .unwrap();
        let backup = apply_codex_at(&p).unwrap();
        let mut doc: toml_edit::DocumentMut = std::fs::read_to_string(&p).unwrap().parse().unwrap();
        doc["model"] = toml_edit::value("gpt-5");
        std::fs::write(&p, doc.to_string()).unwrap();

        restore_codex_at(&p, &backup).unwrap();
        let restored = std::fs::read_to_string(&p).unwrap();
        assert!(restored.contains("https://origin.example"));
        assert!(restored.contains("model = \"gpt-5\""));
    }

    #[test]
    fn codex_restore_refuses_to_overwrite_external_provider_change() {
        let p = tmp("codex_external").join("config.toml");
        std::fs::write(
            &p,
            "[model_providers.relay]\nname = \"Relay\"\nbase_url = \"https://origin.example\"\n",
        )
        .unwrap();
        let backup = apply_codex_at(&p).unwrap();
        let mut doc: toml_edit::DocumentMut = std::fs::read_to_string(&p).unwrap().parse().unwrap();
        doc["model_providers"]["relay"]["base_url"] = toml_edit::value("https://manual.example");
        std::fs::write(&p, doc.to_string()).unwrap();

        assert!(restore_codex_at(&p, &backup).is_err());
        let current = std::fs::read_to_string(&p).unwrap();
        assert!(current.contains("https://manual.example"));
    }

    #[test]
    fn gemini_env_roundtrip() {
        let p = tmp("gemini").join(".env");
        std::fs::write(
            &p,
            "GEMINI_API_KEY=xxx\nGOOGLE_GEMINI_BASE_URL=https://g.example\n",
        )
        .unwrap();

        let backup = apply_gemini_at(&p).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains(&format!("{GEMINI_VAR}={PROXY_URL}")));
        assert!(raw.contains("GEMINI_API_KEY=xxx"));
        assert!(gemini_effective(&p));

        restore_gemini_at(&p, &backup).unwrap();
        assert!(std::fs::read_to_string(&p)
            .unwrap()
            .contains("https://g.example"));
    }

    #[test]
    fn gemini_env_appends_when_missing() {
        let p = tmp("gemini_new").join(".env");
        let backup = apply_gemini_at(&p).unwrap();
        assert_eq!(backup, "");
        assert!(gemini_effective(&p));
    }

    #[test]
    fn gemini_restore_refuses_to_overwrite_external_base_url_change() {
        let p = tmp("gemini_external").join(".env");
        std::fs::write(
            &p,
            "GEMINI_API_KEY=keep\nGOOGLE_GEMINI_BASE_URL=https://origin.example\n",
        )
        .unwrap();
        let backup = apply_gemini_at(&p).unwrap();
        std::fs::write(
            &p,
            "GEMINI_API_KEY=keep\nGOOGLE_GEMINI_BASE_URL=https://manual.example\n",
        )
        .unwrap();

        assert!(restore_gemini_at(&p, &backup).is_err());
        let current = std::fs::read_to_string(&p).unwrap();
        assert!(current.contains("https://manual.example"));
    }

    #[test]
    fn gemini_restore_preserves_unrelated_edits() {
        let path = tmp("gemini_merge").join(".env");
        std::fs::write(&path, "# original\r\nGEMINI_API_KEY=old\r\n").unwrap();
        let backup = apply_gemini_at(&path).unwrap();
        let current = std::fs::read_to_string(&path)
            .unwrap()
            .replace("GEMINI_API_KEY=old", "GEMINI_API_KEY=new");
        std::fs::write(&path, format!("{current}\nNEW_SETTING=keep\n")).unwrap();
        restore_gemini_at(&path, &backup).unwrap();
        let restored = std::fs::read_to_string(&path).unwrap();
        assert!(restored.contains("GEMINI_API_KEY=new"));
        assert!(restored.contains("NEW_SETTING=keep"));
        assert!(!restored.contains(GEMINI_VAR));
    }

    #[test]
    fn empty_json_backups_do_not_erase_external_edits() {
        for (name, apply, restore) in [
            (
                "opencode",
                apply_opencode_at as fn(&Path) -> Result<String>,
                restore_opencode_at as fn(&Path, &str) -> Result<()>,
            ),
            ("openclaw", apply_openclaw_at, restore_openclaw_at),
        ] {
            let path = tmp(name).join("config.json");
            let backup = apply(&path).unwrap();
            assert!(backup.is_empty());
            let changed = "{\"user_added\":true}";
            std::fs::write(&path, changed).unwrap();
            assert!(restore(&path, &backup).is_err(), "{name}");
            assert_eq!(std::fs::read_to_string(&path).unwrap(), changed);
        }
    }

    #[test]
    fn generated_codex_provider_is_not_silently_deleted_after_edit() {
        let path = tmp("codex_generated").join("config.toml");
        let backup = apply_codex_at(&path).unwrap();
        let mut current: toml_edit::DocumentMut =
            std::fs::read_to_string(&path).unwrap().parse().unwrap();
        current["model_providers"]["keyway"]["custom_setting"] = toml_edit::value("keep");
        let changed = current.to_string();
        std::fs::write(&path, &changed).unwrap();
        assert!(restore_codex_at(&path, &backup).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), changed);
    }

    #[test]
    fn repeated_takeover_preserves_empty_original_backup() {
        let directory = tmp("empty_backup");
        let pool = crate::db::init_pool(directory.join("test.db"), &"ab".repeat(32)).unwrap();
        for app in [
            AppType::Codex,
            AppType::Gemini,
            AppType::OpenCode,
            AppType::OpenClaw,
        ] {
            let path = directory.join(app.as_str());
            apply_at(&pool, app, &path).unwrap();
            apply_at(&pool, app, &path).unwrap();
            assert_eq!(
                settings_get(&pool, &backup_key(app)).unwrap(),
                Some(String::new())
            );
        }
    }

    #[test]
    fn takeover_does_not_touch_config_when_backup_storage_fails() {
        let directory = tmp("backup_failure");
        let pool = crate::db::init_pool(directory.join("test.db"), &"ab".repeat(32)).unwrap();
        pool.get().unwrap().execute_batch("CREATE TRIGGER reject_backup BEFORE INSERT ON settings BEGIN SELECT RAISE(FAIL, 'test write failure'); END;").unwrap();
        let path = directory.join("config.toml");
        let original = "model = \"my-model\"\n";
        std::fs::write(&path, original).unwrap();
        assert!(apply_at(&pool, AppType::Codex, &path).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), original);
    }
}

// (批 D 测试追加)
#[cfg(test)]
mod opencode_openclaw_tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "conduit_takeover_test_{tag}_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn opencode_apply_restore_roundtrip() {
        let p = tmp("opencode").join("opencode.json");
        std::fs::write(
            &p,
            r#"{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "kimi": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://api.moonshot.cn/v1", "apiKey": "sk-origin" },
      "models": { "kimi-k2": { "name": "Kimi K2" } }
    }
  },
  "model": "kimi/kimi-k2"
}"#,
        )
        .unwrap();

        let backup = apply_opencode_at(&p).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains(&proxy_v1_for(AppType::OpenCode)));
        assert!(raw.contains("kimi-k2")); // models 不动
        assert!(opencode_effective(&p));

        restore_opencode_at(&p, &backup).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("https://api.moonshot.cn/v1"));
        assert!(raw.contains("sk-origin"));
        assert!(!opencode_effective(&p));
    }

    #[test]
    fn opencode_creates_keyway_provider_when_missing() {
        let p = tmp("opencode_new").join("opencode.json");
        std::fs::write(&p, r#"{ "$schema": "https://opencode.ai/config.json" }"#).unwrap();
        let backup = apply_opencode_at(&p).unwrap();
        assert!(opencode_effective(&p));
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("openai-compatible"));
        restore_opencode_at(&p, &backup).unwrap();
        assert!(!opencode_effective(&p));
    }

    #[test]
    fn openclaw_json5_apply_restore_roundtrip() {
        let p = tmp("openclaw").join("openclaw.json");
        // JSON5:注释 + 尾逗号
        std::fs::write(
            &p,
            r#"{
  // 我的网关配置
  "models": {
    "providers": {
      "kimi": {
        "baseUrl": "https://api.moonshot.ai/v1",
        "apiKey": "${KIMI_KEY}",
        "api": "openai-completions",
        "models": [{ "id": "kimi-k2.6", "name": "Kimi K2.6" }],
      },
    },
  },
  "agents": { "defaults": { "model": { "primary": "kimi/kimi-k2.6" } } },
}"#,
        )
        .unwrap();

        let backup = apply_openclaw_at(&p).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains(&proxy_v1_for(AppType::OpenClaw)));
        assert!(raw.contains("kimi-k2.6")); // models 数组不动
        assert!(openclaw_effective(&p));
        // 仍是合法 JSON5(重写后为标准 JSON)
        assert!(json5::from_str::<serde_json::Value>(&raw).is_ok());

        restore_openclaw_at(&p, &backup).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("https://api.moonshot.ai/v1"));
        assert!(!openclaw_effective(&p));
    }

    #[test]
    fn openclaw_creates_provider_when_file_missing() {
        let p = tmp("openclaw_new").join("openclaw.json");
        let backup = apply_openclaw_at(&p).unwrap();
        assert!(p.exists());
        assert!(openclaw_effective(&p));
        restore_openclaw_at(&p, &backup).unwrap();
        // 空备份(原本无配置)还原为空文件,与 codex 行为一致
        assert_eq!(
            std::fs::read_to_string(&p).unwrap().trim(),
            "",
            "应还原为空内容"
        );
        assert!(!openclaw_effective(&p));
    }
}
