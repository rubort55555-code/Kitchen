// Сборка приложения: один JS-файл, один CSS, service worker со списком файлов для офлайна.
// Запуск: npm run build  → готовая папка dist/ (её публикует GitHub Pages).
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadAll } from "./tools/recipes.mjs";

// STAGING=1 — сборка «зеркала» для обкатки крупных изменений: своя база и кэш, пометка «Тест» (см. src/lib/env.ts).
const STAGING = process.env.STAGING === "1";
const NS = STAGING ? "kitchen-staging" : "kitchen";
// Куда собирать (по умолчанию dist/). Сценарий e2e_staging собирает зеркало рядом: OUT_DIR=dist-staging.
const OUT = process.env.OUT_DIR || "dist";
const TITLE = STAGING ? "Кухня · тест" : "Кухня";

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const sha = (process.env.GITHUB_SHA || "local").slice(0, 7);
// Версия видна в приложении: Ещё → О приложении. Так легко понять, обновился ли телефон.
const VERSION = (STAGING ? "staging-" : "") + `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}-${sha}`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Время сборки: приложение из магазина берёт рецепты и справочник с сайта, только если они там не старее встроенных.
const BUILT_AT = now.getTime();
const fnv = (text) => {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) { h ^= text.charCodeAt(k); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

// Справочник продуктов — ещё и отдельным файлом catalog.json: его скачивает приложение из магазина.
const cat = await esbuild.build({ entryPoints: ["src/lib/catalog.ts"], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "warning" });
const { CATALOG } = await import("data:text/javascript;base64," + Buffer.from(cat.outputFiles[0].text).toString("base64"));
const catText = JSON.stringify(CATALOG);
const CATALOG_H = fnv(catText) + "-" + CATALOG.length;

const result = await esbuild.build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: ["safari15", "chrome100"],
  outdir: OUT,
  entryNames: "app-[hash]",
  jsx: "automatic",
  metafile: true,
  conditions: ["production"],
  legalComments: "none",
  define: { __FEEDBACK_URL__: JSON.stringify(process.env.FEEDBACK_URL || ""), __VERSION__: JSON.stringify(VERSION), __BUILT_AT__: String(BUILT_AT), __CATALOG_H__: JSON.stringify(CATALOG_H), __STAGING__: String(STAGING), "process.env.NODE_ENV": '"production"' },
  nodePaths: process.env.LOCAL_NODE_MODULES ? [process.env.LOCAL_NODE_MODULES] : [],
  logLevel: "warning",
});

const outs = Object.keys(result.metafile.outputs).map((p) => relative(OUT, p));
const js = outs.find((f) => f.endsWith(".js"));
const css = outs.find((f) => f.endsWith(".css"));

cpSync("public", OUT, { recursive: true });
if (STAGING) {
  // У зеркала своё имя на экране «Домой», чтобы не перепутать с основной версией
  const m = JSON.parse(readFileSync(OUT + "/manifest.webmanifest", "utf8"));
  writeFileSync(OUT + "/manifest.webmanifest", JSON.stringify({ ...m, name: "Кухня · тестовая версия", short_name: "Кухня тест" }, null, 2));
}

// База рецептов: из текстовых файлов recipes/*.txt — в один файл recipes.json
const base = loadAll("recipes");
if (base.errors.length) { console.error("Ошибки в рецептах:\n" + base.errors.join("\n")); process.exit(1); }
// База большая (11 000+), поэтому делим её на части по 1000: телефон загружает их по очереди,
// и приложение готово к работе уже после первой части. recipes.json — оглавление частей;
// у каждой части есть отпечаток (h): при обновлении приложения заново читаются только изменившиеся части.
const PART = 1000;
mkdirSync(OUT + "/recipes", { recursive: true });
const parts = [];
for (let i = 0; i * PART < base.recipes.length; i++) {
  const chunk = base.recipes.slice(i * PART, (i + 1) * PART);
  const text = JSON.stringify(chunk);
  const f = `recipes/${String(i).padStart(2, "0")}.json`;
  writeFileSync(OUT + "/" + f, text);
  parts.push({ f, h: fnv(text) + "-" + chunk.length, n: chunk.length });
}
// ids — все рецепты базы: по ним телефон убирает рецепты, которых в базе больше нет
writeFileSync(OUT + "/recipes.json", JSON.stringify({ v: 2, at: BUILT_AT, total: base.recipes.length, parts, ids: base.recipes.map((r) => r.id) }));
writeFileSync(OUT + "/catalog.json", JSON.stringify({ v: 1, at: BUILT_AT, h: CATALOG_H, items: CATALOG }));
console.log("Продуктов в справочнике:", CATALOG.length);
console.log("Рецептов в базе:", base.recipes.length, "частей:", parts.length);

const html = readFileSync("src/index.html", "utf8")
  .replace("%CSS%", css ? `<link rel="stylesheet" href="./${css}">` : "")
  .replace("%JS%", `<script type="module" src="./${js}"></script>`)
  .replace("%VERSION%", VERSION)
  .replaceAll("%TITLE%", TITLE)
  .replaceAll("%NS%", NS);
writeFileSync(OUT + "/index.html", html);

// Список всех файлов — service worker сохранит их в телефон для работы без интернета.
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push("./" + relative(OUT, p).split("\\").join("/"));
  }
})(OUT);
const sw = readFileSync("src/sw.js", "utf8")
  .replace("%VERSION%", VERSION)
  .replace("%NS%", NS)
  .replace("%FILES%", JSON.stringify(files.filter((f) => f !== "./sw.js" && f !== "./catalog.json" && f !== "./guide.html" && !f.split("/").pop().startsWith(".") && !(f.startsWith("./ocr/") && !/tesseract\.min\.js$|worker\.min\.js$/.test(f))).map((f) => (f === "./index.html" ? "./" : f))));
writeFileSync(OUT + "/sw.js", sw);
writeFileSync(OUT + "/version.json", JSON.stringify({ version: VERSION }));
console.log(STAGING ? "Готово (зеркало):" : "Готово:", VERSION, js, css, files.length, "файлов");
