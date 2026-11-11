# Проверка «Сообщить об ошибке» в браузере: сборка с адресом приёмника, приёмник подменён.
#   FEEDBACK_URL=https://fb.test npm run build && python3 tests/e2e_feedback.py
import os, sys, json, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8160
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
SETTINGS = {"tipsSeen": ["intro", "home-gear", "menu"], "lastBackup": 1999999999999, "seenNews": "2099-01-01",
            "consent": {k: {"version": V, "at": 1} for k in ("policy", "health", "off")}}
PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
def more(pg):
    pg.click(".tabs button[aria-label=Главная]"); pg.click('[aria-label="Ещё: семья, ограничения, данные"]')
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"),
                           args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    for scheme in ["light", "dark"]:
        S = f"[{scheme}] "
        ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme, permissions=["microphone"])
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        sent = {"report": None, "voice": 0}
        def handle(route):
            req = route.request; h = {"access-control-allow-origin": "*", "content-type": "application/json"}
            if req.method == "OPTIONS": return route.fulfill(status=204, headers={**h, "access-control-allow-headers": "*", "access-control-allow-methods": "POST"})
            if req.url.endswith("/transcribe"):
                sent["voice"] = len(req.post_data_buffer or b""); return route.fulfill(status=200, headers=h, body=json.dumps({"ok": True, "text": "кнопка не нажимается"}))
            sent["report"] = req.post_data_buffer; sent["headers"] = req.headers
            return route.fulfill(status=200, headers=h, body=json.dumps({"ok": True}))
        pg.route("https://fb.test/**", handle)
        pg.goto(URL); pg.wait_for_selector("h1"); pg.evaluate(SEED, SETTINGS); pg.reload(); pg.wait_for_selector("h1")
        more(pg)
        ok(S + "в «Ещё» есть строка «Сообщить об ошибке»", pg.query_selector("text=Сообщить об ошибке") is not None)
        pg.click(".li:has-text('Сообщить об ошибке'), .row:has-text('Сообщить об ошибке'), button:has-text('Сообщить об ошибке')")
        pg.wait_for_selector("#fb-text")
        t = pg.inner_text("body")
        ok(S + "на экране три способа: текст, голос, вложения", "Надиктовать" in t and "Скриншоты и файлы" in t and pg.query_selector("#fb-text") is not None)
        ok(S + "предупреждение: анонимно, но видно всем на GitHub", "анонимное" in t and "GitHub" in t)
        ok(S + "пустое сообщение не отправляется", (pg.click("button:has-text('Отправить')"), "Напишите, что случилось" in pg.inner_text("body"))[1])
        # Вложения
        os.makedirs("/tmp/fbtest", exist_ok=True)
        open("/tmp/fbtest/a.png", "wb").write(PNG); open("/tmp/fbtest/bad.exe", "wb").write(b"MZ"); open("/tmp/fbtest/big.txt", "wb").write(b" " * (5 * 1024 * 1024 + 10))
        pg.set_input_files("#fb-file", "/tmp/fbtest/bad.exe")
        ok(S + "неподходящий файл не принимается", "можно приложить картинку" in pg.inner_text("body"))
        pg.set_input_files("#fb-file", "/tmp/fbtest/big.txt")
        ok(S + "файл больше 5 МБ не принимается", "больше 5 МБ" in pg.inner_text("body"))
        pg.set_input_files("#fb-file", "/tmp/fbtest/a.png")
        ok(S + "картинка добавлена в список и её можно убрать", "a.png" in pg.inner_text("body") and pg.query_selector("[aria-label='Убрать a.png']") is not None)
        # Голос: сначала согласие
        pg.click("button:has-text('Надиктовать')"); pg.wait_for_selector("text=Согласен(на) отправить")
        ok(S + "перед голосом и отправкой спрашивается согласие, сказано про открытый репозиторий", "открытый репозиторий" in pg.inner_text("body"))
        pg.click("button:has-text('Не сейчас')"); pg.wait_for_timeout(300)
        ok(S + "без согласия запись не начинается", pg.query_selector("button[aria-label='Остановить запись']") is None)
        pg.click("button:has-text('Надиктовать')"); pg.click("button:has-text('Согласен(на) отправить')")
        pg.wait_for_selector("button[aria-label='Остановить запись']", timeout=8000)
        pg.wait_for_timeout(1800); pg.click("button[aria-label='Остановить запись']")
        pg.wait_for_function("document.querySelector('#fb-text').value.includes('кнопка')", timeout=10000)
        ok(S + "голос превращён в текст и добавлен в поле", "кнопка не нажимается" in pg.input_value("#fb-text"))
        ok(S + "запись ушла на распознавание", sent["voice"] > 500, sent["voice"])
        pg.fill("#fb-text", pg.input_value("#fb-text") + " Версия 17")
        # Отправка
        pg.click("button:has-text('Отправить')"); pg.wait_for_selector("text=Спасибо, сообщение отправлено", timeout=8000)
        body = (sent["report"] or b"").decode("utf-8", errors="replace")
        ok(S + "сообщение отправлено: текст, файл, версия", "name=\"text\"" in body and "Версия 17" in body and "filename=\"a.png\"" in body and "name=\"version\"" in body)
        ok(S + "приманка для роботов пустая", 'name="website"' in body and body.split('name="website"')[1].split("--")[0].strip() == "")
        h = {k.lower(): v for k, v in (sent.get("headers") or {}).items()}
        ok(S + "никаких идентификаторов и cookie в запросе", "cookie" not in h and "authorization" not in h)
        ok(S + "после отправки поле очищено", (pg.click("button:has-text('Написать ещё')"), pg.input_value("#fb-text") == "")[1])
        ok(S + "без ошибок страницы", not errs, errs)
        ctx.close()
    br.close()
bad = res.count(False)
print(f"e2e_feedback: {len(res) - bad} из {len(res)}")
sys.exit(1 if bad else 0)
