# Проверка согласий и политики в браузере: python3 tests/e2e_privacy.py
import os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8129
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
BASE = {"members": [{"id": "m1", "name": "Аня", "allergies": [], "dislikes": [], "body": {"sex": "f", "born": 1991, "height": 165, "weight": 62, "goal": "keep"}}],
        "tipsSeen": ["home-gear"], "lastBackup": 1999999999999}
V = "2026-11-10"
def open_page(pg, label):
    if pg.query_selector('[aria-label^="Ещё: семья"]'): pg.click('[aria-label^="Ещё: семья"]')
    pg.click(f"text={label}")

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    for scheme in ["light", "dark"]:
        S = f"[{scheme}] "
        # 1. Первый запуск (автотестовый признак webdriver выключаем): сначала согласие, потом знакомство
        ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme)
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false})")
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("text=Ваши данные остаются у вас")
        ok(S + "первый запуск: окно «Ваши данные остаются у вас»", "только в памяти этого телефона" in pg.inner_text(".sheet"))
        pg.click('.sheet .link:has-text("Прочитать политику")')
        ok(S + "политика раскрывается целиком", "Open Food Facts" in pg.inner_text(".sheet") and "GitHub Pages" in pg.inner_text(".sheet"))
        pg.click('.sheet .btn:has-text("Понятно, продолжить")'); pg.wait_for_selector("text=Знакомство")
        ok(S + "после согласия показывается знакомство", True)
        ctx.close()

        # 1б. Существующий пользователь после обновления видит «Что нового» один раз; новичок — нет
        ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme)
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false})")
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("h1"); pg.evaluate(SEED, {**BASE, "tipsSeen": ["intro", "home-gear"], "consent": {k: {"version": V, "at": 1} for k in ("policy", "health", "off")}}); pg.reload()
        pg.wait_for_selector("text=Что нового в «Кухне»")
        ok(S + "обновление: окно «Что нового» с пунктами", "Насколько меню подходит" in pg.inner_text(".sheet") and "Что нового" in pg.inner_text(".sheet"))
        pg.click('.sheet .btn:has-text("Понятно")'); pg.wait_for_selector(".sheet", state="detached")
        pg.reload(); pg.wait_for_selector("h1"); pg.wait_for_timeout(700)
        ok(S + "второй запуск: окно не повторяется", pg.query_selector(".sheet") is None)
        open_page(pg, "О приложении"); pg.click('.btn:has-text("Что нового")'); pg.wait_for_selector("text=Что нового в «Кухне»")
        ok(S + "вручную из «О приложении» открывается", True)
        ok(S + "(что нового) без ошибок в консоли", not errs, errs)
        ctx.close()

        # 2. Раздел «Питание» без согласия на данные о здоровье
        ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme)
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("h1"); pg.evaluate(SEED, {**BASE, "consent": {"policy": {"version": V, "at": 1}}}); pg.reload(); pg.wait_for_selector("h1")
        open_page(pg, "Питание · проба"); pg.wait_for_selector("text=Данные о здоровье и теле")
        ok(S + "питание: профиль скрыт до согласия", pg.query_selector(".nut-card") is None)
        pg.click('.btn:has-text("Согласен(на) вносить данные")'); pg.wait_for_selector(".nut-card")
        ok(S + "после согласия профиль виден", pg.query_selector(".nut-card") is not None)

        # 3. Страница «Конфиденциальность»
        pg.click('.back'); open_page(pg, "Конфиденциальность"); pg.wait_for_selector("text=Согласия")
        t = pg.inner_text(".screen")
        ok(S + "страница: три согласия и политика", "Данные о здоровье и теле" in t and "Open Food Facts" in t and "Политика конфиденциальности" in t)
        ok(S + "страница: здоровье дано, поиск по штрихкоду не дан", "дано" in t and "не дано" in t)
        pg.click('.kv:has-text("штрихкоду") .link:has-text("Дать")')
        ok(S + "согласие на штрихкод можно дать", pg.query_selector('.kv:has-text("штрихкоду") .link:has-text("Отозвать")') is not None)
        pg.click('.kv:has-text("Данные о здоровье") .link:has-text("Отозвать")')
        ok(S + "согласие на здоровье можно отозвать", pg.query_selector('.kv:has-text("Данные о здоровье") .link:has-text("Дать")') is not None)
        pg.click('.btn:has-text("Удалить данные о теле и здоровье")'); pg.click('.btn.danger:has-text("Да, удалить")'); pg.wait_for_selector(".toast")
        ok(S + "данные о теле удаляются", "удалены" in pg.inner_text(".toast"))
        pg.click('.back'); open_page(pg, "Питание · проба")
        ok(S + "после удаления профиль пуст (нужно согласие заново)", pg.query_selector(".nut-card") is None)
        ok(S + "без ошибок в консоли", not errs, errs)
        ctx.close()
n = sum(res); print(f"\nсогласия (браузер): {n} из {len(res)}"); sys.exit(0 if n == len(res) else 1)
