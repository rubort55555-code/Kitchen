# Проверка удаления и возврата ограничений в питании в браузере: python3 tests/e2e_rules.py
import os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8140
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
SETTINGS = {"tipsSeen": ["intro", "home-gear", "menu"], "lastBackup": 1999999999999, "seenNews": "2026-11-16",
            "consent": {k: {"version": V, "at": 1} for k in ("policy", "health", "off")}}
def more(pg):
    pg.click(".tabs button[aria-label=Главная]")
    pg.click('[aria-label="Ещё: семья, ограничения, данные"]')
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    for scheme in ["light", "dark"]:
        S = f"[{scheme}] "
        pg = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme).new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("h1"); pg.evaluate(SEED, SETTINGS); pg.reload(); pg.wait_for_selector("h1")
        more(pg); pg.wait_for_selector("text=Ограничения в питании"); pg.click("text=Ограничения в питании")
        pg.wait_for_selector(".li:has-text('Холодец')")
        ok(S + "начальные ограничения на месте", all(pg.query_selector(f".li:has-text('{n}')") for n in ("Холодец", "Белая морская рыба", "Подсолнечные семечки")))
        ok(S + "пока ничего не удалено — ссылки «Вернуть» нет", pg.query_selector("button:has-text('Вернуть удалённые')") is None)
        pg.click(".li:has-text('Холодец')"); pg.wait_for_selector("text=Удалить ограничение")
        ok(S + "у начального ограничения есть кнопка «Удалить»", True)
        pg.click("button:has-text('Удалить ограничение')"); pg.wait_for_selector(".toast")
        ok(S + "начальное ограничение удалено", pg.query_selector(".li:has-text('Холодец')") is None)
        ok(S + "остальные ограничения остались", pg.query_selector(".li:has-text('Белая морская рыба')") is not None and pg.query_selector(".li:has-text('Подсолнечные семечки')") is not None)
        ok(S + "появилась ссылка «Вернуть удалённые начальные»", pg.query_selector("button:has-text('Вернуть удалённые начальные')") is not None)
        pg.click(".toast button"); pg.wait_for_selector(".li:has-text('Холодец')")
        ok(S + "«Отменить» возвращает удалённое", pg.query_selector(".li:has-text('Холодец')") is not None)
        # свои ограничения удаляются и не пропадают при возврате начальных
        pg.click("button:has-text('Добавить ограничение')"); pg.wait_for_selector("#rt"); pg.fill("#rt", "Мой запрет"); pg.fill("#rw", "изюм"); pg.click("button.btn:has-text('Сохранить')")
        pg.wait_for_selector(".li:has-text('Мой запрет')")
        pg.click(".li:has-text('Семечки'), .li:has-text('Подсолнечные семечки')"); pg.wait_for_selector("text=Удалить ограничение"); pg.click("button:has-text('Удалить ограничение')")
        pg.wait_for_selector("button:has-text('Вернуть удалённые начальные')")
        pg.click("button:has-text('Вернуть удалённые начальные')"); pg.wait_for_selector(".li:has-text('Подсолнечные семечки')")
        ok(S + "возврат добавляет удалённое и не трогает свои", pg.query_selector(".li:has-text('Мой запрет')") is not None and pg.query_selector(".li:has-text('Подсолнечные семечки')") is not None)
        ok(S + "после возврата ссылки больше нет", pg.query_selector("button:has-text('Вернуть удалённые')") is None)
        # после перезагрузки удалённое не появляется само
        pg.click(".li:has-text('Холодец')"); pg.wait_for_selector("text=Удалить ограничение"); pg.click("button:has-text('Удалить ограничение')"); pg.wait_for_selector(".toast")
        pg.wait_for_timeout(300); pg.reload(); pg.wait_for_selector("h1")
        more(pg); pg.click("text=Ограничения в питании"); pg.wait_for_selector(".li:has-text('Подсолнечные семечки')")
        ok(S + "после перезапуска удалённое не возвращается само", pg.query_selector(".li:has-text('Холодец')") is None)
        ok(S + "без ошибок страницы", not errs, errs)
    br.close()
bad = res.count(False)
print(f"e2e_rules: {len(res) - bad} из {len(res)}")
sys.exit(1 if bad else 0)
