//! 套餐计费政策:峰谷判定 + 5 小时窗口状态。
//!
//! 设计原则(KW-RS-001 研究结论):
//! - **政策是数据不是代码**:供应商计费规则随时可能调整(智谱半年改版两次),
//!   所有判定基于内置政策表;每家供应商通过 KV `billing.policy.{id}` 关联一条政策,
//!   未关联 = 功能完全静默(不打扰无关用户)。
//! - **窗口数据双通道**:官方 monitor API(社区已逆向,返回剩余百分比与重置时刻)
//!   为主;API 失效时保留最近一次缓存。调用带 5 分钟节流,不为计量多发请求。
//! - 峰谷时段按北京时间(UTC+8)判定,与本地时区无关。

use anyhow::{anyhow, Result};
use chrono::{DateTime, Datelike, FixedOffset, Timelike, Utc};
use serde::{Deserialize, Serialize};

use crate::db::{kv, Pool};
use crate::types::Provider;

/// 政策判定所用时区:UTC+8(智谱/Z.ai 官方口径)。
fn cn_tz() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).expect("UTC+8 常量合法")
}

// ---------------------------------------------------------------------------
// 政策表(内置,随版本更新;verified 2026-11-10,来源见 docs/research/cost-aware-alerts.html)
// ---------------------------------------------------------------------------

/// 一条套餐计费政策。
#[derive(Clone, Copy, Debug)]
pub struct Policy {
    /// 稳定 id(存 KV;勿改已发布值)
    pub id: &'static str,
    pub label_zh: &'static str,
    pub label_en: &'static str,
    /// 高峰时段:工作日 [start_h, end_h) 点(北京时间)
    pub peak_start_h: u32,
    pub peak_end_h: u32,
    /// 高峰期是否生效(仅周一至周五)
    pub peak_weekdays_only: bool,
    /// 消耗系数:高峰 / 非高峰(同一份活,高峰按此倍率多扣额度)
    pub peak_rate: f64,
    pub offpeak_rate: f64,
    /// 5 小时窗口(自消耗时点起算滚动刷新)
    pub window_hours: f64,
    /// monitor API 基址(额度查询;None = 无官方通道,仅靠本地估算)
    pub monitor_base: Option<&'static str>,
}

impl Policy {
    /// 相对倍率:高峰是非高峰的几倍(托盘/卡片徽标展示用)。
    pub fn rel_rate(&self) -> f64 {
        self.peak_rate / self.offpeak_rate
    }
}

/// 内置政策表。GLM 双端首发(作者自用可自证);其他套餐后续按此结构增补。
pub static POLICIES: &[Policy] = &[
    // 国内 V1/V2 老套餐(prompt 计数制,2026-07-30 改版前订阅,规则锁死):
    // GLM-5.3 非高峰 1×、高峰 3×;GLM-5.3-Flash 0.4×/1.2×。
    Policy {
        id: "glm-v2",
        label_zh: "GLM 编程套餐 · 老版(V2,高峰 3×)",
        label_en: "GLM Coding Plan · legacy V2 (peak 3×)",
        peak_start_h: 14,
        peak_end_h: 18,
        peak_weekdays_only: true,
        peak_rate: 3.0,
        offpeak_rate: 1.0,
        window_hours: 5.0,
        monitor_base: Some("https://open.bigmodel.cn"),
    },
    // 国内现行积分制(2026-07-30 起):高峰 1×、非高峰 0.5×(谷时半价)。
    Policy {
        id: "glm-v3",
        label_zh: "GLM 编程套餐 · 积分制(高峰 2 倍)",
        label_en: "GLM Coding Plan · credit (peak 2×)",
        peak_start_h: 14,
        peak_end_h: 18,
        peak_weekdays_only: true,
        peak_rate: 1.0,
        offpeak_rate: 0.5,
        window_hours: 5.0,
        monitor_base: Some("https://open.bigmodel.cn"),
    },
    // Z.ai 国际版(与国内积分制同构,额度查询走国际域名)。
    Policy {
        id: "zai-v3",
        label_zh: "GLM 国际版 · 积分制(高峰 2 倍)",
        label_en: "GLM Coding Plan Intl · credit (peak 2×)",
        peak_start_h: 14,
        peak_end_h: 18,
        peak_weekdays_only: true,
        peak_rate: 1.0,
        offpeak_rate: 0.5,
        window_hours: 5.0,
        monitor_base: Some("https://api.z.ai"),
    },
];

pub fn policy_by_id(id: &str) -> Option<&'static Policy> {
    POLICIES.iter().find(|p| p.id == id)
}

fn policy_key(provider_id: &str) -> String {
    format!("billing.policy.{}", provider_id)
}

fn window_key(provider_id: &str) -> String {
    format!("billing.window.{}", provider_id)
}

/// 读取供应商关联的政策(未关联 → None)。
pub fn get_policy(pool: &Pool, provider_id: &str) -> Option<&'static Policy> {
    kv::get(pool, &policy_key(provider_id))
        .ok()
        .flatten()
        .and_then(|v| policy_by_id(&v))
}

/// 设置政策(None / "off" / 空串 = 取消关联)。
pub fn set_policy(pool: &Pool, provider_id: &str, policy_id: Option<&str>) -> Result<()> {
    match policy_id.filter(|s| !s.is_empty() && *s != "off") {
        Some(id) => {
            if policy_by_id(id).is_none() {
                return Err(anyhow!("未知政策: {id}"));
            }
            kv::set(pool, &policy_key(provider_id), id)
        }
        None => kv::del(pool, &policy_key(provider_id)),
    }
}

// ---------------------------------------------------------------------------
// 峰谷判定(纯函数,UTC+8)
// ---------------------------------------------------------------------------

/// 当前时段状态。
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeakState {
    pub is_peak: bool,
    /// 相对倍率:高峰 = rel_rate,非高峰 = 1.0
    pub rel_rate: f64,
    /// 政策的高峰相对倍率(「N 分后进峰(×N)」预警文案用)
    pub next_rel_rate: f64,
    /// 当前时段还剩多少分钟结束(高峰→18:00;工作日午前→14:00)
    pub minutes_to_change: Option<i64>,
    /// 阶段:peak = 高峰中 / pre_peak = 工作日高峰将至少 2h 内开始 / off = 其他
    pub phase: &'static str,
}

fn is_weekday(d: chrono::NaiveDate) -> bool {
    !matches!(d.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun)
}

/// 判定某 UTC 时刻在该政策下的峰谷状态(北京时间口径)。
pub fn peak_state(policy: &Policy, now_utc: DateTime<Utc>) -> PeakState {
    let now = now_utc.with_timezone(&cn_tz());
    let (h, m, s) = (now.hour(), now.minute(), now.second());
    let mins = h as i64 * 60 + m as i64 + (s >= 30) as i64; // 就近取整分钟
    let peak_start = policy.peak_start_h as i64 * 60;
    let peak_end = policy.peak_end_h as i64 * 60;
    let weekday = is_weekday(now.date_naive());

    let in_peak = weekday && mins >= peak_start && mins < peak_end;
    if in_peak {
        return PeakState {
            is_peak: true,
            rel_rate: policy.rel_rate(),
            next_rel_rate: policy.rel_rate(),
            minutes_to_change: Some(peak_end - mins),
            phase: "peak",
        };
    }
    // 工作日午前:距高峰开始还有多久(提前预警窗口)
    if weekday && mins < peak_start {
        return PeakState {
            is_peak: false,
            rel_rate: 1.0,
            minutes_to_change: Some(peak_start - mins),
            next_rel_rate: policy.rel_rate(),
            phase: "prePeak",
        };
    }
    PeakState {
        is_peak: false,
        rel_rate: 1.0,
        minutes_to_change: None,
        next_rel_rate: policy.rel_rate(),
        phase: "off",
    }
}

// ---------------------------------------------------------------------------
// 5h 窗口状态(monitor API + KV 缓存)
// ---------------------------------------------------------------------------

/// 窗口状态缓存(KV `billing.window.{id}` 里的 JSON)。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    /// 5h 窗口已用百分比(0-100)
    pub used_pct: f64,
    /// 5h 窗口重置时刻(毫秒时间戳)
    pub reset_at_ms: i64,
    /// 周窗口已用百分比(部分响应可能缺省)
    pub weekly_used_pct: Option<f64>,
    pub weekly_reset_at_ms: Option<i64>,
    pub fetched_at_ms: i64,
    /// api = 官方 monitor API;local = 本地估算(P0 尚未启用)
    pub source: String,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            used_pct: 0.0,
            reset_at_ms: 0,
            weekly_used_pct: None,
            weekly_reset_at_ms: None,
            fetched_at_ms: 0,
            source: "api".into(),
        }
    }
}

/// 窗口缓存至少间隔(毫秒):节流,不为计量多发请求。
const WINDOW_FETCH_INTERVAL_MS: i64 = 5 * 60 * 1000;

pub fn cached_window(pool: &Pool, provider_id: &str) -> Option<WindowState> {
    kv::get(pool, &window_key(provider_id))
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_str(&v).ok())
}

fn save_window(pool: &Pool, provider_id: &str, w: &WindowState) {
    if let Ok(json) = serde_json::to_string(w) {
        let _ = kv::set(pool, &window_key(provider_id), &json);
    }
}

pub fn window_stale(w: &WindowState, now_ms: i64) -> bool {
    now_ms - w.fetched_at_ms >= WINDOW_FETCH_INTERVAL_MS
}

/// monitor API 响应里的单条限额(防御式解析:字段缺失/类型不符 → 丢弃该条)。
#[derive(Debug, Deserialize)]
struct RawLimit {
    #[serde(rename = "type")]
    kind: Option<String>,
    unit: Option<f64>,
    number: Option<f64>,
    percentage: Option<f64>,
    #[serde(rename = "nextResetTime")]
    next_reset_time: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct RawQuotaData {
    limits: Option<Vec<RawLimit>>,
}

#[derive(Debug, Deserialize)]
struct RawEnvelope {
    data: Option<RawQuotaData>,
}

/// 拉取某供应商的窗口状态(官方 monitor API;社区已逆向,未文档化,失败静默降级缓存)。
pub async fn fetch_window(policy: &Policy, api_key: &str) -> Result<WindowState> {
    let base = policy
        .monitor_base
        .ok_or_else(|| anyhow!("该政策无官方额度通道"))?
        .to_string();
    let url = format!("{}/api/monitor/usage/quota/limit", base);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()?;
    // z.ai 监控接口要求 Authorization 头放原始 Key(无 Bearer 前缀)
    let resp = client
        .get(&url)
        .header("Authorization", api_key)
        .header("Accept-Language", "en-US,en")
        .send()
        .await?;
    let envelope: RawEnvelope = resp.json().await?;
    let limits = envelope
        .data
        .ok_or_else(|| anyhow!("响应缺少 data"))?
        .limits
        .unwrap_or_default();

    let now_ms = Utc::now().timestamp_millis();
    let mut state = WindowState {
        fetched_at_ms: now_ms,
        source: "api".into(),
        ..Default::default()
    };
    // TOKENS_LIMIT:unit=3 & number=5 → 5h 窗口;unit=6 & number=1 → 周窗口
    for l in limits {
        if l.kind.as_deref() != Some("TOKENS_LIMIT") {
            continue;
        }
        let pct = l.percentage.unwrap_or(0.0);
        let reset = l.next_reset_time.unwrap_or(0.0) as i64;
        match (l.unit, l.number) {
            (Some(3.0), Some(5.0)) => {
                state.used_pct = pct;
                state.reset_at_ms = reset;
            }
            (Some(6.0), Some(1.0)) => {
                state.weekly_used_pct = Some(pct);
                state.weekly_reset_at_ms = Some(reset);
            }
            _ => {}
        }
    }
    if state.reset_at_ms == 0 {
        return Err(anyhow!("响应中无 5h 窗口数据(可能非套餐 Key)"));
    }
    Ok(state)
}

// ---------------------------------------------------------------------------
// 组合状态(前端/托盘消费)
// ---------------------------------------------------------------------------

/// 某供应商的完整计费状态(serde camelCase → 前端 BillingState)。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingState {
    pub provider_id: String,
    pub policy_id: &'static str,
    pub policy_label_zh: &'static str,
    pub policy_label_en: &'static str,
    pub peak: PeakState,
    /// 窗口状态(缓存);None = 尚未取到
    pub window: Option<WindowState>,
    /// 窗口剩余分钟(由 reset_at 派生,前端免算时区)
    pub window_remaining_min: Option<i64>,
}

pub fn compute_state(pool: &Pool, provider_id: &str) -> Option<BillingState> {
    let policy = get_policy(pool, provider_id)?;
    let now = Utc::now();
    let now_ms = now.timestamp_millis();
    let window = cached_window(pool, provider_id);
    let remaining = window.as_ref().map(|w| {
        let mins = (w.reset_at_ms - now_ms) / 60_000;
        if mins < 0 {
            0
        } else {
            mins
        }
    });
    Some(BillingState {
        provider_id: provider_id.to_string(),
        policy_id: policy.id,
        policy_label_zh: policy.label_zh,
        policy_label_en: policy.label_en,
        peak: peak_state(policy, now),
        window,
        window_remaining_min: remaining,
    })
}

/// 刷新窗口缓存(带节流;force = 忽略节流强制拉取)。
/// 成功返回最新状态;失败时保留旧缓存并返回 Err(调用方决定是否提示)。
pub async fn refresh_window(
    pool: &Pool,
    provider: &Provider,
    force: bool,
) -> Result<Option<BillingState>> {
    let Some(policy) = get_policy(pool, &provider.id) else {
        return Ok(None);
    };
    let now_ms = Utc::now().timestamp_millis();
    if !force {
        if let Some(w) = cached_window(pool, &provider.id) {
            if !window_stale(&w, now_ms) {
                return Ok(compute_state(pool, &provider.id));
            }
        }
    }
    let Some(key) = crate::services::keys::load(pool, provider)? else {
        return Err(anyhow!("供应商未配置 API Key,无法查询额度"));
    };
    let fresh = fetch_window(policy, &key).await?;
    save_window(pool, &provider.id, &fresh);
    Ok(compute_state(pool, &provider.id))
}

/// 托盘徽标文本:高峰中 → "峰×N";窗口临期低用量 → "窗 Nm";否则无。
/// 仅统计「当前正在使用(各分组 is_current)」且配了政策的供应商。
pub fn tray_badge(pool: &Pool, current_providers: &[Provider]) -> Option<String> {
    let now_ms = Utc::now().timestamp_millis();
    let mut peak_rate: Option<f64> = None;
    let mut window_alert: Option<i64> = None;
    for p in current_providers {
        let Some(policy) = get_policy(pool, &p.id) else {
            continue;
        };
        let st = peak_state(policy, Utc::now());
        if st.is_peak && peak_rate.is_none_or(|r| st.rel_rate > r) {
            peak_rate = Some(st.rel_rate);
        }
        if let Some(w) = cached_window(pool, &p.id) {
            let remaining = (w.reset_at_ms - now_ms) / 60_000;
            // 清仓条件(研究定稿):剩余 ≤60 分钟且用量 ≤20%
            if (0..=60).contains(&remaining) && w.used_pct <= 20.0 {
                window_alert = Some(window_alert.map_or(remaining, |m: i64| m.min(remaining)));
            }
        }
    }
    if let Some(r) = peak_rate {
        let mult = if r.fract() == 0.0 {
            format!("{}", r as i64)
        } else {
            format!("{r:.1}")
        };
        return Some(format!("峰×{mult}"));
    }
    window_alert.map(|m| format!("窗{m}m"))
}

// ---------------------------------------------------------------------------
// 提醒(主动系统通知):高峰预警 + 窗口清仓;阈值可配置,每个事件只弹一次
// ---------------------------------------------------------------------------

/// 提醒配置(KV `billing.alert.config`,设置页可改)。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertConfig {
    /// 高峰预警:工作日高峰开始前 lead_min 分钟提醒一次(仅正在使用的供应商)
    pub peak_enabled: bool,
    pub peak_lead_min: i64,
    /// 窗口清仓:窗口剩余 ≤ remaining_min 分钟且剩余额度 ≥ keep_pct% 时提醒一次。
    /// 含未在使用中的套餐(额度悄悄过期正是主场景);默认关闭,想被提醒的用户自己开。
    pub window_enabled: bool,
    pub window_remaining_min: i64,
    /// 「剩余额度」口径(用户心智:还剩多少没浪费);内部与 used_pct 互补
    pub window_keep_pct: f64,
}

impl Default for AlertConfig {
    fn default() -> Self {
        Self {
            peak_enabled: true,
            peak_lead_min: 15,
            window_enabled: false,
            window_remaining_min: 60,
            window_keep_pct: 50.0,
        }
    }
}

impl AlertConfig {
    fn clamped(self) -> Self {
        Self {
            peak_enabled: self.peak_enabled,
            peak_lead_min: self.peak_lead_min.clamp(1, 120),
            window_enabled: self.window_enabled,
            window_remaining_min: self.window_remaining_min.clamp(10, 180),
            window_keep_pct: self.window_keep_pct.clamp(5.0, 95.0),
        }
    }
}

const ALERT_CFG_KEY: &str = "billing.alert.config";

pub fn alert_config(pool: &Pool) -> AlertConfig {
    kv::get(pool, ALERT_CFG_KEY)
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_str::<AlertConfig>(&v).ok())
        .unwrap_or_default()
        .clamped()
}

pub fn set_alert_config(pool: &Pool, cfg: &AlertConfig) -> Result<()> {
    let c = cfg.clamped();
    kv::set(pool, ALERT_CFG_KEY, &serde_json::to_string(&c)?)
}

fn fired_key(kind: &str, provider_id: &str) -> String {
    format!("billing.alert.fired.{kind}.{provider_id}")
}

/// 峰时预警是否命中(纯函数):prePeak 阶段且距高峰 ≤ 预警提前量。
fn peak_alert_hit(cfg: &AlertConfig, st: &PeakState) -> bool {
    cfg.peak_enabled
        && st.phase == "prePeak"
        && st.minutes_to_change.is_some_and(|m| m <= cfg.peak_lead_min)
}

/// 窗口清仓是否命中(纯函数):剩余 ≤ 阈值分钟且剩余额度 ≥ 阈值百分比。
fn window_alert_hit(cfg: &AlertConfig, w: &WindowState, now_ms: i64) -> bool {
    if !cfg.window_enabled {
        return false;
    }
    let remaining = (w.reset_at_ms - now_ms) / 60_000;
    let keep_pct = 100.0 - w.used_pct;
    (0..=cfg.window_remaining_min).contains(&remaining) && keep_pct >= cfg.window_keep_pct
}

fn fmt_rate(r: f64) -> String {
    if r.fract() == 0.0 {
        format!("{}", r as i64)
    } else {
        format!("{r:.1}")
    }
}

/// 心跳里评估并发系统通知(每 60s 调一次;由去重标签保证每个事件只弹一次)。
/// providers 传全量:高峰预警只看 is_current,窗口清仓对全部配了政策的供应商生效。
pub fn maybe_alert(pool: &Pool, app: &tauri::AppHandle, providers: &[Provider]) {
    use tauri_plugin_notification::NotificationExt;
    let cfg = alert_config(pool);
    if !cfg.peak_enabled && !cfg.window_enabled {
        return;
    }
    let zh = kv::get(pool, "locale").ok().flatten().as_deref() != Some("en");
    let now = Utc::now();
    let now_ms = now.timestamp_millis();

    for p in providers {
        let Some(policy) = get_policy(pool, &p.id) else {
            continue;
        };

        // 1) 高峰预警(去重标签 = 北京日期,一天最多一次)
        if p.is_current {
            let st = peak_state(policy, now);
            if peak_alert_hit(&cfg, &st) {
                let tag = format!("peak:{}", now.with_timezone(&cn_tz()).date_naive());
                let key = fired_key("peak", &p.id);
                if kv::get(pool, &key).ok().flatten().as_deref() != Some(&tag) {
                    let m = st.minutes_to_change.unwrap_or(0);
                    let rate = fmt_rate(st.next_rel_rate);
                    let (title, body) = if zh {
                        (
                            format!("{} · {} 分钟后进入高峰", p.name, m),
                            format!("高峰时段(工作日 14:00–18:00)额度按 ×{rate} 消耗,手头任务注意安排。"),
                        )
                    } else {
                        (
                            format!("{} · peak starts in {} min", p.name, m),
                            format!("Peak hours (weekdays 14:00–18:00) consume quota at ×{rate}."),
                        )
                    };
                    if let Err(e) = app.notification().builder().title(title).body(body).show() {
                        tracing::warn!("高峰预警通知发送失败: {e}");
                    }
                    let _ = kv::set(pool, &key, &tag);
                }
            }
        }

        // 2) 窗口清仓(去重标签 = 该窗口 reset_at,一个窗口最多一次)
        if let Some(w) = cached_window(pool, &p.id) {
            if window_alert_hit(&cfg, &w, now_ms) {
                let tag = format!("win:{}", w.reset_at_ms);
                let key = fired_key("win", &p.id);
                if kv::get(pool, &key).ok().flatten().as_deref() != Some(&tag) {
                    let remaining = ((w.reset_at_ms - now_ms) / 60_000).max(0);
                    let keep = (100.0 - w.used_pct).round() as i64;
                    let (title, body) = if zh {
                        (
                            format!("{} · 窗口 {} 分钟后刷新", p.name, remaining),
                            format!("剩余额度还有 {keep}%,不用就作废了。"),
                        )
                    } else {
                        (
                            format!("{} · window resets in {} min", p.name, remaining),
                            format!("{keep}% of the quota is still unused — it expires with the window."),
                        )
                    };
                    if let Err(e) = app.notification().builder().title(title).body(body).show() {
                        tracing::warn!("窗口清仓通知发送失败: {e}");
                    }
                    let _ = kv::set(pool, &key, &tag);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at_cn(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        // 输入北京时间,转回 UTC 供 peak_state 消费
        cn_tz()
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn v2() -> &'static Policy {
        policy_by_id("glm-v2").unwrap()
    }

    #[test]
    fn peak_window_boundaries() {
        let p = v2();
        // 周三 13:59 → 非高峰,1 分钟后进峰
        let st = peak_state(p, at_cn(2026, 11, 11, 13, 59));
        assert!(!st.is_peak && st.phase == "prePeak" && st.minutes_to_change == Some(1));
        // 周三 14:00 → 高峰 ×3
        let st = peak_state(p, at_cn(2026, 11, 11, 14, 0));
        assert!(st.is_peak && st.rel_rate == 3.0 && st.phase == "peak");
        // 周五 17:59 → 高峰,还剩 1 分钟
        let st = peak_state(p, at_cn(2026, 11, 13, 17, 59));
        assert!(st.is_peak && st.minutes_to_change == Some(1));
        // 周五 18:00 → 非高峰(当天无更多变化)
        let st = peak_state(p, at_cn(2026, 11, 13, 18, 0));
        assert!(!st.is_peak && st.phase == "off" && st.minutes_to_change.is_none());
    }

    #[test]
    fn weekends_are_off_peak() {
        let p = v2();
        // 周六 15:00(若不看 weekday 会误判为高峰)
        let st = peak_state(p, at_cn(2026, 11, 14, 15, 0));
        assert!(!st.is_peak && st.phase == "off");
        // 周日 23:59 同理
        let st = peak_state(p, at_cn(2026, 11, 15, 23, 59));
        assert!(!st.is_peak);
    }

    #[test]
    fn credit_policy_relative_rate_is_two() {
        let p = policy_by_id("glm-v3").unwrap();
        assert!((p.rel_rate() - 2.0).abs() < 1e-9);
        let st = peak_state(p, at_cn(2026, 11, 11, 15, 0));
        assert!(st.is_peak && (st.rel_rate - 2.0).abs() < 1e-9);
    }

    #[test]
    fn alert_config_clamps() {
        let cfg = AlertConfig {
            peak_lead_min: 999,
            window_remaining_min: 0,
            window_keep_pct: 200.0,
            ..AlertConfig::default()
        }
        .clamped();
        assert_eq!(cfg.peak_lead_min, 120);
        assert_eq!(cfg.window_remaining_min, 10);
        assert_eq!(cfg.window_keep_pct, 95.0);
    }

    #[test]
    fn window_alert_respects_remaining_and_keep_pct() {
        // 默认关(用户设计);开启后阈值 = 剩余≤60min 且 剩余额度≥50%
        let cfg = AlertConfig {
            window_enabled: true,
            ..AlertConfig::default()
        };
        let base = 1_700_000_000_000i64;
        let w = |used: f64, offset_min: i64| WindowState {
            used_pct: used,
            reset_at_ms: base + offset_min * 60_000,
            ..Default::default()
        };
        // 剩 45 分钟、已用 18%(剩 82%) → 命中
        assert!(window_alert_hit(&cfg, &w(18.0, 45), base));
        // 剩 45 分钟、已用 70%(剩 30%) → 不命中(用得挺多,不算浪费)
        assert!(!window_alert_hit(&cfg, &w(70.0, 45), base));
        // 剩 90 分钟 → 未到阈值
        assert!(!window_alert_hit(&cfg, &w(10.0, 90), base));
        // 已过期(剩余为负) → 不命中
        assert!(!window_alert_hit(&cfg, &w(10.0, -5), base));
        // 关闭开关 → 一律不命中
        let off = AlertConfig {
            window_enabled: false,
            ..cfg
        };
        assert!(!window_alert_hit(&off, &w(18.0, 45), base));
    }

    #[test]
    fn peak_alert_hits_only_in_prepeak_window() {
        let cfg = AlertConfig::default(); // 提前 15 分钟
        let p = v2();
        // 周三 13:50(距峰 10 分) → 命中
        assert!(peak_alert_hit(
            &cfg,
            &peak_state(p, at_cn(2026, 11, 11, 13, 50))
        ));
        // 周三 12:00(距峰 120 分) → 未到提前量
        assert!(!peak_alert_hit(
            &cfg,
            &peak_state(p, at_cn(2026, 11, 11, 12, 0))
        ));
        // 高峰中 → 不再预警(徽标已在说话)
        assert!(!peak_alert_hit(
            &cfg,
            &peak_state(p, at_cn(2026, 11, 11, 15, 0))
        ));
        // 周六上午 → 无峰可预
        assert!(!peak_alert_hit(
            &cfg,
            &peak_state(p, at_cn(2026, 11, 14, 13, 50))
        ));
    }

    #[test]
    fn quota_envelope_parsing() {
        let raw = serde_json::json!({
            "code": 200,
            "data": {
                "level": "Pro",
                "limits": [
                    { "type": "TOKENS_LIMIT", "unit": 3, "number": 5,
                      "percentage": 18.4, "total": 40000000, "nextResetTime": 1770000000000i64 },
                    { "type": "TOKENS_LIMIT", "unit": 6, "number": 1,
                      "percentage": 63.2, "nextResetTime": 1770500000000i64 },
                    { "type": "TIME_LIMIT", "percentage": 5.0 }
                ]
            }
        });
        let env: RawEnvelope = serde_json::from_value(raw).unwrap();
        let limits = env.data.unwrap().limits.unwrap();
        let p = policy_by_id("zai-v3").unwrap();
        // 复用 fetch_window 的解析逻辑:手工重放同一段规则
        let mut used = 0.0;
        let mut reset = 0i64;
        for l in &limits {
            if l.kind.as_deref() != Some("TOKENS_LIMIT") {
                continue;
            }
            if l.unit == Some(3.0) && l.number == Some(5.0) {
                used = l.percentage.unwrap_or(0.0);
                reset = l.next_reset_time.unwrap_or(0.0) as i64;
            }
        }
        assert!((used - 18.4).abs() < 1e-9);
        assert_eq!(reset, 1770000000000);
        assert_eq!(p.rel_rate(), 2.0);
    }
}
