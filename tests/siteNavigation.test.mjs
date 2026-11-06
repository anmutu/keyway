import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chineseHome = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const englishHome = readFileSync(new URL("../site/en/index.html", import.meta.url), "utf8");

function navigationOf(html) {
  const match = html.match(/<nav>[\s\S]*?<\/nav>/);
  assert.ok(match, "homepage should contain a top navigation bar");
  return match[0];
}

test("Chinese top navigation exposes a mobile-visible blog link", () => {
  const nav = navigationOf(chineseHome);
  assert.match(nav, /<a class="nav-blog" href="\.\/blog\/">博客<\/a>/);
});

test("English top navigation exposes a mobile-visible Blog link", () => {
  const nav = navigationOf(englishHome);
  assert.match(nav, /<a class="nav-blog" href="\.\/blog\/">Blog<\/a>/);
});
