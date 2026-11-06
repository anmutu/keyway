const BRAND_KEYS = new Set([
  "claude", "openai", "gemini", "opencode", "openclaw", "deepseek", "kimi",
  "zhipu", "doubao", "minimax", "qwen", "bailian", "siliconflow", "openrouter",
  "aihubmix", "stepfun", "modelscope", "coderplan", "teapotrouter", "iflow", "crush", "droid",
]);

const BRAND_ALIASES: Record<string, string> = {
  teapotrouter: "teapotrouter",
  coderplan: "coderplan",
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s*\(\d+\)$/, "").replace(/[\s-]/g, "");
}

/** Prefer a known provider brand; use the CLI icon only as a fallback. */
export function providerBrandKey(cliIcon: string, name?: string): string {
  const provider = normalize(name ?? "");
  const alias = BRAND_ALIASES[provider];
  if (alias) return alias;
  if (BRAND_KEYS.has(provider)) return provider;

  const icon = cliIcon.toLowerCase();
  return BRAND_KEYS.has(icon) ? icon : cliIcon;
}
