# Проверка обновления приложения в браузере: python3 tests/e2e_update.py (нужна свежая сборка в dist/).
# Берём dist как «старую» версию, делаем копию с другим номером как «новую» и убеждаемся, что приложение обновляется
# тремя способами и что без интернета оно по-прежнему открывается. Заголовок max-age=600 — как у GitHub Pages.
import os, re, sys, shutil, tempfile, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(); live = TMP + "/live"
old_ver = re.search(r'"version":"([^"]+)"', open(ROOT + "/dist/version.json").read()).group(1)
new_ver = old_ver + "-NEW"
for name in ("bx", "by"): shutil.copytree(ROOT + "/dist", f"{TMP}/{name}")
for r, _, fs in os.walk(TMP + "/by"):
    for f in fs:
        p = os.path.join(r, f)
        try: t = open(p, encoding="utf-8").read()
        except UnicodeDecodeError: continue
        if old_ver in t: open(p, "w", encoding="utf-8").write(t.replace(old_ver, new_ver))
def swap(src):
    shutil.rmtree(live, ignore_errors=True); shutil.copytree(f"{TMP}/{src}", live)
    t = time.time() + (120 if src == "by" else 0)
    for r, _, fs in os.walk(live):
        for f in fs: os.utime(os.path.join(r, f), (t, t))
swap("bx")
class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "max-age=600"); super().end_headers()
PORT = 8170
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(H, directory=live)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"
res = []
def ok(name, cond, extra=""):
    res.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:300]))
ver = lambda pg: pg.evaluate("document.querySelector('meta[name=app-version]')?.content")
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    for mode in ("плашка «Обновить»", "обычная перезагрузка", "кнопка в «О приложении»"):
        swap("bx"); ctx = br.new_context(viewport={"width": 390, "height": 844}); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto(URL); pg.wait_for_selector("h1"); pg.wait_for_timeout(3000)
        ok(f"[{mode}] старая версия открыта", ver(pg) == old_ver, ver(pg))
        swap("by")
        if mode.startswith("плашка"):
            pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_selector(".update.banner", timeout=8000)
            pg.click(".update.banner button")
        elif mode.startswith("обычная"):
            pg.reload()
        else:
            pg.click(".tabs button[aria-label=Главная]"); pg.click('[aria-label="Ещё: семья, ограничения, данные"]'); pg.click("text=О приложении")
            pg.click("button:has-text('Обновить и перезапустить')")
        pg.wait_for_timeout(5000)
        ok(f"[{mode}] приложение обновилось", ver(pg) == new_ver, ver(pg))
        ok(f"[{mode}] без ошибок страницы", not errs, errs)
        ctx.close()
    # Без интернета открывается сохранённая копия
    swap("bx"); ctx = br.new_context(viewport={"width": 390, "height": 844}); pg = ctx.new_page()
    pg.goto(URL); pg.wait_for_selector("h1"); pg.wait_for_timeout(3000)
    ctx.set_offline(True); pg.reload(); pg.wait_for_selector("h1", timeout=15000)
    ok("без интернета приложение открывается из сохранённой копии", ver(pg) == old_ver and pg.query_selector("h1") is not None)
    br.close()
shutil.rmtree(TMP, ignore_errors=True)
bad = res.count(False)
print(f"e2e_update: {len(res) - bad} из {len(res)}")
sys.exit(1 if bad else 0)
