// Сборка приложения: один JS-файл, один CSS, service worker со списком файлов для офлайна.
// Запуск: npm run build  → готовая папка dist/ (её публикует GitHub Pages).
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadAll } from "./tools/recipes.mjs";

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const sha = (process.env.GITHUB_SHA || "local").slice(0, 7);
// Версия видна в приложении: Ещё → О приложении. Так легко понять, обновился ли телефон.
const VERSION = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}-${sha}`;

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const result = await esbuild.build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: ["safari15", "chrome100"],
  outdir: "dist",
  entryNames: "app-[hash]",
  jsx: "automatic",
  metafile: true,
  conditions: ["production"],
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(VERSION), "process.env.NODE_ENV": '"production"' },
  nodePaths: process.env.LOCAL_NODE_MODULES ? [process.env.LOCAL_NODE_MODULES] : [],
  logLevel: "warning",
});

const outs = Object.keys(result.metafile.outputs).map((p) => relative("dist", p));
const js = outs.find((f) => f.endsWith(".js"));
const css = outs.find((f) => f.endsWith(".css"));

cpSync("public", "dist", { recursive: true });

// База рецептов: из текстовых файлов recipes/*.txt — в один файл recipes.json
const base = loadAll("recipes");
if (base.errors.length) { console.error("Ошибки в рецептах:\n" + base.errors.join("\n")); process.exit(1); }
writeFileSync("dist/recipes.json", JSON.stringify(base.recipes));
console.log("Рецептов в базе:", base.recipes.length);

const html = readFileSync("src/index.html", "utf8")
  .replace("%CSS%", css ? `<link rel="stylesheet" href="./${css}">` : "")
  .replace("%JS%", `<script type="module" src="./${js}"></script>`)
  .replace("%VERSION%", VERSION);
writeFileSync("dist/index.html", html);

// Список всех файлов — service worker сохранит их в телефон для работы без интернета.
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push("./" + relative("dist", p).split("\\").join("/"));
  }
})("dist");
const sw = readFileSync("src/sw.js", "utf8")
  .replace("%VERSION%", VERSION)
  .replace("%FILES%", JSON.stringify(files.filter((f) => f !== "./sw.js" && !f.split("/").pop().startsWith(".") && !(f.startsWith("./ocr/") && !/tesseract\.min\.js$|worker\.min\.js$/.test(f))).map((f) => (f === "./index.html" ? "./" : f))));
writeFileSync("dist/sw.js", sw);
writeFileSync("dist/version.json", JSON.stringify({ version: VERSION }));
console.log("Готово:", VERSION, js, css, files.length, "файлов");
