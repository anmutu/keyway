# Keyway 设计文档

> 面向个人开发者的本地 AI 代理 + 多 CLI 供应商管理器。交互参考包括 cc-switch,不对竞品能力作未经核验的结论。

## 1. 一句话定位

**Keyway 的核心是让 CLI 请求先进入本地网关,再由默认供应商、路由与故障转移决定去向。**
默认供应商只是未命中其他策略时的选择;实际去向以请求日志为准。API Key 存储在 SQLCipher 加密数据库,数据库主密钥由系统钥匙串保管。

## 2. 差异化主轴

| 主轴 | Keyway 当前做法 |
|---|---|
| 请求去向 | 首页同时展示默认供应商与最近一次实际去向;请求日志保留模型、状态码和路由命中 |
| 路由可解释性 | 首页可输入模型名试算命中规则、首选供应商与回退顺序;试算只读本地配置,不发请求 |
| 故障恢复 | 分组错误率告警只统计当前 CLI;失败请求详情直接提供快速切换、重新检测与错误摘要复制 |
| 本地网关 | 接管后的 CLI 通过应用专属本地路径进入同一个代理,避免不同 CLI 的相同 API 路径串组 |
| 凭证存储 | API Key 存 SQLCipher 加密数据库;数据库主密钥由系统钥匙串保管 |

推迟项(已论证):成本归因(M2)、团队(M3)、wrapper 注入(不做,代理路线更稳)。

## 3. 技术栈

- **桌面**:Tauri 2.8+(Rust 后端 + React 19/TS 前端)
- **代理**:axum 0.8 + reqwest 0.13(流式转发,支持 SSE)
- **DB**:rusqlite 0.40 + `bundled-sqlcipher-vendored-openssl` + r2d2 连接池 + WAL
- **凭证**:`keyring` 4(macOS Keychain / Win DPAPI / Linux Secret Service)
- **前端**:Vite 7、Tailwind、Radix UI

## 4. 架构

```
前端 React ──IPC──▶ commands/ (薄)
                       │
                  services/ (provider · keychain)
                       │
                   db/ (pool + SQLCipher + WAL)
                       
  本地代理 axum :9527 ◄── CLI 流量(takeover 后 base_url 指向 /__keyway/{app})
    去掉应用前缀 → 按协议分流 → 查默认/路由/故障转移 → 加密库取 Key → 注入凭证 → 流式转发
```

**设计原则:**
- 代理优先:takeover 后请求进入本地网关;切换默认选择不写 live 文件,对已接入会话通常无需重启
- Key 不返回前端:`Provider` 结构不含 key 字段;`api_keys` 表在 SQLCipher 加密库中保存密钥
- 并发访问:r2d2 连接池 + WAL;不据此推断竞品实现
- 接管可恢复:先保存备份再写文件;还原检测冲突。文件系统与数据库并非同一事务

## 5. 分组与协议

| AppType | 本地接管路径 | 上游协议 / 凭证形式 |
|---|---|---|
| 任意分组 | `/__keyway/{app}/v1/messages` | Anthropic: `x-api-key` + `anthropic-version` |
| 任意分组 | `/__keyway/{app}/v1/chat/completions`、`/responses` | OpenAI: `Authorization: Bearer` |
| 任意分组 | `/__keyway/{app}/v1beta/...` | Gemini: URL query |

分组选择默认供应商和日志归属;剥离分组前缀后的请求路径决定客户端协议。两者不可混为一谈。

## 6. 主要数据表

```sql
providers(id, app_type, name, base_url, keychain_id, models JSON,
          is_current, is_healthy, sort_index, created_at, meta)
settings(key, value)
api_keys(provider_id, key)
current_map(app_type, provider_id)
usage_log(...)
```

注意:`providers` 刻意不存 API Key 明文。

## 7. 核心文件地图

```
src-tauri/src/
  types.rs            # AppType, Provider(无 key 字段), ProviderInput
  state.rs            # AppState { db pool, http client }
  db/                 # mod.rs(池+SQLCipher) schema.rs provider_dao.rs
  services/           # keychain.rs provider.rs
  core/proxy/         # mod.rs server.rs(分流+转发)
  commands/           # provider.rs proxy.rs keychain.rs
  lib.rs              # 组装:tracing→keychain→db→spawn proxy→register
src/
  App.tsx types.ts index.css # 页面编排、共享类型和样式
```

## 8. 历史规划(非当前完成清单)

- **M0**:脚手架 + 代理骨架 + 加密 DB + keychain + 前端空壳。
- **M1(MVP)**:5 CLI takeover + provider CRUD + 代理内默认选择 + 托盘 + 故障转移 + 首启向导。
- **M2**:成本归因(项目/会话/模型)+ MCP/Skills + 云同步 + Deep Link。
- **M3**:团队配置共享 + 权限。

## 9. 当前边界

- 浏览器 `?demo=1` 只展示前端交互,不等同于真实 Tauri、钥匙串、CLI 配置或上游验收
- 自动接管目前覆盖 Claude Code、Codex、Gemini CLI、OpenCode、OpenClaw;其余分组可管理供应商,需按 CLI 支持的变量手动接入
- 还原会检查配置是否仍保持 Keyway 写入的目标值;检测到外部修改时会中止,避免覆盖用户改动
- 流式请求已经发出后无法无损迁移;故障转移只对仍可重试的请求生效
