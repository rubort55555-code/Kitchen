// Сборка модуля распознавания текста (Tesseract.js) для работы без интернета.
// Запускается один раз вручную: результат (public/ocr/*) лежит в репозитории.
//   node tools/build-ocr.mjs <папка tesseract.js> <папка tesseract.js-core> <папка tessdata_fast>
// Источники: github.com/naptha/tesseract.js (Apache-2.0), tesseract.js-core, tessdata_fast.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [, , jsDir, coreDir, dataDir] = process.argv;
if (!jsDir || !coreDir || !dataDir) { console.error("Нужны три папки: tesseract.js, tesseract.js-core, tessdata_fast"); process.exit(1); }
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require("esbuild"); } catch { esbuild = require(join(process.env.LOCAL_NODE_MODULES || "/opt/npm-tools/node_modules", "esbuild")); }

const shim = (name) => resolve("tools/ocr-shims", name + ".js");
const aliasPlugin = {
  name: "shims",
  setup(b) {
    for (const n of ["idb-keyval", "wasm-feature-detect", "is-url", "bmp-js", "zlibjs", "node-fetch"]) {
      b.onResolve({ filter: new RegExp("^" + n + "$") }, () => ({ path: shim(n) }));
    }
  },
};
const out = "public/ocr";
mkdirSync(out, { recursive: true });
const common = { bundle: true, minify: true, platform: "browser", target: ["safari15"], legalComments: "none", plugins: [aliasPlugin], logLevel: "warning", define: { "process.env.NODE_ENV": '"production"', global: "globalThis" } };

// Основная часть (в странице)
await esbuild.build({ ...common, entryPoints: [join(jsDir, "src/index.js")], outfile: join(out, "tesseract.min.js"), format: "iife", globalName: "Tesseract" });
// Рабочий поток (распознавание идёт в фоне, страница не зависает)
await esbuild.build({ ...common, entryPoints: [join(jsDir, "src/worker-script/browser/index.js")], outfile: join(out, "worker.min.js"), format: "iife" });
// Ядро (WebAssembly внутри) — с SIMD и без
for (const f of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"]) copyFileSync(join(coreDir, f), join(out, f));
// Языки: русский и английский (быстрые модели, без сжатия)
for (const f of ["rus.traineddata", "eng.traineddata"]) copyFileSync(join(dataDir, f), join(out, f));
copyFileSync(join(jsDir, "LICENSE.md"), join(out, "LICENSE-tesseract.js.txt"));
copyFileSync(join(dataDir, "LICENSE"), join(out, "LICENSE-tessdata.txt"));
writeFileSync(join(out, "README.txt"), "Tesseract.js 7.0.0 (Apache-2.0), tesseract.js-core, tessdata_fast (rus, eng). Собрано tools/build-ocr.mjs. Используется для распознавания чеков без интернета.\n");
console.log("Готово:", out);
