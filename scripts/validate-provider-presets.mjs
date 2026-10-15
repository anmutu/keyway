import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const filePath = path.resolve("src/data/providerPresets.ts");
const source = fs.readFileSync(filePath, "utf8");
const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = new Map();
const errors = [];

function property(node, name) {
  return node.properties.find(
    (item) => ts.isPropertyAssignment(item) && item.name?.getText(file) === name,
  );
}

function stringValue(node) {
  return node && ts.isStringLiteral(node) ? node.text : null;
}

function booleanValue(node) {
  return node && node.kind === ts.SyntaxKind.TrueKeyword;
}

function resolveArray(node, seen = new Set()) {
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return [];
    const declaration = declarations.get(node.text);
    if (!declaration) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return resolveArray(declaration.initializer, nextSeen);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) => {
      if (ts.isSpreadElement(element)) return resolveArray(element.expression, seen);
      return [element];
    });
  }
  return [];
}

function validateUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push(`${label} is not a valid URL: ${value}`);
    return;
  }
  if (url.protocol !== "https:") errors.push(`${label} must use HTTPS: ${value}`);
  if (url.username || url.password) errors.push(`${label} must not contain credentials: ${value}`);
  if (url.search || url.hash) errors.push(`${label} must not contain a query or fragment: ${value}`);
}

function validatePreset(node, label) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const name = stringValue(property(node, "name")?.initializer);
  const baseUrl = stringValue(property(node, "baseUrl")?.initializer);
  const requiresBaseUrl = booleanValue(property(node, "requiresBaseUrl")?.initializer);
  if (!name || baseUrl === null) return null;
  if (!baseUrl && !requiresBaseUrl) errors.push(`${label} has an empty baseUrl without requiresBaseUrl`);
  if (baseUrl) validateUrl(baseUrl, `${label}.baseUrl`);
  for (const field of ["websiteUrl", "apiKeyUrl"]) {
    const value = stringValue(property(node, field)?.initializer);
    if (value) validateUrl(value, `${label}.${field}`);
  }
  return name;
}

function collect(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    declarations.set(node.name.text, node);
  }
  ts.forEachChild(node, collect);
}

collect(file);

let providerPresets;
function findProviderPresets(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "providerPresets") {
    providerPresets = node.initializer;
  }
  ts.forEachChild(node, findProviderPresets);
}

findProviderPresets(file);
if (!providerPresets || !ts.isObjectLiteralExpression(providerPresets)) {
  errors.push("providerPresets export was not found");
} else {
  for (const entry of providerPresets.properties) {
    if (!ts.isPropertyAssignment(entry)) continue;
    const appName = entry.name.getText(file);
    const names = new Set();
    for (const preset of resolveArray(entry.initializer)) {
      const name = validatePreset(preset, `${appName}.${preset.getText(file)}`);
      if (!name) continue;
      const key = name.toLowerCase();
      if (names.has(key)) errors.push(`${appName} contains duplicate preset: ${name}`);
      names.add(key);
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Provider presets are valid.");
