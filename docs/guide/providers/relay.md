# RELAY 接入 Keyway：管理与切换 AI 服务

Keyway 是本机的 AI 服务管理器，不是一次性的配置跳转。你可以把 **RELAY、CoderPlan、官方 API 或其他上游**分别保存为服务，保留现有配置，再按需要切换哪个服务供 Claude Code、Codex、OpenCode 或 OpenClaw 使用。

Keyway 的这些客户端分组可直接在“添加供应商”中选择 **RELAY**。RELAY 的接口地址由你的部署决定，因此预设不会填写固定生产域名。输入自己的 API Base URL 和 API Key，核对保存前展示的最终端点，并勾选确认。

Keyway 当前把 Codex 归入 OpenAI 协议，保存时会在根地址后补 `/v1`；Claude Code、OpenCode、OpenClaw 使用 Anthropic 根地址。已经以 `/v1` 结尾的 Codex 地址不会重复追加。

RELAY 也可以从网页打开已安装的 Keyway。链接格式为：

```text
keyway://connect/relay?v=1&base=<URL-encoded HTTPS API root>&app=<claude|codex|opencode|openclaw>
```

RELAY 可以在用户确认 Model ID 后附带一个可选的预选模型：

```text
keyway://connect/relay?v=1&base=<URL-encoded HTTPS API root>&app=<claude|codex|opencode|openclaw>&model=<model-id>
```

`model` 只接受长度不超过 128 个字符、以字母或数字开头、由字母数字和 `._:/-` 组成的模型标识符。旧的、不带 `model` 的 v1 链接继续有效。Keyway 会在确认页展示该模型，并把它保存到供应商的模型列表；它不会改变 CLI 的全局模型选择，也不会绕过 API Key 确认。

已登录的 RELAY 用户可以通过一次性 handoff 授权省略手动粘贴 Key：

```text
keyway://connect/relay?v=1&base=<URL-encoded-HTTPS-root>&app=<cli>&model=<model-id>&handoff=<64-character-one-time-code>
```

Keyway 只在用户勾选确认后向该地址的 `/api/keyway/handoff/exchange` 发起一次 POST。授权码只使用一次、不会保存或写入日志；交换失败时不会创建供应商。没有 `handoff` 的旧链接继续要求用户手动粘贴 Key。生产链接必须使用 HTTPS，且不得包含 API Key、userinfo、query 或 fragment。

链接只传公开的 API 根地址和 CLI 类型，**不要把 API Key 放进链接或任何查询参数**。Keyway 会显示来源地址和目标 CLI，由你手动粘贴 Key 并确认保存。正式版仅接受 HTTPS；开发版允许 `http://localhost` 或 `http://127.0.0.1` 用于本地联调。

保存后可以在 Keyway 的服务列表中看到 RELAY，与其他 AI 服务并列。你可以先只保存，不改变当前正在使用的服务；准备好后再通过“切换”或“管理接管”让目标 CLI 使用 RELAY。保存供应商和接管 CLI 是两次独立操作；已有默认供应商不会因导入链接而被切换。若该 CLI 还没有默认供应商，新建的 RELAY 会成为默认供应商。
