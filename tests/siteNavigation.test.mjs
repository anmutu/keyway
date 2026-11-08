import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 官网改版后页眉由 shared-header.js 动态生成(替换静态 nav),
// 导航断言以 shared-header.js 为真源。
const sharedHeader = readFileSync(new URL("../site/shared-header.js", import.meta.url), "utf8");
const chineseHome = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const englishHome = readFileSync(new URL("../site/en/index.html", import.meta.url), "utf8");

test("shared header renders the top navigation bar", () => {
  assert.match(sharedHeader, /<nav id="kw-nav"/);
  assert.match(sharedHeader, /querySelector\('nav'\)/);
});

test("top navigation exposes a mobile-visible blog link in both languages", () => {
  // shared header 不按屏宽隐藏链接,桌面/移动同一份;博客链接中英双语
  assert.match(sharedHeader, /var blog = isEN \? "\/en\/blog\/" : "\/blog\/"/);
  assert.match(sharedHeader, /L\(blog, T\("博客", "Blog"\)/);
});

test("both homepages load the shared header", () => {
  assert.match(chineseHome, /shared-header\.js/);
  assert.match(englishHome, /shared-header\.js/);
});
