/**
 * Keyway 共享 Header — 全站唯一 header 源码。
 * 每个页面只需 <script src="/shared-header.js"></script>,
 * 修改此文件即全站生效,不再逐页手写。
 */
(function () {
  "use strict";

  var isEN = window.location.pathname.startsWith("/en/");
  var L = function (zh, en) { return isEN ? en : zh; };

  // 路径:根据当前页面位置计算绝对路径
  var path = window.location.pathname;
  var home = isEN ? "/en/" : "/";
  var guide = isEN ? "/en/guide.html" : "/guide.html";
  var blog = isEN ? "/en/blog/" : "/blog/";
  var download = isEN ? "/en/download.html" : "/download.html";

  // 语言互跳:找当前页面的对应语言版本
  var langCounterpart;
  if (isEN) {
    langCounterpart = path.replace(/^\/en/, "") || "/";
  } else {
    langCounterpart = "/en" + (path === "/" ? "/" : path);
  }

  // SVG 图标(Lucide 官方路径)
  var SUN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ico-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.34-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  var MOON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ico-moon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var GLOBE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
  var CHEV = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var GB = '<img class="flag" src="/flags/gb.svg" alt="" width="16" height="12" aria-hidden="true" />';
  var CN = '<img class="flag" src="/flags/cn.svg" alt="" width="16" height="12" aria-hidden="true" />';

  // 构建 header HTML
  var summaryFlag = isEN ? GB : CN;
  var summaryLabel = isEN ? "EN" : "ZH";
  var zhOpt = '<a href="' + langCounterpart + '" lang="zh">' + CN + '中文</a>';
  var enOpt = '<a href="' + langCounterpart + '" lang="en"' + (isEN ? ' aria-current="page"' : '') + '>' + GB + 'English</a>';
  // 当前语言排第二(高亮)
  var opts = isEN ? zhOpt + enOpt : enOpt + zhOpt.replace('>', ' aria-current="page">');

  var html =
    '<nav>' +
      '<div class="nav-inner">' +
        '<a href="' + home + '" style="display:flex!important;align-items:center!important;gap:7px!important;text-decoration:none;">' +
          '<img src="/logo.svg" width="18" height="18" alt="Keyway" style="border-radius:4px;" />' +
          '<span class="brand">Keyway</span>' +
        '</a>' +
        '<div class="nav-links">' +
          '<a href="' + home + '">' + L("首页", "Home") + '</a>' +
          '<a href="' + guide + '">' + L("使用指南", "Guide") + '</a>' +
          '<a href="' + blog + '">' + L("博客", "Blog") + '</a>' +
          '<a href="' + download + '">' + L("下载", "Download") + '</a>' +
          '<button id="themeToggle" type="button" aria-label="' + L("切换昼夜模式", "Toggle theme") + '" style="border:none;background:transparent;color:var(--fg-3);width:32px;height:32px!important;border-radius:8px;cursor:pointer;display:inline-flex!important;align-items:center!important;justify-content:center!important;">' + MOON + SUN + '</button>' +
          '<details class="locale-menu" id="langMenu">' +
            '<summary aria-label="' + L("切换语言", "Switch language") + '">' + summaryFlag + '<span>' + summaryLabel + '</span>' + CHEV + '</summary>' +
            '<div class="locale-options">' + opts + '</div>' +
          '</details>' +
        '</div>' +
      '</div>' +
    '</nav>';

  // CSS(一次性注入)
  var css =
    ':root{--fg:#1a1a1a;--fg-2:#5e5e5e;--fg-3:#8e8e8e;--blue:#d97757;--bg:#faf9f5;--bg-alt:#f0efeb;--nav-bg:rgba(250,249,245,.88);--hair:#e5e5e5;}' +
    'html[data-theme="night"]{--fg:#e8e8e6;--fg-2:#a0a09e;--fg-3:#6e6e6c;--blue:#d97757;--bg:#1a1a1a;--bg-alt:#242424;--nav-bg:rgba(26,26,26,.92);--hair:rgba(255,255,255,.1);}' +
    'html[data-theme="night"] body{background:var(--bg);color:var(--fg);}' +
    'nav{position:sticky!important;top:0!important;z-index:50!important;background:var(--nav-bg);backdrop-filter:saturate(180%) blur(20px);height:48px!important;box-shadow:0 1px 0 var(--hair);}' +
    '.nav-inner{max-width:980px!important;margin:0 auto;padding:0 22px!important;height:100%!important;display:flex!important;align-items:center!important;justify-content:space-between!important;}' +
    '.nav-inner a{color:rgba(31,30,29,.78);text-decoration:none;font-size:13px;}' +
    '.nav-inner a:hover{color:var(--fg);}' +
    '.nav-inner .brand{color:var(--fg);font-weight:600;}' +
    '.nav-links{display:flex!important;gap:18px!important;align-items:center!important;}' +
    '@media(max-width:640px!important){.nav-links{gap:12px!important;}.nav-links a:nth-child(n+4){display:none!important;}}' +
    'html[data-theme="night"] .nav-inner a{color:rgba(236,231,219,.75);}' +
    'html[data-theme="night"] .nav-inner a:hover{color:#fff;}' +
    '#themeToggle svg{display:block!important;}' +
    '#themeToggle:hover{color:var(--fg);background:var(--bg-alt);}' +
    '.ico-sun{display:none!important;}' +
    'html[data-theme="night"] .ico-sun{display:block!important;}' +
    'html[data-theme="night"] .ico-moon{display:none!important;}' +
    '.locale-menu{position:relative!important;}' +
    '.locale-menu summary{list-style:none;display:inline-flex!important;align-items:center!important;gap:5px!important;cursor:pointer;font-size:12.5px;color:var(--fg-3);padding:5px 8px!important;border-radius:6px;}' +
    '.locale-menu summary::-webkit-details-marker{display:none!important;}' +
    '.locale-menu summary:hover{color:var(--fg);background:var(--bg-alt);}' +
    '.flag{width:16px;height:12px!important;border-radius:2px;display:block!important;object-fit:cover;}' +
    '.locale-options{position:absolute!important;right:0;top:calc(100% + 4px)!important;background:var(--bg);border:1px solid var(--hair);border-radius:10px;padding:4px!important;display:flex!important;flex-direction:column;min-width:132px;box-shadow:0 12px 32px rgba(40,30,20,.14);z-index:90!important;}' +
    '.locale-options a{display:flex!important;align-items:center!important;gap:8px!important;padding:8px 12px!important;border-radius:7px;font-size:13.5px;color:var(--fg-2);text-decoration:none;}' +
    '.locale-options a:hover{background:var(--bg-alt);color:var(--fg);}' +
    '.locale-options a[aria-current]{color:var(--blue);font-weight:600;}' +
    'html[data-theme="night"] .locale-options{background:var(--bg-alt);}' +
    'html[data-theme="night"] .locale-menu summary{color:rgba(236,231,219,.75);}';

  // 注入 CSS(如果页面还没有)
  if (!document.getElementById('shared-header-css')) {
    var style = document.createElement('style');
    style.id = 'shared-header-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // 注入 header(替换页面中已有的 nav,或插入到 body 开头)
  var existingNav = document.querySelector('nav');
  if (existingNav) {
    existingNav.outerHTML = html;
  } else {
    document.body.insertAdjacentHTML('afterbegin', html);
  }

  // ===== 主题切换 =====
  var theme = null;
  try { theme = localStorage.getItem("kw-theme"); } catch (e) {}
  if (!theme) theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
  document.documentElement.setAttribute("data-theme", theme);
  var btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", function () {
      theme = theme === "night" ? "day" : "night";
      try { localStorage.setItem("kw-theme", theme); } catch (e) {}
      document.documentElement.setAttribute("data-theme", theme);
    });
  }

  // ===== 每日 logo =====
  var d = new Date().getDay();
  var days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var daily = "/logos/logo-" + days[d] + ".svg";
  document.querySelectorAll('nav img[src*="logo.svg"]').forEach(function (img) {
    var orig = img.src;
    img.src = daily;
    img.onerror = function () { img.onerror = null; img.src = orig; };
  });

  // ===== 语言下拉外点收起 =====
  document.addEventListener("click", function (e) {
    var menu = document.getElementById("langMenu");
    if (menu && menu.open && !menu.contains(e.target)) menu.open = false;
  });
})();
