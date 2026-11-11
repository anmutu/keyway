//! 套餐计费命令:政策列表 / 查询状态 / 设置政策 / 强制刷新窗口。
//!
//! 薄层:业务在 [`crate::services::billing`]。

use tauri::State;

use crate::services::billing as svc;
use crate::state::AppState;

/// 可选政策列表(编辑供应商对话框的「套餐计费」下拉用)。
#[tauri::command]
pub fn billing_policies() -> Vec<PolicyInfo> {
    svc::POLICIES
        .iter()
        .map(|p| PolicyInfo {
            id: p.id,
            label_zh: p.label_zh,
            label_en: p.label_en,
        })
        .collect()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyInfo {
    pub id: &'static str,
    pub label_zh: &'static str,
    pub label_en: &'static str,
}

/// 查询某供应商的计费状态(未关联政策 → None;窗口数据来自缓存,不发请求)。
#[tauri::command]
pub fn get_billing_state(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<Option<svc::BillingState>, String> {
    Ok(svc::compute_state(&state.db, &provider_id))
}

/// 查询某供应商当前关联的政策 id(未关联 → None)。
#[tauri::command]
pub fn get_billing_policy(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<Option<String>, String> {
    Ok(svc::get_policy(&state.db, &provider_id).map(|p| p.id.to_string()))
}

/// 关联/取消关联政策(policy_id 为 None 或 "off" 时取消)。
#[tauri::command]
pub fn set_billing_policy(
    state: State<'_, AppState>,
    provider_id: String,
    policy_id: Option<String>,
) -> Result<(), String> {
    svc::set_policy(&state.db, &provider_id, policy_id.as_deref()).map_err(|e| e.to_string())?;
    // 政策变化立刻反映到托盘
    if let Some(app) = state.app.clone() {
        let _ = crate::rebuild_tray_menu(&app);
    }
    Ok(())
}

/// 刷新窗口状态(force = 忽略 5 分钟节流强制拉取)。
#[tauri::command]
pub async fn refresh_billing_window(
    state: State<'_, AppState>,
    provider_id: String,
    force: Option<bool>,
) -> Result<Option<svc::BillingState>, String> {
    let provider = crate::db::provider_dao::get_by_id(&state.db, &provider_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "供应商不存在".to_string())?;
    svc::refresh_window(&state.db, &provider, force.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

/// 读取提醒配置(高峰预警 / 窗口清仓阈值)。
#[tauri::command]
pub fn get_billing_alerts(state: State<'_, AppState>) -> Result<svc::AlertConfig, String> {
    Ok(svc::alert_config(&state.db))
}

/// 保存提醒配置(服务端统一做范围收敛)。
#[tauri::command]
pub fn set_billing_alerts(
    state: State<'_, AppState>,
    config: svc::AlertConfig,
) -> Result<(), String> {
    let window_changed = svc::set_alert_config(&state.db, &config).map_err(|e| e.to_string())?;
    if window_changed {
        if let Some(app) = state.app.as_ref() {
            let providers =
                crate::db::provider_dao::list_all(&state.db).map_err(|e| e.to_string())?;
            svc::maybe_window_alerts(&state.db, app, &providers);
        }
    }
    Ok(())
}
