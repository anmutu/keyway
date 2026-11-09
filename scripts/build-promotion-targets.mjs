#!/usr/bin/env node
/**
 * Build docs/promotion/promotion-targets.html from docs/promotion/research/*.json
 *
 * Usage: node scripts/build-promotion-targets.mjs
 * Optional: node scripts/fetch-promo-stars.mjs first (writes research/stars.json)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RESEARCH_DIR = join(ROOT, "docs", "promotion", "research");
const OUT = join(ROOT, "docs", "promotion", "promotion-targets.html");

// ---------- type metadata ----------
const TYPES = {
  directory: "综合产品目录",
  "ai-directory": "AI 工具目录",
  community: "社区",
  forum: "论坛",
  reddit: "Reddit 版块",
  newsletter: "Newsletter",
  "awesome-list": "Awesome 列表",
  podcast: "播客",
  video: "视频/YouTube",
  pkg: "包管理/分发",
  "content-platform": "内容平台",
  social: "社交媒体",
  indie: "独立开发社区",
  "review-site": "评测/聚合",
  "app-portal": "软件下载站",
  qa: "问答",
};
const LANGS = { en: "EN", zh: "中文", ja: "日本語", multi: "多语" };
const COSTS = { free: "免费", freemium: "部分付费", paid: "付费" };
const EFFORTS = { 1: "① 填表即收", 2: "② 发帖/PR", 3: "③ 需信誉/审核" };
// 行动判定（computed）
const ACTIONS = {
  ok: "✅ 免费可做",
  cond: "🟡 有条件可做",
  paid: "💰 需付费",
  low: "⬇️ 低价值可选",
};

// ---------- load & validate ----------
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
function repoOf(url) {
  const m = String(url).match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}
function keyOf(url) {
  const d = domainOf(url);
  // repos & subreddits: identity is the path, not the domain
  if (d === "github.com" || d === "reddit.com" || d === "gitlab.com") {
    let p = "";
    try {
      p = new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
      p = p.replace(/^\/r\/([^/]+).*$/, "/r/$1"); // normalize subreddit paths
    } catch {
      /* keep */
    }
    return d + p;
  }
  return d;
}
function normEnum(v, table, fallback) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  return table[s] !== undefined ? s : fallback;
}
function actionOf(e) {
  if (e.cost === "paid") return "paid"; // 收费收录/赞助位——能做但要花钱，默认先不做
  if (e.priority <= 1) return "low"; // 能做但不值当
  if ((e.type === "awesome-list" || e.type === "pkg") && e.cost === "free") return "ok"; // 提 PR 进 GitHub 文件，免费
  if (e.cost === "free" && e.effort <= 2) return "ok"; // 填表/发帖即可
  if (e.cost === "freemium") return "cond"; // 免费但需回链/徽章/慢队列，或付费加速
  return "cond"; // effort 3：需社区信誉/严格审核
}

const STARS = existsSync(join(RESEARCH_DIR, "stars.json"))
  ? JSON.parse(readFileSync(join(RESEARCH_DIR, "stars.json"), "utf8"))
  : {};

const files = readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".json") && f !== "stars.json").sort();
const entries = [];
const problems = [];
for (const f of files) {
  const fp = join(RESEARCH_DIR, f);
  let arr;
  try {
    arr = JSON.parse(readFileSync(fp, "utf8"));
  } catch (e) {
    problems.push(`${f}: JSON parse failed — ${e.message}`);
    continue;
  }
  if (!Array.isArray(arr)) {
    problems.push(`${f}: not an array`);
    continue;
  }
  for (const it of arr) {
    if (!it || typeof it !== "object" || !it.name || !it.url) {
      problems.push(`${f}: entry missing name/url → ${JSON.stringify(it).slice(0, 80)}`);
      continue;
    }
    entries.push({
      name: String(it.name).trim(),
      url: String(it.url).trim(),
      submit: String(it.submit ?? "").trim(),
      type: normEnum(it.type, TYPES, "directory"),
      language: normEnum(it.language, LANGS, "en"),
      region: String(it.region ?? "global").trim() || "global",
      cost: normEnum(it.cost, COSTS, "free"),
      effort: [1, 2, 3].includes(Number(it.effort)) ? Number(it.effort) : 2,
      priority: [1, 2, 3, 4, 5].includes(Number(it.priority)) ? Number(it.priority) : 2,
      what: String(it.what ?? "").trim(),
      fit_note: String(it.fit_note ?? "").trim(),
      source: String(it.source ?? "memory").trim() || "memory",
      _file: f,
    });
  }
}

// ---------- dedupe ----------
const byKey = new Map();
const rank = (e) => e.priority * 100 + (e.source.startsWith("fetched") ? 10 : 0) + e.name.length;
for (const e of entries) {
  const k = keyOf(e.url);
  const prev = byKey.get(k);
  if (!prev || rank(e) > rank(prev)) byKey.set(k, e);
}
const list = [...byKey.values()];

// ---------- enrich: stars + action ----------
for (const e of list) {
  const repo = repoOf(e.url);
  e.stars = repo && STARS[repo] != null ? STARS[repo] : null;
  e.action = actionOf(e);
}
list.sort((a, b) => b.priority - a.priority || (b.stars ?? -1) - (a.stars ?? -1) || a.name.localeCompare(b.name, "zh"));

// ---------- stats ----------
const stat = (fn) => list.filter(fn).length;
const byType = {};
for (const t of Object.keys(TYPES)) {
  const n = stat((e) => e.type === t);
  if (n) byType[t] = n;
}
const stats = {
  total: list.length,
  p5: stat((e) => e.priority === 5),
  p4: stat((e) => e.priority === 4),
  zh: stat((e) => e.language === "zh"),
  en: stat((e) => e.language === "en"),
  ja: stat((e) => e.language === "ja"),
  fetched: stat((e) => e.source.startsWith("fetched")),
  files: files.length,
  ok: stat((e) => e.action === "ok"),
  cond: stat((e) => e.action === "cond"),
  paid: stat((e) => e.action === "paid"),
  low: stat((e) => e.action === "low"),
  withStars: stat((e) => e.stars != null),
};

// ---------- selling points ----------
const SELLING_POINTS = [
  ["完全免费 + 开源 (MIT)", "无订阅、无功能墙、无遥测；仓库即产品本身，「免费」本身就是推广话术。"],
  ["本地优先，Key 不出设备", "API Key 存 SQLCipher 加密库，主密钥放系统钥匙串；导出的配置永远不含 Key。不托管、不代收、不冒充官方。"],
  ["切换供应商不重启会话", "⌘⇧K 全局面板秒切；已被本地代理 (127.0.0.1:9527) 接管的会话，下一个请求即生效，编码心流不断。"],
  ["看清每一次请求去向", "请求日志逐条显示真实命中的供应商 / 模型 / 状态码 / 耗时 / 命中规则——中转站把请求发到哪，一目了然。"],
  ["模型路由 + 故障转移", "按模型名分流（contains / starts with），长上下文走指定供应商；429 / 5xx / 连接错误自动切候选链，回包带 x-keyway-fallback 头。"],
  ["8 个 CLI 一网打尽", "Claude Code · Codex · Gemini CLI · OpenCode · OpenClaw · Crush · Droid · Qwen Code；任意 OpenAI / Anthropic / Gemini 兼容端点可自定义。"],
  ["统一 MCP & Skills 管理", "MCP 服务器定义一次写入多个 CLI；Skills 本地库一键同步；手动配置永不覆盖。"],
  ["一键接管、随时还原", "接管前自动备份原配置（加密本地），Restore 一键还原；配置 Profile + 无 Key JSON 导出/合并。"],
  ["cc-switch 一键迁移", "识别历史命名后缀，竞品用户搜索词（cc-switch 迁移/替代）可直接承接。"],
  ["跨平台 + 一行安装", "macOS / Windows / Linux；brew install 或 curl 一行装；官网中英日三语。"],
];

// ---------- HTML ----------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtK = (n) => (n == null ? "" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

const rows = list.map((e, i) => ({
  ...e,
  idx: i + 1,
  typeLabel: TYPES[e.type] ?? e.type,
  langLabel: LANGS[e.language] ?? e.language,
  costLabel: COSTS[e.cost] ?? e.cost,
  actionLabel: ACTIONS[e.action],
}));

const DATA = JSON.stringify(rows);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keyway 推广目标库 · ${stats.total} 个渠道</title>
<style>
  :root{
    --bg:#0d1117;--panel:#161b22;--panel2:#1c2129;--border:#2d333b;
    --text:#e6edf3;--muted:#8b949e;--accent:#4cc38a;--accent2:#58a6ff;
    --warn:#d29922;--danger:#f85149;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
  a{color:var(--accent2);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:1320px;margin:0 auto;padding:32px 20px 80px}
  header h1{font-size:26px;margin:0 0 6px}
  header .sub{color:var(--muted);margin-bottom:4px}
  .badgeline{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}
  .badge{display:inline-block;padding:2px 10px;border:1px solid var(--border);border-radius:999px;
    font-size:12px;color:var(--muted);background:var(--panel)}
  h2{font-size:19px;margin:36px 0 12px;border-left:4px solid var(--accent);padding-left:10px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
  .card b{display:block;margin-bottom:4px;font-size:14.5px}
  .card span{color:var(--muted);font-size:13px}
  .notice{background:#2a2118;border:1px solid #634f2a;border-radius:10px;padding:12px 16px;color:#e3b341;font-size:13px;margin-top:14px}
  .legend{display:flex;flex-wrap:wrap;gap:14px;color:var(--muted);font-size:12.5px;margin:10px 0 0}
  .legend code{background:var(--panel2);border:1px solid var(--border);border-radius:4px;padding:1px 6px}
  .controls{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 12px;position:sticky;top:0;
    background:var(--bg);padding:12px 0;border-bottom:1px solid var(--border);z-index:5}
  .controls input,.controls select{background:var(--panel2);border:1px solid var(--border);color:var(--text);
    border-radius:8px;padding:7px 10px;font-size:13.5px}
  .controls input{flex:1;min-width:220px}
  .controls label{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;cursor:pointer}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13.5px}
  th{position:sticky;top:56px;background:var(--panel);text-align:left;padding:8px 10px;border-bottom:2px solid var(--border);
    color:var(--muted);font-weight:600;font-size:12.5px;cursor:pointer;user-select:none;white-space:nowrap;z-index:4}
  th:hover{color:var(--text)}
  td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top}
  tr:hover td{background:var(--panel)}
  .pname{font-weight:600}
  .tag{display:inline-block;border-radius:5px;padding:0 7px;font-size:11.5px;margin:1px 3px 1px 0;white-space:nowrap;border:1px solid var(--border)}
  .t-type{background:#12263a;color:#79c0ff}.t-lang{background:#1f2b1d;color:#7ee787}
  .t-cost-free{background:#1f2b1d;color:#7ee787}.t-cost-freemium{background:#2a2118;color:#e3b341}.t-cost-paid{background:#3d1d20;color:#ff7b72}
  .t-eff{background:#241d33;color:#d2a8ff}.t-mem{background:#2a2118;color:#e3b341}.t-fetch{background:#1f2b1d;color:#7ee787}
  .act-ok{background:#1f2b1d;color:#7ee787}.act-cond{background:#2a2118;color:#e3b341}.act-paid{background:#3d1d20;color:#ff7b72}.act-low{background:#222;color:var(--muted)}
  .stars{white-space:nowrap;color:#e3b341}
  .note{color:var(--muted);font-size:12.5px}
  .cbrow{white-space:nowrap;text-align:center}
  .cbrow input{transform:scale(1.25);cursor:pointer;accent-color:var(--accent)}
  tr.done td{opacity:.45}
  tr.done .pname{text-decoration:line-through}
  .count{color:var(--accent);font-weight:600}
  footer{color:var(--muted);font-size:12.5px;margin-top:40px;border-top:1px solid var(--border);padding-top:16px}
  @media (max-width:820px){ td.hide-sm,th.hide-sm{display:none} .wrap{padding:20px 12px 60px} }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>Keyway 推广目标库（${stats.total} 个渠道）</h1>
  <div class="sub">Keyway — 开源免费的 AI CLI 本地网关 · <a href="https://github.com/anmutu/keyway">github.com/anmutu/keyway</a> · <a href="https://keyway.one">keyway.one</a></div>
  <div class="sub note">生成日期 ${new Date().toISOString().slice(0, 10)} · 数据源 ${stats.files} 份研究文件 · GitHub Star 数为 API 实拉（${stats.withStars} 个仓库）· 仅供筛选评审</div>
  <div class="badgeline">
    <span class="badge">共 <span class="count">${stats.total}</span></span>
    <span class="badge">★★★★★ 精准 <span class="count">${stats.p5}</span></span>
    <span class="badge">★★★★ 较准 <span class="count">${stats.p4}</span></span>
    <span class="badge act-ok" style="border-radius:999px;padding:2px 10px;font-size:12px">✅ 免费可做 ${stats.ok}</span>
    <span class="badge act-cond" style="border-radius:999px;padding:2px 10px;font-size:12px">🟡 有条件 ${stats.cond}</span>
    <span class="badge act-paid" style="border-radius:999px;padding:2px 10px;font-size:12px">💰 需付费 ${stats.paid}</span>
    <span class="badge act-low" style="border-radius:999px;padding:2px 10px;font-size:12px">⬇️ 低价值 ${stats.low}</span>
    <span class="badge">中文 ${stats.zh}</span>
    <span class="badge">英文 ${stats.en}</span>
    <span class="badge">日文 ${stats.ja}</span>
    <span class="badge">已核实 ${stats.fetched} / 记忆 ${stats.total - stats.fetched}</span>
  </div>
  <div class="notice">⚠️ 标记 <code>记忆</code> 的条目未在线核实，提交前先打开链接确认存活与规则。<b>行动判定说明</b>：✅=免费且填表/发帖/提 PR 即可；🟡=能做但有条件（需回链/徽章、需社区信誉、慢队列）；💰=收录本身要花钱（默认不做）；⬇️=能做但不值当（受众太偏）。判定由成本/门槛/优先级自动计算，个例以「适配」栏提示为准。</div>
</header>

<h2>一、推广核心卖点（对外话术素材）</h2>
<div class="cards">
${SELLING_POINTS.map(([t, d]) => `<div class="card"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join("")}
</div>
<div class="legend">
  <span>一句话定位：<code>开源、本地、看清每一次请求的去向 —— 不托管 Key、不卖模型、不冒充官方</code></span>
</div>

<h2>二、怎么用这个页面</h2>
<div class="legend">
  <span>排序：默认 <code>优先级降序 → Star 数降序 → 名称</code>；点任意表头换排序（再点反向）</span>
  <span>优先级 <code>★★★★★</code> 精准受众（Claude Code / 多供应商开发者聚集地）</span>
  <span><code>Star</code> 列 = 渠道自身 GitHub 星数（列表/工具仓库的「势头」代理指标，非 GitHub 渠道为空）</span>
</div>
<div class="legend">
  <span>门槛：<code>① 填表即收</code> <code>② 需发帖/PR/内容</code> <code>③ 需社区信誉或审核严</code></span>
  <span>「类型」筛选里的 <code>Awesome 列表</code> + <code>包管理/分发</code> = 你说的「提 PR 到 GitHub 文件里免费收录」那一类</span>
  <span>每行复选框勾「待提交」（自动保存）；双击行标记完成</span>
</div>

<h2>三、全部渠道</h2>
<div class="controls">
  <input id="q" type="search" placeholder="搜索名称 / 说明 / 提交方式…（如 claude、awesome、填表）">
  <select id="fAction"><option value="">全部判定</option><option value="ok">✅ 免费可做</option><option value="cond">🟡 有条件</option><option value="paid">💰 需付费</option><option value="low">⬇️ 低价值</option></select>
  <select id="fType"><option value="">全部类型</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
  <select id="fLang"><option value="">全部语言</option><option value="zh">中文</option><option value="en">EN</option><option value="ja">日本語</option><option value="multi">多语</option></select>
  <select id="fPrio"><option value="">全部优先级</option><option value="5">★★★★★</option><option value="4">★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select>
  <select id="fCost"><option value="">全部成本</option><option value="free">免费</option><option value="freemium">部分付费</option><option value="paid">付费</option></select>
  <label><input type="checkbox" id="fChecked"> 只看待提交（<span id="nChecked">0</span>）</label>
  <label><input type="checkbox" id="fHideDone"> 隐藏已完成</label>
  <span class="note" id="nShown"></span>
</div>
<table id="tbl">
  <thead><tr>
    <th style="width:36px">✓</th>
    <th style="width:44px">#</th>
    <th data-k="name">名称</th>
    <th data-k="action">行动判定</th>
    <th data-k="type" class="hide-sm">类型</th>
    <th data-k="priority">优先级</th>
    <th data-k="stars">Star</th>
    <th data-k="language" class="hide-sm">语言</th>
    <th data-k="cost" class="hide-sm">成本/门槛</th>
    <th>是什么 / 怎么提交 / 适配点</th>
  </tr></thead>
  <tbody></tbody>
</table>

<footer>
  <div>方法说明：4 路并行调研 + 1 份手补（英文创业目录 · AI 工具目录 · 中文渠道 · 开发者生态+日本），按域名/仓库路径去重；GitHub Star 经 gh API 实拉；行动判定按 成本×门槛×优先级 自动计算。重跑：<code>node scripts/fetch-promo-stars.mjs && node scripts/build-promotion-targets.mjs</code>。</div>
  <div style="margin-top:6px">红线提醒：不刷 star、不群发同一文案、被删帖先读版规；对外承诺与 README「使用边界」保持一致。</div>
</footer>

</div>
<script>
const DATA = ${DATA};
const LS_KEY = "keyway-promo-checked";
let checked = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
let sortKey = "priority", sortDir = -1;

const tb = document.querySelector("#tbl tbody");
const $ = (id) => document.getElementById(id);

function rowHTML(e){
  const isDone = checked.has(e.idx+"_done");
  return \`<tr class="\${isDone ? "done" : ""}" data-idx="\${e.idx}">
    <td class="cbrow"><input type="checkbox" data-cb="\${e.idx}" \${checked.has(e.idx)?"checked":""}></td>
    <td class="note">\${e.idx}</td>
    <td><span class="pname"><a href="\${e.url}" target="_blank" rel="noopener">\${e.name}</a></span><br>
        <span class="tag \${e.source.startsWith("fetched")?"t-fetch":"t-mem"}">\${e.source.startsWith("fetched")?"已核实":"记忆"}</span></td>
    <td><span class="tag act-\${e.action}">\${e.actionLabel}</span></td>
    <td class="hide-sm"><span class="tag t-type">\${e.typeLabel}</span></td>
    <td><span class="stars">\${"★".repeat(e.priority)}\${"☆".repeat(5-e.priority)}</span></td>
    <td class="stars">\${e.stars!=null ? "⭐ "+e.stars : ""}</td>
    <td class="hide-sm"><span class="tag t-lang">\${e.langLabel}</span></td>
    <td class="hide-sm"><span class="tag t-cost-\${e.cost}">\${e.costLabel}</span> <span class="tag t-eff">\${e.effort==1?"①":e.effort==2?"②":"③"}</span></td>
    <td>\${e.what ? "<div>"+e.what+"</div>" : ""}
        \${e.submit ? '<div class="note">提交：'+e.submit+"</div>" : ""}
        \${e.fit_note ? '<div class="note">适配：'+e.fit_note+"</div>" : ""}</td>
  </tr>\`;
}

function render(){
  const q = $("q").value.trim().toLowerCase();
  const fA = $("fAction").value, fT = $("fType").value, fL = $("fLang").value, fC = $("fCost").value,
        fP = $("fPrio").value, onlyChecked = $("fChecked").checked, hideDone = $("fHideDone").checked;
  let rows = DATA.filter(e=>{
    if(fA && e.action!==fA) return false;
    if(fT && e.type!==fT) return false;
    if(fL && e.language!==fL) return false;
    if(fC && e.cost!==fC) return false;
    if(fP && String(e.priority)!==fP) return false;
    if(onlyChecked && !checked.has(e.idx)) return false;
    if(hideDone && checked.has(e.idx+"_done")) return false;
    if(q){
      const hay = (e.name+" "+e.what+" "+e.submit+" "+e.fit_note+" "+e.typeLabel+" "+e.langLabel+" "+e.actionLabel).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  rows.sort((a,b)=>{
    const va=a[sortKey], vb=b[sortKey];
    const c = (typeof va==="number"||va==null)&&(typeof vb==="number"||vb==null)
      ? ((va??-1)-(vb??-1))
      : String(va??"").localeCompare(String(vb??""),"zh");
    return c*sortDir || (b.priority-a.priority) || ((b.stars??-1)-(a.stars??-1)) || a.idx-b.idx;
  });
  tb.innerHTML = rows.map(rowHTML).join("");
  $("nShown").textContent = "显示 "+rows.length+" / "+DATA.length;
  $("nChecked").textContent = [...checked].filter(x=>!String(x).endsWith("_done")).length;
  tb.querySelectorAll("input[data-cb]").forEach(cb=>cb.addEventListener("change",()=>{
    const i = +cb.dataset.cb;
    if(cb.checked) checked.add(i); else { checked.delete(i); checked.delete(i+"_done"); }
    localStorage.setItem(LS_KEY, JSON.stringify([...checked]));
    $("nChecked").textContent = [...checked].filter(x=>!String(x).endsWith("_done")).length;
  }));
  tb.querySelectorAll("tr").forEach(tr=>tr.addEventListener("dblclick",(ev)=>{
    if(ev.target.closest("input,a")) return;
    const i = tr.dataset.idx+"_done";
    if(checked.has(i)) checked.delete(i); else { checked.add(i); checked.add(+tr.dataset.idx); }
    localStorage.setItem(LS_KEY, JSON.stringify([...checked]));
    render();
  }));
}
document.querySelectorAll("th[data-k]").forEach(th=>th.addEventListener("click",()=>{
  const k = th.dataset.k;
  if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir = (k==="priority"||k==="stars")?-1:1; }
  render();
}));
["q","fAction","fType","fLang","fCost","fPrio","fChecked","fHideDone"].forEach(id=>{
  const el=$(id); el.addEventListener("input",render); el.addEventListener("change",render);
});
render();
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
const mtime = statSync(OUT);
console.log(
  `✔ ${OUT} (${(mtime.size / 1024).toFixed(0)} KB)\n` +
    `  entries: ${list.length} (from ${entries.length} raw, ${entries.length - list.length} dupes removed)\n` +
    `  files: ${files.join(", ")}\n` +
    `  actions: ✅${stats.ok} 🟡${stats.cond} 💰${stats.paid} ⬇️${stats.low} | stars: ${stats.withStars}\n` +
    (problems.length ? `  ⚠ problems:\n  - ${problems.join("\n  - ")}` : "  no schema problems"),
);
