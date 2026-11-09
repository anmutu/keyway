#!/usr/bin/env node
/** Build docs/promotion/submission-report.html from docs/promotion/submissions/form-log.md */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOG = join(ROOT, "docs", "promotion", "submissions", "form-log.md");
const OUT = join(ROOT, "docs", "promotion", "submission-report.html");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rows = existsSync(LOG)
  ? readFileSync(LOG, "utf8").split("\n").filter((l) => l.startsWith("|")).map((l) =>
      l.split("|").slice(1, 4).map((s) => s.trim()),
    )
  : [];

const submitted = rows.filter((r) => r[1]?.includes("✅"));
const uncertain = rows.filter((r) => r[1]?.includes("⚠️"));
const skipped = rows.filter((r) => r[1]?.includes("⏭️"));
const cls = (r) => (r[1].includes("✅") ? "ok" : r[1].includes("⚠️") ? "warn" : "skip");

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keyway 推广执行报告</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:24px}h2{font-size:18px;margin:32px 0 10px;border-left:4px solid #4cc38a;padding-left:10px}
.sub{color:#8b949e}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.stat{background:#161b22;border:1px solid #2d333b;border-radius:10px;padding:10px 18px;text-align:center}
.stat b{display:block;font-size:22px}.stat span{color:#8b949e;font-size:12px}
.ok b{color:#4cc38a}.warn b{color:#d29922}.skip b{color:#8b949e}.info b{color:#58a6ff}
table{width:100%;border-collapse:collapse;font-size:13.5px}
td,th{padding:8px 10px;border-bottom:1px solid #2d333b;text-align:left;vertical-align:top}
th{color:#8b949e;font-size:12.5px}
tr.ok td{background:#12261c}tr.warn td{background:#241d10}
.note{background:#2a2118;border:1px solid #634f2a;border-radius:10px;padding:12px 16px;color:#e3b341;font-size:13px}
footer{margin-top:40px;color:#8b949e;font-size:12.5px;border-top:1px solid #2d333b;padding-top:14px}
</style></head><body><div class="wrap">
<h1>Keyway 推广执行报告</h1>
<div class="sub">更新于 ${new Date().toLocaleString("zh-CN")} · 仅含零痕迹渠道（网页表单），GitHub 层已按你的要求全部撤出并清理</div>
<div class="stats">
<span class="stat ok"><b>${submitted.length}</b><span>已提交</span></span>
<span class="stat warn"><b>${uncertain.length}</b><span>已触发未确认</span></span>
<span class="stat skip"><b>${skipped.length}</b><span>跳过（墙/登录/付费/回链）</span></span>
<span class="stat info"><b>${rows.length}</b><span>已处理渠道</span></span>
</div>
<div class="note">进行中：P3/P2 长尾目录持续扫描提交中，本页随进度更新（重跑 <code>node scripts/build-submission-report.mjs</code>）。</div>
<h2>提交结果明细</h2>
<table><thead><tr><th style="width:180px">渠道</th><th style="width:150px">结果</th><th>说明</th></tr></thead><tbody>
${rows.map((r) => `<tr class="${cls(r)}"><td><b>${esc(r[0] ?? "")}</b></td><td>${esc(r[1] ?? "")}</td><td>${esc(r[2] ?? "")}</td></tr>`).join("\n")}
</tbody></table>
<h2>GitHub 痕迹清理（已完成）</h2>
<table><thead><tr><th>动作</th><th>结果</th></tr></thead><tbody>
<tr><td>停止全部 fork/PR 推广（3 个 agent 零写入）</td><td>✅ 无新增痕迹</td></tr>
<tr><td>关闭 14 个历史推广 PR（含 Keyway #45、awesome-mac #3649）</td><td>✅ 全部 closed</td></tr>
<tr><td>删除推广 fork（anmutu 15 + teapot-router 13）</td><td>⏸ 等你在终端跑一次授权：<code>gh auth refresh -h github.com -s delete_repo -u anmutu</code>（之后同样授权 teapot-router）</td></tr>
</tbody></table>
<footer>红线遵守：无小号、无刷量、未付任何费用、未在你官网挂任何徽章、联系邮箱统一用 GitHub noreply。</footer>
</div></body></html>`;

writeFileSync(OUT, html);
console.log(`✔ ${OUT} — 已提交 ${submitted.length} / 未确认 ${uncertain.length} / 跳过 ${skipped.length}（共 ${rows.length} 行）`);
