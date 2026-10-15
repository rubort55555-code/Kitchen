# Проверка экрана «Питание» (проба) в браузере: python3 tests/e2e_nutrition.py
import os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8126
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=os.path.join(ROOT, "dist")))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"

res = []
def ok(name, cond, extra=""):
    res.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:400]))

def more(pg):
    pg.click(".tabs button >> text=Главная")
    pg.click('[aria-label="Ещё: семья, ограничения, данные"]')

with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ["light", "dark"]:
        ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme=scheme, permissions=["clipboard-read", "clipboard-write"])
        pg = ctx.new_page()
        pg.route("**/recipes.json", lambda r: r.abort())
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("h1")
        S = f"[{scheme}] "
        more(pg)
        ok(S + "в «Ещё» есть «Питание · проба»", pg.query_selector("text=Питание · проба") is not None)
        pg.click("text=Питание · проба"); pg.wait_for_selector("text=Пробная функция")
        ok(S + "два члена семьи — кнопки «Заполнить»", len(pg.query_selector_all("button:has-text('Заполнить')")) == 2)

        # Первый: женщина, 1991, 165/62, офис, снизить вес
        pg.click("button:has-text('Заполнить') >> nth=0"); pg.wait_for_selector("#nb")
        pg.fill("#nb", "1991"); pg.fill("#nh", "165"); pg.fill("#nw", "70"); pg.fill("#nwa", "84")
        pg.click('.sheet .chip:has-text("Снизить вес")')
        hours = pg.inner_text(".sheet .list")
        ok(S + "распорядок по умолчанию: отдых 5", "Отдых сидя" in hours and "\n5" in hours, hours)
        pg.click('[aria-label="Ходьба: больше"]'); pg.click('[aria-label="Ходьба: больше"]')
        ok(S + "ходьба +1 ч → отдых 4", pg.inner_text(".nut-hour:has-text('Отдых сидя') b") == "4")
        pg.click("text=+ Добавить тренировку")
        pg.select_option('[aria-label="Вид тренировки"]', "yoga")
        pg.fill('[aria-label="Минут за раз"]', "60"); pg.fill('[aria-label="Раз в неделю"]', "2")
        pg.screenshot(path=os.path.join(ROOT, "tests", f"{scheme}-nutrition-form.png"), full_page=True)
        pg.click(".sheet .btn:has-text('Посчитать')")
        pg.wait_for_selector(".nut-card")
        card = pg.inner_text(".nut-card")
        ok(S + "показаны ккал и цель", "ккал в день" in card and "снизить вес" in card, card)
        ok(S + "БЖУ и клетчатка", all(x in card for x in ["белки, г", "жиры, г", "углев., г", "клетч., г"]), card)
        ok(S + "ИМТ 25,7 — избыток", "25,7" in card and "избыток" in card, card)
        ok(S + "вес в неделю со знаком минус", "−0," in card, card)
        pg.click(".nut-card button:has-text('Подробнее')")
        card = pg.inner_text(".nut-card")
        ok(S + "подробно: обмен, КФА, группа", "Основной обмен" in card and "КФА" in card and "Группа по МР" in card, card)
        ok(S + "талия 84 — риск повышен", "риск немного повышен" in card, card)
        ok(S + "витамины: железо 18 мг, D 15 мкг", "18 мг" in card and "Витамин D" in card and "15 мкг" in card, card)
        ok(S + "сахар ≤ 5% при ИМТ ≥ 25", "Добавленный сахар" in card, card)
        ok(S + "нет горизонтальной прокрутки", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        pg.screenshot(path=os.path.join(ROOT, "tests", f"{scheme}-nutrition.png"), full_page=True)

        # Второй: мужчина, беременность недоступна; ошибки ввода
        pg.click("button:has-text('Заполнить')"); pg.wait_for_selector("#nb")
        ok(S + "второй по умолчанию мужчина — без «Беременность»", pg.query_selector(".sheet .chip:has-text('Беременность')") is None)
        pg.fill("#nh", "17")
        pg.click(".sheet .btn:has-text('Посчитать')")
        ok(S + "ошибка роста", "Рост" in pg.inner_text('.sheet [role=alert]'))
        pg.fill("#nh", "180"); pg.fill("#nw", "82"); pg.fill("#nb", "1988")
        for _ in range(12): pg.click('[aria-label="Сидячая работа, учёба: больше"]')
        ok(S + "больше 24 часов — предупреждение", "больше суток" in pg.inner_text(".sheet"))
        pg.click(".sheet .btn:has-text('Посчитать')")
        ok(S + "не сохраняет больше 24 ч", "24 часа" in pg.inner_text('.sheet [role=alert]'))
        for _ in range(12): pg.click('[aria-label="Сидячая работа, учёба: меньше"]')
        pg.click('.sheet .chip:has-text("Спорт: больше белка")')
        pg.click(".sheet .btn:has-text('Посчитать')")
        pg.wait_for_selector("text=Вся семья в день")
        ok(S + "сводка по семье", "Вся семья в день" in pg.inner_text("main"))

        # Беременность: худеть нельзя
        pg.click(".nut-card >> nth=0 >> button:has-text('Изменить')"); pg.wait_for_selector("#nb")
        pg.click(".sheet .chip:has-text('Беременность')")
        pg.click(".sheet .btn:has-text('Посчитать')"); pg.wait_for_timeout(200)
        first = pg.inner_text(".nut-card >> nth=0")
        ok(S + "беременность: цель «сохранить» и предупреждение", "сохранить вес" in first and "беременности" in first, first)

        # Подросток — не считаем
        pg.click(".nut-card >> nth=1 >> button:has-text('Изменить')"); pg.wait_for_selector("#nb")
        pg.fill("#nb", "2012"); pg.click(".sheet .btn:has-text('Посчитать')"); pg.wait_for_timeout(200)
        ok(S + "подросток: расчёт не делается", "детей и подростков" in pg.inner_text("main"))
        pg.click("button:has-text('Изменить') >> nth=1"); pg.wait_for_selector("#nb")
        pg.fill("#nb", "1988"); pg.click(".sheet .btn:has-text('Посчитать')"); pg.wait_for_timeout(200)

        # «?» на экране
        pg.click('[aria-label="Помощь по этому экрану"]'); pg.wait_for_selector(".sheet")
        ok(S + "«?» — справка про питание", "Питание" in pg.inner_text(".sheet"))
        pg.click(".sheet-h > button:last-child")

        # Нормы попадают в запрос Claude
        pg.click(".tabs button >> text=Рецепты")
        pg.click("text=Спросить Claude"); pg.wait_for_selector(".sheet")
        pg.wait_for_timeout(300)
        txt = pg.evaluate("() => { const d = document.querySelector('.sheet details pre') || document.querySelector('.sheet pre'); return d ? d.textContent : document.querySelector('.sheet').innerText; }")
        ok(S + "запрос Claude: ориентиры по питанию", "Ориентиры по питанию" in txt and "ккал в день" in txt, txt[:600])
        pg.click(".sheet-h > button:last-child")

        # Выключатель в «Пробных функциях»
        more(pg); pg.click("text=Пробные функции")
        pg.click('label.li:has-text("Питание и личные нормы")'); pg.wait_for_timeout(200)
        more(pg)
        ok(S + "выключено — строки «Питание» нет", pg.query_selector("text=Питание · проба") is None)
        pg.click("text=Пробные функции"); pg.click('label.li:has-text("Питание и личные нормы")'); pg.wait_for_timeout(200)
        more(pg)
        ok(S + "включено снова — строка есть и с ккал", "ккал" in pg.inner_text("text=Питание · проба >> xpath=.."), pg.inner_text(".list >> nth=0"))
        ok(S + "нет ошибок", not errs, errs)
        ctx.close()
    br.close()
srv.shutdown()
bad = [n for n, c in res if not c]
print(f"\nПитание: {len(res) - len(bad)} из {len(res)}")
sys.exit(1 if bad else 0)
