# Проверка режима «рекомендации при мочекаменной болезни» в браузере: python3 tests/e2e_condition.py
import os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8131
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
SETTINGS = {"members": [{"id": "m1", "name": "Миша", "allergies": [], "dislikes": [], "body": {"sex": "m", "born": 1985, "height": 180, "weight": 80, "goal": "keep"}}],
            "tipsSeen": ["intro", "home-gear"], "lastBackup": 1999999999999, "seenNews": "2026-11-13",
            "consent": {k: {"version": V, "at": 1} for k in ("policy", "health", "off")}}
def open_nutrition(pg):
    if pg.query_selector('[aria-label^="Ещё: семья"]'): pg.click('[aria-label^="Ещё: семья"]')
    pg.click("text=Питание · проба"); pg.wait_for_selector(".nut-card")

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    for scheme in ["light", "dark"]:
        S = f"[{scheme}] "
        pg = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme).new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("h1"); pg.evaluate(SEED, SETTINGS); pg.reload(); pg.wait_for_selector("h1")
        open_nutrition(pg)
        pg.click(".nut-card .link:has-text('Изменить')"); pg.wait_for_selector("#nb")
        ok(S + "пока пробная функция выключена, блока «Заболевания» в профиле нет", "Заболевания (если диагноз поставил врач)" not in pg.inner_text(".sheet"))
        pg.click(".sheet .x")
        pg.evaluate(SEED, {**SETTINGS, "beta": {"conditions": True}}); pg.reload(); pg.wait_for_selector("h1"); open_nutrition(pg)
        ok(S + "до включения режима кнопки справочника нет", pg.query_selector("text=Справочник: рекомендации по питанию при мочекаменной болезни") is None or "📖" not in pg.inner_text(".nut-card"))
        # Отказ от согласия: режим не включается
        pg.click(".nut-card .link:has-text('Изменить')"); pg.wait_for_selector("text=Заболевания (если диагноз поставил врач)")
        pg.click(".chip:text-is('Мочекаменная болезнь')"); pg.wait_for_selector('.sheet[aria-label="Согласие"]')
        ok(S + "окно отдельного согласия на сведения о заболевании", "Сведения о заболевании" in pg.inner_text('.sheet[aria-label="Согласие"]') and "рекомендации врача важнее" in pg.inner_text('.sheet[aria-label="Согласие"]'))
        pg.click('.sheet[aria-label="Согласие"] .btn.ghost:has-text("Не включать")'); pg.wait_for_selector('.sheet[aria-label="Согласие"]', state="detached")
        ok(S + "после отказа режим не включился (нет выбора типа камней)", pg.query_selector("text=Тип камней (если врач назвал)") is None)
        # Согласие: режим включается
        pg.click(".chip:text-is('Мочекаменная болезнь')"); pg.wait_for_selector('.sheet[aria-label="Согласие"]')
        pg.click('.sheet[aria-label="Согласие"] .btn:has-text("Подтверждаю")'); pg.wait_for_selector("text=Тип камней (если врач назвал)")
        ok(S + "после согласия видны типы камней и отметки", pg.query_selector(".chip:has-text('кальций-оксалатные')") is not None and pg.query_selector(".chip:has-text('Принимаю мочегонные')") is not None)
        pg.click(".chip:has-text('кальций-оксалатные')")
        pg.click(".btn:has-text('Посчитать')"); pg.wait_for_selector(".nut-card")
        txt = pg.inner_text(".nut-card")
        ok(S + "в карточке норма воды выросла до 2,5 л", "2,5" in txt, txt[:300])
        ok(S + "кнопка справочника появилась", pg.query_selector(".nut-card .btn:has-text('Справочник: рекомендации по питанию при мочекаменной болезни')") is not None)
        pg.click(".nut-card .btn:has-text('Справочник')"); pg.wait_for_selector('.sheet[aria-label="Справочник"]')
        sh = pg.inner_text('.sheet[aria-label="Справочник"]')
        ok(S + "справочник: дисклеймер «не лечит, не диагностирует»", "не лечит" in sh and "не диагностирует" in sh and "следуйте назначению врача" in sh)
        ok(S + "справочник: когда нужна помощь — скорая 103/112 и врач в тот же день", "103" in sh and "112" in sh and "в тот же день" in sh)
        ok(S + "справочник: кальций 1000–1200, соль 5 г, белок 64–80 г", "1000–1200" in sh and "5 г" in sh and "64–80 г" in sh, sh[:600])
        ok(S + "справочник: у каждой карточки источник и уровень", pg.query_selector_all('.sheet[aria-label="Справочник"] details').__len__() >= 8)
        ok(S + "справочник: нет слов «лечение» и «растворение»", "лечени" not in sh.replace("не лечит", "") .lower() and "растворени" not in sh.lower().replace("«для растворения камней»", ""))
        # Страница «Конфиденциальность»: отдельное согласие, отзыв стирает отметки
        pg.click('.sheet .x') if pg.query_selector('.sheet .x') else None
        pg.wait_for_selector('.sheet[aria-label="Справочник"]', state="detached")
        pg.click('.back'); pg.click("text=Конфиденциальность"); pg.wait_for_selector("text=Согласия")
        ok(S + "в «Конфиденциальность» есть согласие на сведения о заболевании", "Сведения о заболевании" in pg.inner_text(".screen") and pg.query_selector('.kv:has-text("Сведения о заболевании") .link:has-text("Отозвать")') is not None)
        pg.click('.kv:has-text("Сведения о заболевании") .link:has-text("Отозвать")'); pg.wait_for_selector(".toast")
        ok(S + "отзыв согласия стирает отметки о заболевании", "отметки о заболевании удалены" in pg.inner_text(".toast"))
        pg.click('.back'); open_nutrition(pg)
        ok(S + "после отзыва справочника в карточке нет, вода обычная", "Справочник" not in pg.inner_text(".nut-card"))
        ok(S + "без ошибок в консоли", not errs, errs)
n = sum(res); print(f"\nрежим при заболевании (браузер): {n} из {len(res)}"); sys.exit(0 if n == len(res) else 1)
