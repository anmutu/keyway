//! 代理状态命令。

use serde::Serialize;

use crate::core::proxy::PROXY_ADDR;
use crate::state::{AppState, ProxyRuntime};
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ProxyStatus {
    /// 代理监听地址
    pub addr: String,
    pub running: bool,
    /// 支持的 CLI 应用
    pub supported_apps: Vec<String>,
}

#[tauri::command]
pub fn proxy_status(state: State<'_, AppState>) -> ProxyStatus {
    snapshot(&state.proxy)
}

fn snapshot(runtime: &ProxyRuntime) -> ProxyStatus {
    ProxyStatus {
        addr: PROXY_ADDR.to_string(),
        running: runtime.is_running(),
        supported_apps: crate::types::AppType::all()
            .iter()
            .map(|a| a.as_str().to_string())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_without_listener_is_not_running() {
        assert!(!snapshot(&ProxyRuntime::default()).running);
    }

    #[test]
    fn proxy_status_follows_listener_lifetime() {
        let runtime = ProxyRuntime::default();
        let shared = runtime.clone();
        let listening = runtime.listening();
        assert!(snapshot(&shared).running);
        drop(listening);
        assert!(!snapshot(&shared).running);
    }
}
