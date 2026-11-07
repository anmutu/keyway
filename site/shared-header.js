/**
 * Keyway 共享 Header — 全站唯一 header。
 * 只生成 nav + logo 变色 + 语言下拉。无主题切换。
 * 链接用固定宽度盒子，保证每个页面像素级一致。
 */
(function () {
  "use strict";

  var isEN = window.location.pathname.indexOf("/en/") === 0;
  var T = function (zh, en) { return isEN ? en : zh; };
  var home = isEN ? "/en/" : "/";
  var guide = isEN ? "/en/guide.html" : "/guide.html";
  var blog = isEN ? "/en/blog/" : "/blog/";
  var dl = isEN ? "/en/download.html" : "/download.html";

  var GB = '<img src="/flags/gb.svg" alt="" width="16" height="12" style="border-radius:2px;display:block;object-fit:cover;">';
  var CN = '<img src="/flags/cn.svg" alt="" width="16" height="12" style="border-radius:2px;display:block;object-fit:cover;">';
  var CHEV = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>';

  var counter = isEN
    ? (window.location.pathname.replace(/^\/en/, "") || "/")
    : ("/en" + (window.location.pathname === "/" ? "/" : window.location.pathname));

  // 固定宽度链接盒：文本子像素渲染差异不再影响布局位置
  function L(href, label, w) {
    return '<a href="' + href + '" style="display:inline-block!important;width:' + w + 'px!important;text-align:center!important;white-space:nowrap!important;color:rgba(31,30,29,.78)!important;text-decoration:none;font-size:13px!important;">' + label + '</a>';
  }
  var widths = isEN ? [42, 40, 32, 66] : [28, 56, 28, 28];

  var nav =
    '<nav id="kw-nav" style="position:sticky;top:0;z-index:50;background:rgba(250,249,245,.88);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);height:48px!important;box-shadow:0 1px 0 rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif!important;">' +
    '<div style="max-width:980px!important;margin:0 auto;padding:0 22px;height:100%!important;display:flex;align-items:center;justify-content:space-between;">' +
    '<a href="' + home + '" style="display:flex;align-items:center;gap:7px!important;text-decoration:none;">' +
    '<img src="/logo.svg" width="18" height="18" alt="Keyway" style="border-radius:4px;">' +
    '<span style="color:#1a1a1a!important;font-weight:600!important;font-size:14px!important;">Keyway</span></a>' +
    '<div style="display:flex;gap:18px!important;align-items:center;">' +
    L(home, T("首页", "Home"), widths[0]) +
    L(guide, T("使用指南", "Guide"), widths[1]) +
    L(blog, T("博客", "Blog"), widths[2]) +
    L(dl, T("下载", "Download"), widths[3]) +
    '<details id="langMenu" style="position:relative!important;display:inline-block!important;width:70px!important;overflow:visible!important;">' +
    '<summary style="list-style:none;display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:12.5px!important;color:#8e8e8e!important;padding:5px 8px;border-radius:6px;">' +
    (isEN ? GB : CN) + '<span>' + (isEN ? "EN" : "ZH") + '</span>' + CHEV + '</summary>' +
    '<div style="position:absolute!important;right:0!important;top:calc(100% + 4px)!important;background:#faf9f5!important;border:1px solid #e5e5e5!important;border-radius:10px!important;padding:4px!important;display:flex!important;flex-direction:column!important;min-width:130px!important;box-shadow:0 12px 32px rgba(40,30,20,.14)!important;z-index:90!important;">' +
    '<a href="' + counter + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:7px;font-size:13.5px;color:#5e5e5e;text-decoration:none;">' + (isEN ? CN : GB) + ' ' + (isEN ? "中文" : "English") + '</a>' +
    '<a style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:7px;font-size:13.5px;color:#d97757;text-decoration:none;font-weight:600;">' + (isEN ? GB : CN) + ' ' + (isEN ? "English" : "中文") + '</a>' +
    '</div></details></div></div></nav>';

  // 替换或注入
  var old = document.querySelector('nav');
  if (old) { old.outerHTML = nav; }
  else { document.body.insertAdjacentHTML('afterbegin', nav); }

  // 图标 CSS(最小化,只影响 nav 内部)
  var s = document.createElement('style');
  s.textContent = '#langMenu summary::-webkit-details-marker{display:none}' +
    '#langMenu summary:hover{color:#1a1a1a;background:#f0efeb}' +
    '#langMenu div a:hover{background:#f0efeb;color:#1a1a1a}' +
    '#kw-nav{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif!important;font-size:13px!important;height:48px!important}' +
    '#kw-nav *{font-family:inherit!important}' +
    '#kw-nav a{font-size:13px!important;color:rgba(31,30,29,.78)!important;text-decoration:none!important}' +
    '#kw-nav a:hover{color:#1a1a1a!important}' +
    '#kw-nav span{font-size:14px!important;font-weight:600!important;color:#1a1a1a!important}' +
    '#kw-nav summary{font-size:12.5px!important}' +
    '#kw-nav details{position:relative!important;display:inline-block!important;width:70px!important}' +
    '#kw-nav details>div{position:absolute!important}' +
    '#kw-nav details a{font-size:13.5px!important}';
  document.head.appendChild(s);

  // 每日 logo
  var d = new Date().getDay();
  var days = ["sun","mon","tue","wed","thu","fri","sat"];
  var daily = "/logos/logo-" + days[d] + ".svg";
  document.querySelectorAll('nav img[src*="logo.svg"]').forEach(function(img) {
    var orig = img.src;
    img.src = daily;
    img.onerror = function() { img.onerror = null; img.src = orig; };
  });

  // 外点收起
  document.addEventListener("click", function(e) {
    var menu = document.getElementById("langMenu");
    if (menu && menu.open && !menu.contains(e.target)) menu.open = false;
  });
})();
