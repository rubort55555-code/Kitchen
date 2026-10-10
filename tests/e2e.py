# Проверка приложения в браузере (как на iPhone): python3 tests/e2e.py
import json, os, subprocess, sys, time, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SHOTS = os.path.join(ROOT, "tests")
PORT = 8123

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"

res = []
def ok(name, cond, extra=""):
    res.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:300]))

OLD = {"app": "chto-prigotovit", "v": 1, "at": "2026-10-10T10:00:00Z", "state": {
    "items": [{"id": "o1", "name": "Кефир", "amount": 1, "left": 0.5, "unit": "л", "price": 90, "ud": "2026-10-13", "place": "Холодильник"},
              {"id": "o2", "name": "Пельмени", "amount": 1000, "unit": "г", "price": 400, "until": 1790000000000, "place": "Морозилка"}],
    "log": [{"i": "l1", "t": 1790000000000, "k": "t", "n": "Хлеб", "q": 1, "u": "шт", "r": 60}],
    "fav": [{"name": "Сырники", "minutes": 20, "ingredients": [{"name": "Творог", "amount": "400 г"}], "steps": ["Смешать", "Жарить"]}],
    "hist": {"кефир": {"name": "Кефир", "price": 90, "amount": 1, "unit": "л", "place": "Холодильник", "n": 3, "t": 1}},
}}

with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ["light", "dark"]:
        ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                             color_scheme=scheme, permissions=["clipboard-read", "clipboard-write"], accept_downloads=True)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(URL); pg.wait_for_selector("h1")
        S = f"[{scheme}] "
        ok(S + "главная открылась", pg.inner_text("h1") == "Кухня")
        ok(S + "пустое состояние с подсказкой", "Добавьте продукты из холодильника" in pg.inner_text("main"))
        ok(S + "нет горизонтальной прокрутки", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        pg.screenshot(path=f"{SHOTS}/{scheme}-home-empty.png")

        # «?» на главной
        pg.click(".helpbtn"); pg.wait_for_selector(".sheet")
        ok(S + "«?» показывает справку экрана", "Съесть в первую очередь" in pg.inner_text(".sheet") or "срок" in pg.inner_text(".sheet"))
        pg.click(".sheet-h > button:last-child")

        # добавление за 3 касания: + → частый → Добавить (нужна цена у нового продукта)
        pg.click(".tabs .plus"); pg.wait_for_selector("#pName")
        t0 = time.time()
        pg.click(".sheet .chips .chip >> text=Молоко")
        ok(S + "подсказка заполнила единицу и срок", pg.input_value("#pQty") == "1" and pg.input_value("#pUntil") != "")
        pg.fill("#pPrice", "95")
        pg.click(".sheet button[type=submit]")
        ok(S + "продукт добавлен быстро", time.time() - t0 < 5)
        ok(S + "сообщение с отменой", "Добавлено: Молоко" in pg.inner_text(".toast"))
        # без цены — ошибка
        pg.fill("#pName", "Курица"); pg.click(".sugg button >> nth=0"); pg.fill("#pPrice", "")
        pg.click(".sheet button[type=submit]")
        ok(S + "без цены не добавляет", "Укажите цену" in pg.inner_text(".sheet"))
        pg.fill("#pPrice", "350"); pg.click(".sheet button[type=submit]")
        # треска: предупреждение об исключении
        pg.fill("#pName", "Треска");
        ok(S + "предупреждение про треску", "Белая морская рыба" in pg.inner_text(".sheet"))
        pg.fill("#pName", "Минтай")
        ok(S + "минтай без предупреждения", "Белая морская рыба" not in pg.inner_text(".sheet"))
        pg.click(".sugg button >> nth=0"); pg.fill("#pPrice", "300")
        ok(S + "минтай — морозилка", pg.evaluate("[...document.querySelectorAll('.sheet .seg button[aria-pressed=true]')].map(b=>b.textContent).join('|')").find("Морозилка") >= 0)
        pg.click(".sheet button[type=submit]")
        pg.screenshot(path=f"{SHOTS}/{scheme}-add.png")
        pg.click(".sheet-h > button:last-child")

        # повторная покупка — цена подставляется
        pg.click(".tabs .plus"); pg.click(".sheet .chips .chip >> text=Молоко")
        ok(S + "последняя цена подставилась", pg.input_value("#pPrice") == "95")
        pg.click(".sheet-h > button:last-child")

        # Продукты
        pg.click(".tabs button >> text=Продукты")
        ok(S + "в списке 3 продукта", pg.locator(".swipe").count() == 3, pg.locator(".swipe").count())
        pg.screenshot(path=f"{SHOTS}/{scheme}-products.png")
        # свайп влево по Молоку → Съели → отмена
        row = pg.locator(".swipe", has_text="Молоко").locator(".row")
        b = row.bounding_box()
        y = b["y"] + b["height"] / 2
        pg.mouse.move(b["x"] + b["width"] - 20, y); pg.mouse.down()
        for i in range(1, 11): pg.mouse.move(b["x"] + b["width"] - 20 - i * 25, y)
        pg.mouse.up(); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{SHOTS}/{scheme}-swipe.png")
        pg.locator(".swipe", has_text="Молоко").locator(".a-spoil").click()
        ok(S + "свайп списал продукт", pg.locator(".swipe", has_text="Молоко").count() == 0 and "пропало" in pg.inner_text(".toast"))
        pg.click(".toast button")
        ok(S + "отмена вернула продукт", pg.locator(".swipe", has_text="Молоко").count() == 1)
        # частичное списание в карточке
        pg.locator(".swipe", has_text="Курица").locator(".row").click()
        pg.wait_for_selector(".sheet")
        pg.click(".sheet .seg button >> text=Половину")
        pg.click(".sheet .btn >> text=Съели")
        ok(S + "частичное списание", "Курица" in pg.inner_text("main") and "500" in pg.locator(".swipe", has_text="Курица").inner_text(), pg.locator(".swipe", has_text="Курица").inner_text())
        pg.click(".sheet-h > button:last-child")
        # «?» на экране продуктов
        pg.click(".helpbtn")
        ok(S + "справка продуктов про свайп", "Свайп влево" in pg.inner_text(".sheet"))
        pg.click(".sheet-h > button:last-child")

        # Рецепты: спросить Claude
        pg.click(".tabs button >> text=Рецепты")
        pg.click("text=Спросить Claude: что приготовить")
        pg.wait_for_selector(".sheet a.btn")
        href = pg.get_attribute(".sheet a.btn", "href")
        from urllib.parse import unquote
        prompt = unquote(href.split("q=", 1)[1])
        ok(S + "ссылка на Claude с запросом", href.startswith("https://claude.ai/new?q="))
        ok(S + "в запросе продукты и ограничения", "Молоко" in prompt and "холодец" in prompt and "треска" in prompt and "камбала и минтай" in prompt and "семечки" in prompt, prompt[:400])
        pg.click(".sheet .seg button >> text=Только Я")
        href2 = pg.get_attribute(".sheet a.btn", "href")
        ok(S + "«только я» меняет запрос", "1 взрослый" in unquote(href2))
        # вставить пример ответа
        sample = open(os.path.join(ROOT, "tests", "sample_answer.txt"), encoding="utf-8").read()
        pg.evaluate("t => navigator.clipboard.writeText(t)", sample)
        pg.click(".sheet >> text=Вставить ответ")
        pg.wait_for_selector(".sheet >> text=Сохранить в рецепты")
        txt = pg.inner_text(".sheet")
        ok(S + "найдено 5 блюд", "Нашёл 5 блюд" in txt, txt[-600:])
        ok(S + "холодец не сохраню", "Не сохраню" in txt and "Холодец" in txt)
        pg.screenshot(path=f"{SHOTS}/{scheme}-ask.png", full_page=False)
        pg.click(".sheet >> text=Сохранить в рецепты")
        ok(S + "сохранены 3 из 5", pg.locator("main .list .li").count() == 3 and "не подходит" in pg.inner_text(".toast"), pg.locator("main .list .li").count())
        rec_txt = pg.inner_text("main")
        ok(S + "холодца и козинаков нет в списке", "Холодец" not in rec_txt and "Козинаки" not in rec_txt)
        # треска → замена
        pg.click("main .li >> text=Треска")
        ok(S + "у трески предложена замена", "Заменить на минтай" in pg.inner_text(".sheet"))
        pg.click(".sheet >> text=Заменить на минтай")
        ok(S + "треска заменена", "минтай" in pg.inner_text(".sheet-b h2").lower() and "Заменить на минтай" not in pg.inner_text(".sheet"), pg.inner_text(".sheet-b h2"))
        pg.screenshot(path=f"{SHOTS}/{scheme}-recipe.png")
        pg.click(".sheet-h > button:last-child")

        # Главная: что приготовить, потери
        pg.click(".tabs button >> text=Главная")
        home = pg.inner_text("main")
        ok(S + "главная: потери за месяц", "Пропало за" in home)
        pg.screenshot(path=f"{SHOTS}/{scheme}-home.png", full_page=True)

        # Ещё → Данные: копия → восстановление
        pg.click(".tabs button >> text=Ещё")
        pg.click("text=Данные и копия")
        with pg.expect_download() as dl:
            pg.click("text=Сохранить копию")
        path = dl.value.path()
        data = json.load(open(path, encoding="utf-8"))
        ok(S + "копия содержит всё", data["app"] == "kitchen-app" and len(data["products"]) == 3 and len(data["recipes"]) == 3 and len(data["log"]) >= 4, (len(data["products"]), len(data["recipes"]), len(data["log"])))
        # перенос из старой страницы
        pg.fill("textarea", json.dumps(OLD, ensure_ascii=False))
        pg.click("text=Проверить")
        ok(S + "старая копия распознана", "Нашёл данные из «Что приготовить»" in pg.inner_text("main"))
        pg.click("text=Добавить к текущим")
        pg.wait_for_timeout(300)
        ok(S + "перенос добавил продукты", "5 продуктов" in pg.inner_text("main") or "Готово" in pg.inner_text("main"), pg.inner_text("main")[-300:])
        # восстановление из файла (замена)
        pg.set_input_files("input[type=file]", path)
        pg.click("text=Заменить всё"); pg.wait_for_timeout(300)
        pg.click(".tabs button >> text=Продукты")
        ok(S + "восстановление из файла", pg.locator(".swipe").count() == 3, pg.locator(".swipe").count())

        # Демо-данные
        pg.click(".tabs button >> text=Ещё"); pg.click("text=Данные и копия")
        pg.click("text=Заполнить демо-данными"); pg.click("text=Заменить мои данные"); pg.wait_for_timeout(400)
        home = pg.inner_text("main")
        ok(S + "демо: главная со сроками и потерями", "Съесть в первую очередь" in home and "Молоко" in home)
        pg.screenshot(path=f"{SHOTS}/{scheme}-home-demo.png", full_page=True)

        # Справка: поиск
        pg.click(".tabs button >> text=Ещё"); pg.click("text=Помощь")
        pg.fill("input[type=search]", "как удалить продукт")
        ok(S + "поиск по справке", "списать" in pg.inner_text("main").lower())
        # Что-то не работает
        pg.click(".tabs button >> text=Ещё"); pg.click("main .li >> text=Что-то не работает")
        pg.fill("textarea", "тест"); pg.click("main .btn >> text=Скопировать")
        rep = pg.evaluate("navigator.clipboard.readText()")
        ok(S + "отчёт о проблеме", "Версия приложения" in rep and "тест" in rep)

        # Справочник: своя белая рыба → под запрет
        pg.click(".tabs button >> text=Ещё"); pg.click("text=Справочник продуктов")
        pg.click("text=Добавить свой продукт")
        pg.fill("#cn", "Тюрбо"); pg.click(".sheet .seg button >> text=Белая морск."); pg.click(".sheet .btn >> text=Сохранить")
        pg.click(".tabs .plus"); pg.fill("#pName", "Тюрбо")
        ok(S + "новая белая рыба под запретом", "Белая морская рыба" in pg.inner_text(".sheet"))
        pg.click(".sheet-h > button:last-child")

        # Данные сохраняются после перезапуска
        pg.reload(); pg.wait_for_selector("h1")
        pg.click(".tabs button >> text=Продукты")
        ok(S + "данные после перезапуска", pg.locator(".swipe").count() >= 10, pg.locator(".swipe").count())
        ok(S + "нет горизонтальной прокрутки (с данными)", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"))

        # Офлайн
        pg.wait_for_timeout(500)
        ok(S + "service worker активен", pg.evaluate("navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(()=>true)"))
        pg.reload(); pg.wait_for_timeout(500)
        ctx.set_offline(True)
        pg.reload(); pg.wait_for_selector("h1", timeout=5000)
        ok(S + "открывается без интернета", pg.inner_text("h1") in ("Кухня", "Продукты"))
        ctx.set_offline(False)
        ok(S + "нет ошибок JS", not errs, errs[:3])
        ctx.close()
    br.close()
srv.shutdown()
n = sum(1 for r in res if r[1])
print(f"\nИТОГО: {n} из {len(res)}")
sys.exit(0 if n == len(res) else 1)
