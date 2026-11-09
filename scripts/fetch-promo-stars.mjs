#!/usr/bin/env node
/**
 * Fetch real GitHub star counts for github.com entries in promotion research files.
 * Writes docs/promotion/research/stars.json: { "https://github.com/owner/repo": 57200 }
 * Uses authenticated gh CLI (higher rate limit than anonymous API).
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RESEARCH_DIR = join(ROOT, "docs", "promotion", "research");
const OUT = join(RESEARCH_DIR, "stars.json");

const repos = new Set();
for (const f of readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".json") && f !== "stars.json")) {
  const arr = JSON.parse(readFileSync(join(RESEARCH_DIR, f), "utf8"));
  for (const e of arr ?? []) {
    const m = String(e?.url ?? "").match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);
    if (m && !m[2].endsWith(".git")) repos.add(`https://github.com/${m[1]}/${m[2]}`);
  }
}
console.log(`unique github repos: ${repos.size}`);

const stars = {};
let i = 0;
for (const url of repos) {
  const repo = url.replace("https://github.com/", "");
  try {
    const n = execSync(`gh api repos/${repo} --jq .stargazers_count`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
    }).trim();
    if (/^\d+$/.test(n)) stars[url] = Number(n);
  } catch {
    /* 404/renamed/rate-limited — skip */
  }
  if (++i % 25 === 0) console.log(`  …${i}/${repos.size} (got ${Object.keys(stars).length})`);
}
writeFileSync(OUT, JSON.stringify(stars, null, 1));
const got = Object.keys(stars).length;
console.log(`✔ ${OUT}: ${got}/${repos.size} repos with stars; ${repos.size - got} unreachable (404/renamed/rate-limit)`);
