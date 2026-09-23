# Gemini CLI 使用指南

> 在 Keyway 中配置并管理 Google Gemini CLI 的供应商:添加 Key、接入本地代理、查看实际请求去向并安全恢复。

## 它是怎么工作的

```
gemini CLI ──► Keyway 本地代理(127.0.0.1:9527)──► 默认选择 / 路由 / 故障转移 ──► 上游
```

- **接管**会在 `~/.gemini/.env` 写入 `GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:9527/__keyway/gemini`(原文件备份;其他变量保留)。
- 接管后启动的新进程会读取 `.env`;如果当前 Gemini 进程缓存了环境变量,请重启该进程后再发送请求,并用日志确认去向
- 你的 **API Key 存在本机 SQLCipher 加密数据库**,数据库主密钥由系统钥匙串保管;代理转发时向上游注入认证信息

## 前置条件

| 需要 | 说明 |
|---|---|
| Gemini CLI | 已安装并可运行 `gemini` 命令 |
| 一个 **Gemini API 兼容**供应商 | 提供 Gemini 格式接口(`/v1beta/...`)的 `base_url` + Key。注意:普通 OpenAI 兼容中转不能直接用于 Gemini CLI,需确认其支持 Gemini 格式 |
| Keyway | 已启动,绿色「代理运行中」 |

## 配置四步

### ① 切换到 Gemini 分组

### ② 添加供应商(`⌘N`)

| 字段 | 填写说明 | 示例 |
|---|---|---|
| 名称 | 自定义 | `My Gemini Relay` |
| 接口地址 | 供应商的 Gemini 兼容根地址(不带 `/v1beta`) | `https://relay.example.com` |
| API Key | 供应商的 Key(入本机加密数据库) | `AIza...` |

### ③ 设为当前 — 卡片 hover → 「切换」

### ④ 接管 — 顶栏「代理运行中」→ Gemini 行 → 「接管」

若 `~/.gemini/.env` 不存在,接管时会自动创建。

## 日常使用

与其他分组一致:卡片/托盘切换默认供应商,发送新请求后从日志确认去向;自动用量统计、铅笔编辑、垃圾桶删除。

## 取消接管

接管面板 → Gemini 行 → 「还原」。只回滚代理地址变量,保留其他变量的新改动;地址变量发生冲突时中止并保留文件和备份。

## 故障排查

| 现象 | 处理 |
|---|---|
| 502「未设置 gemini 的当前供应商」 | Gemini 分组未设「当前」→ 主界面点「切换」 |
| 404 / model not found | 供应商不支持当前模型;`gemini` 的模型设置改为该供应商支持的型号 |
| 400 / 格式错误 | 供应商不是 Gemini 格式兼容(只是 OpenAI 兼容)——换支持 Gemini API 的供应商 |
| 官方 OAuth 登录失效/被影响 | 「还原」即回直连;Keyway 不改你的 Google 登录状态 |
| ⚠️「配置被外部修改」 | 重新「接管」一次 |

## 与其他指南的差异速览

| | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| 接管改写的文件 | `~/.claude/settings.json` | `~/.codex/config.toml` | `~/.gemini/.env` |
| 接管后确认方式 | 发送新请求,必要时重开 | 新开会话并发送请求 | 重启进程后发送请求 |
| Key 注入方式 | 请求头 | 请求头 | URL 参数(与 Gemini API 一致) |

---

相关文档:[Claude Code](./claude-code.md) · [Codex](./codex.md) · [GLM 接入](./providers/glm.md) · [Kimi 接入](./providers/kimi.md)
