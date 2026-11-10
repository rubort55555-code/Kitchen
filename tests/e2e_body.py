# Проверка журнала веса и талии в браузере: python3 tests/e2e_body.py
import os, sys, threading, datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8128
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=os.path.join(ROOT, "dist")))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"
res = []
def ok(name, cond, extra=""):
    res.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:300]))
SEED = """(settings) => new Promise((res, rej) => {
  const r = indexedDB.open('kitchen');
  r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(settings, 'settings'); tx.oncomplete = () => { db.close(); res(true); }; };
  r.onerror = () => rej(r.error);
})"""
SETTINGS = {"members": [{"id": "m1", "name": "Аня", "allergies": [], "dislikes": [], "body": {"sex": "f", "born": 1991, "height": 165, "weight": 62, "goal": "keep"}}],
            "tipsSeen": ["intro", "home-gear"], "lastBackup": 1999999999999}
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    for scheme in ["light", "dark"]:
        S = f"[{scheme}] "
        pg = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme).new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("h1"); pg.evaluate(SEED, SETTINGS); pg.reload(); pg.wait_for_selector("h1")
        pg.click('[aria-label^="Ещё: семья"]'); pg.click("text=Питание · проба"); pg.wait_for_selector(".bodylog")
        ok(S + "блок «Вес и талия» виден, замеров нет", "Замеров пока нет" in pg.inner_text(".bodylog"))
        def add(date, w, waist=""):
            if not pg.query_selector(".bodyform"): pg.click(".bodylog >> text=Записать замер")
            pg.fill('.bodyform input[type=date]', date)
            ins = pg.query_selector_all(".bodyform input[inputmode=decimal]")
            ins[0].fill(w); ins[1].fill(waist)
            pg.click(".bodyform .btn:has-text('Сохранить')"); pg.wait_for_selector(".toast")
        add("2026-11-01", "62,0", "74")
        ok(S + "после первого замера — один замер, графика нет", "Один замер" in pg.inner_text(".bodylog"))
        add("2026-11-08", "61,6", "73")
        ok(S + "график появился", pg.query_selector(".bodychart") is not None)
        ok(S + "за неделю −0,4", "−0,4" in pg.inner_text(".bodylog"), pg.inner_text(".bodylog")[:300])
        pg.click(".bodylog .seg button:has-text('Талия')")
        ok(S + "вкладка «Талия»: график и последний замер 73", pg.query_selector(".bodychart") is not None and "73" in pg.inner_text(".bodylog"))
        pg.click(".bodylog >> text=Записать замер")
        pg.fill('.bodyform input[type=date]', "2026-11-09"); pg.query_selector_all(".bodyform input[inputmode=decimal]")[0].fill("5")
        pg.click(".bodyform .btn:has-text('Сохранить')"); pg.wait_for_selector(".toast")
        ok(S + "вес 5 кг не принимается", "от 20 до 400" in pg.inner_text(".toast"), pg.inner_text(".toast"))
        pg.reload(); pg.wait_for_selector(".bodylog") if False else None
        # Подстройка цели: вес стоит три замера за 14 дней при цели «снижение»
        today = datetime.date.today()
        ds = [(today - datetime.timedelta(days=d)).isoformat() for d in (14, 7, 0)]
        S2 = {**SETTINGS, "members": [{**SETTINGS["members"][0], "body": {"sex": "f", "born": 1991, "height": 165, "weight": 80, "goal": "lose"}}],
              "measures": {"m1": [{"date": d, "weight": 80} for d in ds]}}
        pg.evaluate(SEED, S2); pg.reload(); pg.wait_for_selector("h1")
        pg.click('[aria-label^="Ещё: семья"]'); pg.click("text=Питание · проба"); pg.wait_for_selector(".goalcheck")
        gc = pg.inner_text(".goalcheck")
        ok(S + "проверка цели: вес стоит, предложено убавить", "почти не меняется" in gc and "ккал в день" in gc, gc)
        kc0 = pg.inner_text(".nut-card .hero b")
        pg.click(".goalcheck .btn:not(.sec)"); pg.wait_for_selector(".toast")
        ok(S + "поправка применена", "Цель подстроена" in pg.inner_text(".toast"))
        ok(S + "после применения — следующая проверка через 14 дней", "Следующая проверка" in pg.inner_text(".goalcheck"), pg.inner_text(".goalcheck"))
        ok(S + "калорийность в карточке уменьшилась", pg.inner_text(".nut-card .hero b") != kc0, [kc0, pg.inner_text(".nut-card .hero b")])
        ok(S + "без ошибок в консоли", not errs, errs)
n = sum(res); print(f"\nжурнал веса (браузер): {n} из {len(res)}"); sys.exit(0 if n == len(res) else 1)
