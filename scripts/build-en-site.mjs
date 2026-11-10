// 从 site/index.html(中文)生成 site/en/index.html(英文静态页)。
// 英文文案维护在下方 EN_DICT;资源相对路径改写为 ../。
// 用法: node scripts/build-en-site.mjs   (修改中文主页或 EN_DICT 后请重新运行)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EN_DICT = {
  navF: "Features", navL: "Local-first", navCap: "Capabilities", navFAQ: "FAQ", navG: "Guide", navSubmit: "Suggest a provider", navQ: "Start", navD: "Download", navBlog: "Blog",
  readGuide: "Read the guide", navG2: "Guide",
  tagline: "Know where your requests go.",
  motto: "One key, one way.",
  fPrivacy: "Privacy", fTerms: "Terms", fBlog: "Blog",
  installOneLiner: "macOS: one terminal line installs (or updates) — no Gatekeeper prompts:",
  pvPTitle: "Common providers built in — just paste your key.",
  pvPSub: "Presets for official endpoints, popular model services and third-party gateways; any OpenAI / Anthropic / Gemini compatible endpoint works too.",
  pvMine: "affiliated",
  pvMore: "+ custom endpoints",
  pvNote: "Want your service listed?",
  pvSubmitLink: "Submit a provider",
  heroSub: "Provider switching, model routing, automatic failover and request logs for <b>Claude Code, Codex, Gemini CLI, OpenCode</b> — no session restarts, see exactly where every request goes. API keys encrypted on-device. Free, open source (MIT).",
  heroProof1: "Switch without restarting sessions", heroProof2: "9 AI CLIs", heroProof3: "Keys encrypted on-device · Free · MIT",
  learnMore: "Learn more", freeDl: "Download for Apple silicon", freeDl2: "Download free", submitProvider: "Suggest a provider",
  intelDl: "macOS · Intel",
  appleDl: "macOS · Apple silicon",
  windowsDl: "Windows", linuxDl: "Linux AppImage", allDl: "All platforms",
  versionNote: "Latest stable release v0.2.16 · macOS / Windows / Linux",
  fTitle: "More clarity. Not just switching.", fSub: "Default providers, connection status and actual requests — clearly distinguished.",
  f1t: "Switch with clarity.", f1d: "Sessions already using the proxy need no restart when changing the default provider. New requests follow the updated configuration; in-flight requests do not migrate.",
  f2t: "Encrypted key storage.", f2d: "API keys live in a local SQLCipher-encrypted database; its master key is held in the system keychain. Provider configuration exports exclude API keys.",
  f3t: "Errors you can inspect.", f3d: "Check providers, models, status codes and errors in request logs. When routing or failover changes the destination, you have more than a guess.",
  localEyebrow: "Local-first · not a hosted relay",
  localTitle: "Know where every request goes.",
  localSub: "Keyway keeps the control plane on your machine: it does not host your API keys, sell model access, or present the default provider as the actual destination.",
  flowCli: "Your CLI", flowLocal: "Local proxy · 127.0.0.1:9527", flowProvider: "Your chosen provider", flowProviderSub: "Official · relay · self-hosted endpoint",
  localNote1t: "Keys stay local", localNote1d: "Stored in an encrypted local database; exports exclude API keys.",
  localNote2t: "Separate the states", localNote2d: "Proxy running, CLI takeover and request success are three different things.",
  localNote3t: "Reversible changes", localNote3d: "Original configs are backed up; conflicts stop an overwrite.",
  tTitle: "Switching, in a keystroke.", tSub: "Connect to the proxy first, then switch your default provider. Start a new Codex session after first-time takeover; later switches need no restart.",
  qsCap: "The ⌘⇧K quick switch panel — no config to touch",
  qsFoot: "↑↓ navigate · Enter switch · 1-9 pick · Esc close",
  capTitle: "Far more than switching.",
  capSub: "From key safety to request observability, Keyway is the local gateway for your AI CLIs.",
  c1t: "Automatic failover", c1d: "Configure and enable a backup chain to try the next candidate after retryable upstream failures. Recovery is not guaranteed once a streaming response has begun.",
  c2t: "Model routing rules", c2d: "Route specific models to specific providers: e.g. claude-* to official, deepseek-* to a relay — preview the path, then dispatch by model name.",
  c3t: "Request logs", c3d: "The last 100 requests, item by item: actual provider, model, tokens in/out, status code and latency. Debugging at a glance.",
  c4t: "Usage & success rate", c4d: "Token usage and request success rate aggregated by CLI and by provider. Who's stable, who's costly — let data decide.",
  c5t: "Multiple profiles", c5d: "Work / personal / testing — snapshot provider sets, save and switch anytime without interference.",
  c6t: "Backup & migration", c6d: "Export provider configs to JSON with one click (keys excluded). Moving machines or sharing presets is easy. Imports from the 5 CLIs with automatic takeover.",
  c7t: "Key vault", c7d: "API keys are stored in a local SQLCipher-encrypted database; its master key is held in the system keychain. Provider configuration exports exclude API keys.",
  c8t: "Connectivity test", c8d: "One-click latency and reachability test per provider, before you switch.",
  c9t: "Onboarding + tray", c9d: "A three-step wizard: pick CLIs, add providers, take over in one click. Lives in the menu bar for instant switching.",
  qsTitle: "Up and running in three steps.",
  qsGuide: "Step-by-step guide", qsSubmit: "Suggest a provider",
  s1t: "Add a provider.", s1d: "Or import from existing CLI configs or another switcher in one click. GLM, Kimi, official, any relay.",
  qsShotCap: "Add a provider — presets ready to go, or migrate from another switcher in one click",
  migSrc: "Already in <b>another switcher</b>",
  migDst: "<b>Keyway</b> provider pool",
  migBadge: "✓ 3 providers migrated · source configs untouched",
  migCap: "One-click migration: bring providers over from another switcher — just select and import",
  s2t: "One-click takeover.", s2d: "Originals backed up, restorable anytime.",
  s3t: "Switch in a tap.", s3d: "Send a new request, then check its actual provider and response status in the logs.",
  pvTitle: "Two looks. Same excellence.",
  lightMode: "Light", darkMode: "Dark",
  faqTitle: "Frequently asked questions.",
  q1: "How does Keyway work?", a1: "Keyway runs a local proxy (127.0.0.1:9527). Connected CLI requests follow your default provider, routing rules and failover settings. Request logs show actual destinations.",
  q2: "How are my API keys stored?", a2: "API keys live in a local SQLCipher-encrypted database; its master key is held in the system keychain. Provider configuration exports exclude API keys. Authentication is sent to the selected upstream when forwarding requests.",
  q3: "Which AI CLIs are supported?", a3: "Keyway provides 9 CLI groups across the Anthropic / OpenAI / Gemini protocols. Claude Code, Codex CLI, Gemini CLI, OpenCode and OpenClaw support automatic takeover; other groups can be connected manually using the variables supported by each CLI.",
  q4: "Do I need to restart running sessions after switching?", a4: "Sessions already using the proxy need no restart when changing the default provider. New requests follow the updated configuration; in-flight requests do not migrate. First-time Codex takeover needs a new session, and routing rules still take priority.",
  q5: "Can I use multiple providers at once?", a5: "Yes. Model routing rules send different models to different providers; failover switches to backups on upstream errors; profiles swap whole work / personal setups in one tap.",
  q6: "How do I revert to my original setup?", a6: "Click Restore in takeover management to undo Keyway's configuration changes while keeping unrelated edits. Conflicts in managed fields or generated entries stop the restore; the file and backup are retained for inspection.",
  q7: "Is it free?", a7: "Keyway is completely free and open source (MIT). You only pay the model providers you use.",
  q8: "Will my CLI work after quitting Keyway?", a8: "CLIs connected to the local proxy depend on Keyway running. Closing the window keeps it in the tray; fully quitting stops the proxy. Restore configs first if you need direct connections. An offline proxy and an upstream provider failure are different states.",
  fn1: "* Configuration and usage records are stored in an encrypted local database. The proxy sends request content and authentication to the selected model provider; local storage does not mean offline inference.",
  fn2: "** Claude Code, Codex, Gemini CLI, OpenCode and OpenClaw are products of their respective owners; Keyway is not affiliated with Anthropic, OpenAI or Google.",
  darkVer: "Dark version",
};

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), "../site");
const src = readFileSync(resolve(siteDir, "index.html"), "utf8");
if (/var I18N|langToggle/.test(src)) {
  throw new Error("site/index.html still contains inline i18n code; it should be a clean Chinese page now");
}

let html = src;

// <html lang>(h1 为语言无关的 keyway.one 开场动画结构,无需句号替换)
html = html.replace('<html lang="zh-CN">', '<html lang="en">');

// c2d 含嵌套 <code>,整段替换后再走通用替换
html = html.replace(
  /(<p data-i18n="c2d">)[\s\S]*?(<\/p>)/,
  "$1" + EN_DICT.c2d.replace(/claude-\*/g, "<code>claude-*</code>").replace(/deepseek-\*/g, "<code>deepseek-*</code>") + "$2"
);

// 通用替换:所有 data-i18n 元素的中文文本 → 英文
html = html.replace(/(data-i18n="([^"]+)"[^>]*>)([^<]*)(<\/)/g, (m, open, _key, _text, close) => {
  const val = EN_DICT[_key];
  return val === undefined ? m : open + val + close;
});

// 移除 data-i18n 标记
html = html.replace(/ data-i18n="[^"]*"/g, "");

// 语言切换链接 → 中文站

// 相对资源路径 ./ → ../(logo、截图、guide、release-sync);博客仍位于英文站根目录下。
html = html.replace(/(src|href)="\.\//g, '$1="../');
html = html.replace(/href="\.\.\/blog\//g, 'href="./blog/');
html = html.replace(/(<a class="nav-blog" href="\.\/blog\/">)博客(<\/a>)/, "$1Blog$2");

// EN 页脚新增页面留在同目录(/en/)
html = html.replace('href="../privacy.html"', 'href="./privacy.html"');
html = html.replace('href="../terms.html"', 'href="./terms.html"');
html = html.replace('href="../blog/"', 'href="./blog/"');
// EN 首页:页面链接必须留在 /en/ 内,不能跑到中文版
html = html.replace('href="../guide.html"', 'href="./guide.html"');
html = html.replace('href="../download.html"', 'href="./download.html"');
// EN 首页:logo 和 Home 链接 → 留在 /en/
html = html.replace('href="../" style="display:flex', 'href="./" style="display:flex');
html = html.split('href="../">Home</a>').join('href="./">Home</a>');
html = html.split('href="../" >Home</a>').join('href="./" >Home</a>');
// 通用:EN 首页所有 href="../" 都应该变成 "./" (除了明确的根目录资源)
// 但只改 nav 里的 Home/logo 链接
html = html.replace(/(<a[^>]*href="\.\.\/"[^>]*>)(Home|Keyway)/g, '$1'.replace('../','./') + '$2');

// 页脚的 Guide 链接也要修正
html = html.split('href="../guide.html"').join('href="./guide.html"');
html = html.split('href="../download.html"').join('href="./download.html"');

// 接入教程/供应商接入指南:EN 版在 /en/ 根,不在 /en/guides/
html = html.split('href="../guides/integrate-keyway.html"').join('href="./integrate-keyway.html"');
html = html.split('href="../guides/provider-integration.html"').join('href="./provider-integration.html"');
html = html.split('>一键接入教程</a>').join('>Add-to-Keyway button</a>');
html = html.split('>供应商接入文档</a>').join('>Provider integration</a>');

// 一键迁移演示区(非 data-i18n 的静态文案;migSrc/migDst 含嵌套 <b>,通用正则吃不到,需整段替换)
html = html.split('aria-label="一键迁移演示"').join('aria-label="One-click migration demo"');
html = html.split('<span class="mig-label"><b>外部管理器</b> 里已有的</span>').join('<span class="mig-label">Already in <b>another switcher</b></span>');
html = html.split('<span class="mig-label"><b>Keyway</b> 供应商池</span>').join('<span class="mig-label"><b>Keyway</b> provider pool</span>');
html = html.split('✓</span>Claude 官方</div>').join('✓</span>Claude Official</div>');
html = html.split('src="../icons/claude.svg" alt="" width="16" height="16" />Claude 官方</div>').join('src="../icons/claude.svg" alt="" width="16" height="16" />Claude Official</div>');
html = html.split('<p class="mig-cta">正在用其他切换工具?扫描本机,勾选即迁,原配置只读不动 —— <a href="../guide.html#add">看迁移步骤</a></p>').join('<p class="mig-cta">Coming from another switcher? Scan this machine, pick what to migrate — originals stay untouched — <a href="./guide.html#add">see the migration steps</a></p>');


// 语言下拉:整个 <details> 块从中文版换为英文版
html = html.replace(/<details class="locale-menu"[^>]*>[\s\S]*?<\/details>/, (m) => {
  const chev = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const gb = '<img class="flag" src="../flags/gb.svg" alt="" width="16" height="12" aria-hidden="true" />';
  const cn = '<img class="flag" src="../flags/cn.svg" alt="" width="16" height="12" aria-hidden="true" />';
  const sum = gb + '<span>EN</span>' + chev;
  const opts = cn + '_SPLIT_' + gb; // 占位,后面拼
  return '<details class="locale-menu" id="langMenu"><summary aria-label="Switch language">' + sum + '</summary><div class="locale-options">' +
    '<a href="../" lang="zh">' + cn + '中文</a>' +
    '<a href="./" lang="en" aria-current="page">' + gb + 'English</a>' +
    '</div></details>';
});

// 英文页使用英文界面截图(正文相对路径;og/twitter/schema 在下方模板插入后统一替换)
html = html.replace(/app-light\.png/g, "app-light-en.png");
html = html.replace(/app-dark\.png/g, "app-dark-en.png");
html = html.replace(/add-dialog\.png/g, "add-dialog-en.png");


// ===== 导航、页脚与零散中文 → 英文(无 data-i18n 的硬编码文本) =====
const NAV_FOOTER = [
  // 导航链接
  ['>首页</a>', '>Home</a>'],
  ['>使用指南</a>', '>Guide</a>'],
  ['>博客</a>', '>Blog</a>'],
  ['>下载</a>', '>Download</a>'],
  // 版本备注
  ['>最新正式版 v0.2.17 · macOS / Windows / Linux<', '>Latest stable release v0.2.17 · macOS / Windows / Linux<'],
  // 供应商区
  ['>内置常见供应商,填个 Key 就能用。</h2>', '>Common providers built in — just paste your key.</h2>'],
  ['>官方渠道、主流模型服务与第三方端点都有预设;任何 OpenAI / Anthropic / Gemini 兼容接口也可以自定义接入。</p>', '>Presets for official endpoints, popular model services and third-party gateways; any OpenAI / Anthropic / Gemini compatible endpoint works too.</p>'],
  ['>想推荐你的服务?', '>Want your service listed?'],
  ['>提交收录申请</a>', '>Submit a provider</a>'],
  ['>+ 自定义兼容端点', '>+ custom endpoints'],
  // 页脚品牌列
  ['>AI CLI 的本地网关<br />The local gateway for AI coding CLIs.</p>', '>The local gateway for AI coding CLIs.<br />Switch providers, route models, trace requests.</p>'],
  // 页脚列标题
  ['>产品</b>', '>Product</b>'],
  ['>资源</b>', '>Resources</b>'],
  ['>法律</b>', '>Legal</b>'],
  ['>相关产品</b>', '>More</b>'],
  // 页脚链接
  ['>快速开始</a>', '>Quick Start</a>'],
  ['>隐私</a>', '>Privacy</a>'],

  // 分区眉:中文页保留中英双语,英文页只留英文
  ['data-sec="01 · 特性 FEATURES"', 'data-sec="01 · FEATURES"'],
  ['data-sec="02 · 快速开始 QUICKSTART"', 'data-sec="02 · QUICKSTART"'],
  ['data-sec="03 · 请求路径 REQUEST PATH"', 'data-sec="03 · REQUEST PATH"'],
  ['data-sec="04 · 能力 CAPABILITIES"', 'data-sec="04 · CAPABILITIES"'],
  ['data-sec="05 · 供应商 PROVIDERS"', 'data-sec="05 · PROVIDERS"'],
  ['data-sec="06 · 常见问题 FAQ"', 'data-sec="06 · FAQ"'],
  ['>提交供应商</a>', '>Submit a provider</a>'],
  ['>条款</a>', '>Terms</a>'],
];
for (const [zh, en] of NAV_FOOTER) {
  html = html.split(zh).join(en);
}

// pv-note 行尾中文句号 → 英文句点(替换后残留的「。」)
html = html.split('Submit a provider</a>。').join('Submit a provider</a>.');

// heroSub 含 <b> 标签,通用正则匹配不到,特殊处理
html = html.replace(
  /class="sub"[^>]*>为 <b>Claude Code[^<]*<\/b>[^<]*<b>[^<]*<\/b>[^<]*<b>[^<]*<\/b>[\s\S]*?<\/p>/,
  'class="sub">Provider switching, model routing, automatic failover and request logs for <b>Claude Code, Codex, Gemini CLI, OpenCode</b> — no session restarts, see exactly where every request goes. API keys encrypted on-device. Free, open source (MIT).</p>'
);

// 下载备注初始文案(网络失败时的兜底文本)
html = html.replace(
  ">最新正式版 v0.2.16 · macOS / Windows / Linux<",
  ">Latest stable release v0.2.16 · macOS / Windows / Linux<"
);

// 重写 <head> SEO 区块。先移除中文页的 canonical/hreflang(icon 链接之后)与全部
// JSON-LD,再插入英文版,避免出现两套 canonical 或中文结构化数据残留。
const canonicalBlock = /    <link rel="canonical"[^>]*>\n(?:    <link rel="alternate" hreflang[^>]*>\n)+/;
if (!canonicalBlock.test(html)) throw new Error("canonical/hreflang block not found");
html = html.replace(canonicalBlock, "");

const ldBlocks = [...html.matchAll(/    <script type="application\/ld\+json">[\s\S]*?\n    <\/script>\n/g)];
if (ldBlocks.length === 0) throw new Error("no JSON-LD blocks found");
html = html.replace(/    <script type="application\/ld\+json">[\s\S]*?\n    <\/script>\n/g, "");

const headStart = html.indexOf("    <title>");
const headEnd = html.indexOf('    <link rel="icon"');
if (headStart < 0 || headEnd < 0) throw new Error("head SEO block not found");
const enHead = `    <title>Keyway — Local gateway for Claude Code, Codex & Gemini CLI</title>
    <meta
      name="description"
      content="Open-source local gateway for AI coding CLIs. Switch Claude Code, Codex and Gemini CLI providers instantly — with model routing, failover, request logs and encrypted local key storage."
    />
    <meta name="keywords" content="claude code provider switcher, claude code proxy, switch claude code provider without restart, codex cli provider, gemini cli proxy, llm proxy desktop app, local llm gateway, glm claude code, kimi claude code, open source tauri app" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Keyway" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:locale:alternate" content="zh_CN" />
    <meta property="og:url" content="https://keyway.one/en/" />
    <meta property="og:title" content="Keyway — Local gateway for Claude Code, Codex & Gemini CLI" />
    <meta property="og:description" content="Switch AI CLI providers instantly: routing, failover, request logs, encrypted local key storage. Know where every request goes." />
    <meta property="og:image" content="https://keyway.one/app-light.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Keyway — Local gateway for Claude Code, Codex & Gemini CLI" />
    <meta name="twitter:description" content="Switch AI CLI providers instantly: routing, failover, request logs, encrypted local key storage. Know where every request goes." />
    <meta name="twitter:image" content="https://keyway.one/app-light.png" />
    <link rel="canonical" href="https://keyway.one/en/" />
    <link rel="alternate" hreflang="en" href="https://keyway.one/en/" />
    <link rel="alternate" hreflang="zh-CN" href="https://keyway.one/" />
    <link rel="alternate" hreflang="x-default" href="https://keyway.one/" />
`;
html = html.slice(0, headStart) + enHead + html.slice(headEnd);

// FAQ JSON-LD + SoftwareApplication 结构化数据(英文)
const enLd = `    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "How does Keyway work?", "acceptedAnswer": { "@type": "Answer", "text": "Keyway runs a local proxy on 127.0.0.1:9527. Requests from connected CLIs are forwarded according to your default provider, routing rules and failover settings. Request logs show the actual destination." } },
        { "@type": "Question", "name": "How are my API keys stored?", "acceptedAnswer": { "@type": "Answer", "text": "API keys live in a local SQLCipher-encrypted database whose master key is held in the system keychain. Exported provider configurations exclude API keys." } },
        { "@type": "Question", "name": "Which AI CLIs are supported?", "acceptedAnswer": { "@type": "Answer", "text": "Keyway offers 9 CLI groups covering the Anthropic, OpenAI and Gemini protocols. Claude Code, Codex CLI, Gemini CLI, OpenCode and OpenClaw support automatic takeover; other CLIs can be connected manually." } },
        { "@type": "Question", "name": "Do I need to restart sessions after switching providers?", "acceptedAnswer": { "@type": "Answer", "text": "Sessions already routed through the proxy do not need a restart after switching the default provider. First-time Codex takeover requires one new session; routing rules still take priority." } },
        { "@type": "Question", "name": "Is Keyway free?", "acceptedAnswer": { "@type": "Answer", "text": "Keyway is completely free and open source under the MIT license. You only pay the model providers you use." } }
      ]
    }
    </script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Keyway",
      "operatingSystem": "macOS, Windows, Linux",
      "applicationCategory": "DeveloperApplication",
      "softwareVersion": "0.2.24",
      "downloadUrl": "https://github.com/anmutu/keyway/releases",
      "screenshot": "https://keyway.one/app-light.png",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "description": "Open-source local gateway for AI coding CLIs: switch Claude Code, Codex and Gemini CLI providers instantly, with model routing, failover, request logs and encrypted local key storage.",
      "featureList": "Provider switching without session restart, model routing rules, automatic failover, request logs, token usage statistics, encrypted local key storage, multiple profiles, backup and migration",
      "author": { "@type": "Person", "name": "anmutu", "url": "https://github.com/anmutu" },
      "publisher": { "@type": "Organization", "name": "Keyway", "url": "https://keyway.one/", "logo": "https://keyway.one/logo.svg", "sameAs": ["https://github.com/anmutu/keyway"] },
      "datePublished": "2026-10-22",
      "dateModified": "2026-11-06"
    }
    </script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Keyway",
      "url": "https://keyway.one/",
      "inLanguage": "en",
      "publisher": { "@type": "Organization", "name": "Keyway", "url": "https://keyway.one/", "logo": "https://keyway.one/logo.svg", "sameAs": ["https://github.com/anmutu/keyway"] }
    }
    </script>
`;
// 锚点必须在头部拼接之后重新计算,否则会把 meta 标签拦腰截断、JSON-LD 泄漏为可见文本
const styleAt = html.indexOf("    <style>");
if (styleAt < 0) throw new Error("style anchor not found");
html = html.slice(0, styleAt) + enLd + html.slice(styleAt);

// 模板插入完成后再统一替换一次,覆盖 enHead/enLd 里的 og/twitter/schema 引用
html = html.replace(/app-light\.png/g, "app-light-en.png");
html = html.replace(/app-dark\.png/g, "app-dark-en.png");

const outDir = resolve(siteDir, "en");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "index.html"), html);

// 自检:英文页不应残留 data-i18n、中文 lang、未改写的 ./ 路径或重复 canonical
const checks = {
  "data-i18n": /data-i18n=/.test(html),
  "zh-CN html lang": /<html lang="zh-CN">/.test(html),
  "./ asset paths": new RegExp('(?:src|href)="\\.\\/(?!privacy\\.html|terms\\.html|blog\\/|download\\.html|guide\\.html|integrate-keyway\\.html|provider-integration\\.html)').test(html),
};
const canonicalCount = (html.match(/<link rel="canonical"/g) || []).length;
const zhLdCount = (html.match(/的开源本地网关|无需重启会话切换供应商/g) || []).length;
if (canonicalCount !== 1) checks["canonical count=" + canonicalCount] = true;
if (zhLdCount !== 0) checks["zh JSON-LD leftover"] = true;
const failed = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);
if (failed.length) {
  console.error("Leftover issues:", failed.join(", "));
  process.exit(1);
}
console.log("OK -> site/en/index.html (" + html.length + " bytes)");
