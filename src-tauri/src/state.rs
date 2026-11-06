//! 进程级共享状态。
//!
//! `AppState` 同时被 Tauri 命令层和 axum 代理共享(都实现 `Clone`):
//! - `db`: r2d2 连接池,内部已是 `Arc`,克隆廉价
//! - `http`: reqwest 连接池客户端,复用 TCP 连接
//!
//! 代理热路径不持有全局锁:`get_current` 直接走 DB 池,并发请求各取各的连接。

use crate::db::Pool;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[derive(Clone, Default)]
pub struct ProxyRuntime(Arc<AtomicBool>);

impl ProxyRuntime {
    pub fn is_running(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    pub(crate) fn listening(&self) -> ProxyRunningGuard {
        self.0.store(true, Ordering::Release);
        ProxyRunningGuard(self.0.clone())
    }
}

pub(crate) struct ProxyRunningGuard(Arc<AtomicBool>);

impl Drop for ProxyRunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Pool,
    pub http: reqwest::Client,
    /// 直连兜底客户端:忽略系统/环境代理。代理转发连接失败时(常见于应用继承了
    /// 指向已失效本地代理的 HTTP_PROXY 环境变量),用它重试一次,还原真实网络状态。
    pub http_direct: reqwest::Client,
    pub proxy: ProxyRuntime,
    /// Tauri 应用句柄(emit 事件用);测试环境为 None
    pub app: Option<tauri::AppHandle>,
}

impl AppState {
    pub fn new(db: Pool) -> Self {
        Self::with_handle(db, None)
    }

    pub fn with_handle(db: Pool, app: Option<tauri::AppHandle>) -> Self {
        let connect_timeout = std::time::Duration::from_secs(10);
        let read_timeout = std::time::Duration::from_secs(300);
        let http = reqwest::Client::builder()
            // 连接 10s 建不上来即判故障,尽快故障转移(黑洞式上游不再挂 10 分钟)
            .connect_timeout(connect_timeout)
            // 读空闲超时:流式响应只要还在出数据就不断;300s 无任何字节才判死
            .read_timeout(read_timeout)
            .build()
            .expect("reqwest client 构建失败");
        let http_direct = reqwest::Client::builder()
            .connect_timeout(connect_timeout)
            .read_timeout(read_timeout)
            .no_proxy()
            .build()
            .expect("reqwest direct client 构建失败");
        Self {
            db,
            http,
            http_direct,
            proxy: ProxyRuntime::default(),
            app,
        }
    }
}
