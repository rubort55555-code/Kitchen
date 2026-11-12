# Проверка оценки меню и порций в браузере: python3 tests/e2e_menu.py
import os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8130
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
V = "2026-11-10"
SETTINGS = {"members": [{"id": "m1", "name": "Аня", "allergies": [], "dislikes": [], "body": {"sex": "f", "born": 1991, "height": 165, "weight": 62, "goal": "keep"}}],
            "tipsSeen": ["intro", "home-gear", "menu"], "lastBackup": 1999999999999, "seenNews": "2026-11-10",
            "consent": {k: {"version": V, "at": 1} for k in ("policy", "health", "off")}, "planSlots": ["завтрак", "обед", "ужин"]}
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    for scheme in ["light", "dark"]:
        S = f"[{scheme}] "
        pg = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme).new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("h1"); pg.evaluate(SEED, SETTINGS); pg.reload(); pg.wait_for_selector("h1")
        pg.click('.tabs [aria-label="Рецепты"]'); pg.wait_for_selector('[aria-label="Раздел"]')
        pg.click('[aria-label="Раздел"] button:has-text("Меню")')
        pg.wait_for_selector("text=Заполнить из моих рецептов"); pg.click("text=Заполнить из моих рецептов"); pg.wait_for_selector(".dish:not(.empty)")
        ok(S + "кнопка «Насколько меню подходит» есть после заполнения", pg.query_selector('button:has-text("Насколько меню подходит")') is not None)
        pg.click('button:has-text("Насколько меню подходит")'); pg.wait_for_selector('.sheet[aria-label="Насколько меню подходит"]')
        sh = '.sheet[aria-label="Насколько меню подходит"]'
        t = pg.inner_text(sh)
        ok(S + "экран: уровни 1–5 и норма человека", "1. Запреты" in t and "2. Калории и БЖУ каждый день" in t and "5. Разнообразие и гарниры" in t and "ккал" in t, t[:300])
        ok(S + "экран: по дням есть блюда с порциями", pg.query_selector(sh + ' [aria-label^="Больше:"]') is not None)
        before = pg.inner_text(sh + " .card:nth-of-type(2)")
        pg.click(sh + ' [aria-label^="Больше:"]')
        ok(S + "кнопка «+» меняет порцию на 1,25", "1,25" in pg.inner_text(sh), pg.inner_text(sh)[:200])
        ok(S + "кнопки «Подобрать порции» нет: число порций выбирает человек", pg.query_selector(sh + ' .btn:has-text("Подобрать порции")') is None)
        ok(S + "все порции в пределах 0,5–4", all(0.5 <= float(x.replace(",", ".")) <= 4 for x in pg.eval_on_selector_all(sh + ' .arow .wbtn b', "els => els.map(e => e.textContent)")))
        # Автоподбор под нормы на чистой неделе
        pg.evaluate(SEED, {**SETTINGS, "planSlots": ["завтрак", "обед", "ужин", "перекус"]}); pg.reload(); pg.wait_for_selector("h1")
        pg.click('.tabs [aria-label="Рецепты"]'); pg.wait_for_selector('[aria-label="Раздел"]'); pg.click('[aria-label="Раздел"] button:has-text("Меню")')
        pg.wait_for_selector("text=Подобрать под мои нормы"); pg.click("text=Подобрать под мои нормы")
        pg.wait_for_selector(".toast:has-text('Подобрано блюд')", timeout=20000)
        ok(S + "автоподбор: сообщение с числом блюд и порциями", "Порции стандартные" in pg.inner_text(".toast"), pg.inner_text(".toast"))
        ok(S + "автоподбор: в меню появились блюда", len(pg.query_selector_all(".dish:not(.empty)")) >= 14, len(pg.query_selector_all(".dish:not(.empty)")))
        ok(S + "автоподбор: есть перекусы и кнопка приёма «Перекус»", len(pg.query_selector_all(".meal .slot:has-text('Перекус')")) >= 5 and pg.query_selector('.chip:has-text("Перекус")') is not None, len(pg.query_selector_all(".meal .slot:has-text('Перекус')")))
        gl = pg.query_selector_all(".meal.side:has(.slot:has-text('гарнир')) .dish:not(.empty)")
        ok(S + "автоподбор: гарниры стоят в меню (не меньше 3)", len(gl) >= 3, len(gl))
        first = gl[0].inner_text()
        gl[0].click(); pg.wait_for_selector('.sheet[aria-label="Гарнир"]')
        gs = '.sheet[aria-label="Гарнир"]'
        rows = pg.query_selector_all(gs + " .li")
        ok(S + "выбор гарнира: список подходящих (не меньше 3)", len(rows) >= 3, len(rows))
        ok(S + "выбор гарнира: текущий отмечен галочкой", pg.query_selector(gs + ' .li[aria-pressed="true"]') is not None)
        names = [r.inner_text().split("\n")[1] if "\n" in r.inner_text() else r.inner_text() for r in rows]
        other = [r for r in rows if r.get_attribute("aria-pressed") != "true"][0]
        other_name = other.query_selector(".name").inner_text()
        other.click(); pg.wait_for_selector(".toast:has-text('Гарнир:')")
        ok(S + "выбор гарнира: выбранный стал гарниром блюда", other_name in pg.inner_text(".screen"), other_name)
        pg.click('button[aria-label^="Убрать гарнир"]')
        ok(S + "гарнир можно убрать, и тогда видна кнопка «Выбрать гарнир»", pg.query_selector("text=Выбрать гарнир") is not None)
        pg.click('button:has-text("Насколько меню подходит")'); pg.wait_for_selector(sh)
        ok(S + "после автоподбора запреты и калории в порядке", "✅ 1. Запреты" in pg.inner_text(sh) and "2. Калории и БЖУ каждый день" in pg.inner_text(sh), pg.inner_text(sh)[:300])
        days_ok = pg.eval_on_selector_all(sh + " h4.nut-h", "els => els.filter(e => e.textContent.includes('✅')).length")
        ok(S + "автоподбор: не менее 5 дней из 7 полностью в норме", days_ok >= 5, days_ok)
        ok(S + "без ошибок в консоли", not errs, errs)
n = sum(res); print(f"\nоценка меню (браузер): {n} из {len(res)}"); sys.exit(0 if n == len(res) else 1)
