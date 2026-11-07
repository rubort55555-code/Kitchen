# Качество распознавания чеков на тестовых «фото» (фон, наклон, тень, размытие, бледная печать): python3 tests/e2e_receipts.py
# Чеки — tests/receipts/receipts.ts (на них настраивался разбор) и holdout.ts (отложенные). Нужен собранный dist (npm run build).
import json, os, shutil, subprocess, sys, tempfile, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KINDS = ["scan", "photo", "faded", "tilt", "small", "blur"]
MIN = 0.9  # не меньше 90% товаров с верным названием и ценой

d = tempfile.mkdtemp()
subprocess.run([os.path.join(ROOT, "node_modules", ".bin", "esbuild"), os.path.join(ROOT, "tests", "receipts", "harness.ts"), "--bundle", "--format=iife", "--log-level=error", "--outfile=" + os.path.join(d, "harness.js")], check=True)
shutil.copytree(os.path.join(ROOT, "dist", "ocr"), os.path.join(d, "ocr"))
open(os.path.join(d, "index.html"), "w").write('<!doctype html><meta charset="utf-8"><script src="harness.js"></script>')

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", 8141), partial(Quiet, directory=d))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page()
    pg.goto("http://127.0.0.1:8141/index.html"); pg.wait_for_function("typeof window.bench === 'function'")
    res = pg.evaluate("k => window.bench(k, {})", KINDS)
    br.close()
srv.shutdown(); shutil.rmtree(d, ignore_errors=True)

want = sum(r["want"] for r in res); hit = sum(r["hit"] for r in res); extra = sum(r["extra"] for r in res)
for r in res:
    if r["hit"] < r["want"] or r["extra"]:
        print(f'  {r["kind"]:6} {r["id"]:12} верно {r["hit"]}/{r["want"]}, лишних {r["extra"]}: {r["items"]}')
print(f"\nЧеки: верно {hit} из {want} ({100 * hit // want}%), лишних строк {extra}")
sys.exit(0 if hit >= want * MIN else 1)
