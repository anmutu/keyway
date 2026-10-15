# 贡献指南

## 申请收录供应商

供应商或社区成员可以通过 [供应商预设收录申请](https://github.com/anmutu/keyway/issues/new?template=provider-submission.yml) 提交公开信息。应用内“添加供应商”窗口和官网也提供这个入口。

流程是:

1. 提交 Issue Form,只填写官网、公开 API 文档、Base URL、协议和模型等信息。
2. 维护者核对官方文档、端点安全性、协议兼容性和实际连通性。
3. 维护者把通过审核的内容整理为 `src/data/providerPresets.ts` 中的 PR。
4. PR 通过 CI 并人工合并后,下一次版本发布会把该预设带入 Keyway。

收录是公开代码贡献,不是远程配置下发。Keyway 不会从供应商服务器读取预设、远程执行代码或接收用户 API Key。供应商提交不能包含 API Key、账号密码、用户数据、推广参数或内部日志;`apiKeyUrl` 必须是干净的官方地址。

## 供应商预设收录(src/data/providerPresets.ts)

欢迎通过 PR 补充供应商预设,按以下规则审核:

### 免费收录

满足任一条件的预设免费收录:

- **官方**:模型厂商自己的端点(如 Anthropic、智谱、Moonshot、DeepSeek…)
- **优质第三方/中转站**:运营 ≥ 3 个月、有公开文档与定价、无重大跑路/安全事故记录

### 合作伙伴(赞助位)

- 付费收录,条目带「赞助」角标(`partner: true`),UI 明示,不做隐性推广
- **推广参数只允许出现在 `websiteUrl`**;`apiKeyUrl` 必须是干净的控制台地址,不得带任何 `?aff=` / `?ref=` 参数
- 赞助位不改变排序权重之外的质量底线:仍需可用、稳定的端点,翻车即下架

### PR 格式

在对应 `AppType` 数组中追加一条:

```ts
{
  name: "供应商名",
  baseUrl: "https://api.example.com",   // 必须与官方文档一致的端点
  category: "cn_official",              // official | cn_official | aggregator | third_party
  websiteUrl: "https://example.com",
  apiKeyUrl: "https://example.com/keys", // 不带推广参数
}
```

PR 描述中请附上官方文档链接,便于核对端点。

## 一般贡献

`pnpm install && pnpm tauri dev` 本地跑通,`pnpm build` 通过后提交即可。
