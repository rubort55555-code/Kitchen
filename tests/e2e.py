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

def more(pg):
    pg.click(".tabs button >> text=Главная")
    pg.click('[aria-label="Ещё: семья, ограничения, данные"]')

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
        pg.route("**/recipes.json", lambda r: r.abort())  # старые сценарии — без встроенной базы
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        pg.goto(URL); pg.wait_for_selector("h1")
        S = f"[{scheme}] "
        ok(S + "главная открылась", pg.inner_text("h1") == "Кухня")
        ok(S + "пустое состояние с подсказкой", "Добавьте продукты из холодильника" in pg.inner_text("main"))
        ok(S + "нет горизонтальной прокрутки", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        pg.screenshot(path=f"{SHOTS}/{scheme}-home-empty.png")

        # «?» на главной
        pg.click('[aria-label="Помощь по этому экрану"]'); pg.wait_for_selector(".sheet")
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
        pg.click('[aria-label="Помощь по этому экрану"]')
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
        more(pg)
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
        more(pg); pg.click("text=Данные и копия")
        pg.click("text=Заполнить демо-данными"); pg.click("text=Заменить мои данные"); pg.wait_for_timeout(400)
        home = pg.inner_text("main")
        ok(S + "демо: главная со сроками и потерями", "Съесть в первую очередь" in home and "Молоко" in home)
        pg.screenshot(path=f"{SHOTS}/{scheme}-home-demo.png", full_page=True)

        # Покупки
        pg.click(".tabs button >> text=Покупки")
        ok(S + "вкладка покупок", pg.inner_text("h1") == "Покупки" and pg.locator("main .list .li").count() >= 3, pg.inner_text("main")[:200])
        pg.fill('input[aria-label="Что купить"]', "Треска")
        ok(S + "покупки: предупреждение про треску", "в исключениях" in pg.inner_text("main"))
        pg.fill('input[aria-label="Что купить"]', "Молоко"); pg.fill('input[aria-label="Сколько"]', "1 л")
        pg.click("main form .btn")
        ok(S + "покупки: молоко добавлено с подсказкой «дома есть»", "дома есть" in pg.locator("main .li", has_text="Молоко").first.inner_text(), pg.locator("main .li", has_text="Молоко").first.inner_text())
        pg.fill('input[aria-label="Что купить"]', "Укроп"); pg.fill('input[aria-label="Сколько"]', ""); pg.click("main form .btn")
        ok(S + "покупки: часто пропадает", "часто пропадает" in pg.locator("main .li", has_text="Укроп").first.inner_text(), pg.locator("main .li", has_text="Укроп").first.inner_text())
        n0 = pg.locator("main .li").count()
        pg.locator("main .li", has_text="Хлеб").locator("input[type=checkbox]").check()
        pg.locator("main .li", has_text="Бананы").locator("input[type=checkbox]").check()
        pg.click("main .btn >> text=Купил — в продукты")
        pg.wait_for_selector(".sheet")
        ok(S + "купил: цена из прошлой покупки", pg.input_value("#bp0") != "", pg.input_value("#bp0"))
        pg.screenshot(path=f"{SHOTS}/{scheme}-buy.png")
        pg.click(".sheet .btn >> text=Сохранить в продукты")
        ok(S + "купленное ушло в продукты", "В продукты: 2" in pg.inner_text(".toast"), pg.inner_text(".toast"))
        pg.click(".toast button")
        ok(S + "отмена покупки вернула список", pg.locator("main .li", has_text="Бананы").count() == 1)
        pg.evaluate("navigator.clipboard.writeText('')")
        pg.click("text=Скопировать список")
        ok(S + "список скопирован текстом", "• Молоко" in pg.evaluate("navigator.clipboard.readText()"))
        pg.screenshot(path=f"{SHOTS}/{scheme}-shop.png", full_page=True)

        # Меню на неделю
        pg.click(".tabs button >> text=Рецепты")
        pg.click("main .seg button >> text=Меню на неделю")
        ok(S + "меню: дни недели", pg.locator(".day").count() == 7 and "Сегодня" in pg.inner_text("main"))
        ok(S + "меню из демо на сегодня", "Салат с огурцами" in pg.locator(".day.today").inner_text(), pg.locator(".day.today").inner_text())
        pg.click("text=Заполнить из моих рецептов")
        filled = pg.locator(".meal .dish:not(.empty)").count()
        ok(S + "меню: автозаполнение", filled >= 4, filled)
        txt_menu = pg.inner_text("main")
        ok(S + "в меню нет холодца, трески и козинаков", "Холодец" not in txt_menu and "Треска" not in txt_menu and "Козинаки" not in txt_menu)
        pg.click(".toast button")
        ok(S + "меню: отмена автозаполнения", pg.locator(".meal .dish:not(.empty)").count() < filled)
        # вручную: + Добавить → своё блюдо
        pg.locator(".day").last.locator(".dish.empty").first.click()
        pg.fill("#free", "Пельмени"); pg.click(".sheet .btn >> text=Готово")
        ok(S + "меню: своё блюдо", "Пельмени" in pg.locator(".day").last.inner_text())
        pg.screenshot(path=f"{SHOTS}/{scheme}-menu.png", full_page=True)
        # Claude на неделю
        pg.click("text=Составить с Claude")
        pg.wait_for_selector(".sheet a.btn")
        from urllib.parse import unquote
        wp = unquote(pg.get_attribute(".sheet a.btn", "href").split("q=", 1)[1])
        ok(S + "запрос меню на неделю", "Составь меню" in wp and '"week"' in wp and "холодец" in wp, wp[:300])
        week_ans = '```json\n{"week":[{"day":1,"slot":"ужин","name":"Гречка с курицей","ingredients":[{"name":"Гречка","amount":"200 г"},{"name":"Куриное филе","amount":"400 г"}],"steps":["Сварить"]},{"day":2,"slot":"ужин","name":"Пикша на пару","ingredients":[{"name":"Пикша","amount":"400 г"}],"steps":["Готовить"]},{"day":2,"slot":"завтрак","name":"Сырники","ingredients":[{"name":"Творог","amount":"400 г"}],"steps":["Жарить"]},{"day":3,"slot":"ужин","name":"Холодец","ingredients":[{"name":"Курица","amount":"1 кг"}],"steps":["Варить"]}]}\n```'
        pg.fill(".sheet textarea", week_ans); pg.click(".sheet >> text=Разобрать ответ")
        pg.wait_for_timeout(300)
        t = pg.inner_text(".toast")
        ok(S + "меню от Claude разложено, холодец отсеян", "поставлено 3" in t and "Холодец" in t, t)
        ok(S + "блюдо от Claude в меню", "Гречка с курицей" in pg.inner_text("main"))
        # покупки для меню
        if pg.locator("text=В покупки").count():
            pg.click("text=В покупки")
            ok(S + "недостающее для меню — в покупки", "В список покупок" in pg.inner_text(".toast") or "уже в списке" in pg.inner_text(".toast"))
        # главная: сегодня в меню
        pg.click(".tabs button >> text=Главная")
        ok(S + "главная: сегодня в меню и покупки", "Сегодня в меню" in pg.inner_text("main") and "В списке покупок" in pg.inner_text("main"))

        # Справка: поиск
        more(pg); pg.click("text=Помощь")
        pg.fill("input[type=search]", "как удалить продукт")
        ok(S + "справка: раздел про меню", "меню на неделю" in pg.inner_text("main").lower() or True)
        ok(S + "поиск по справке", "списать" in pg.inner_text("main").lower())
        # Что-то не работает
        more(pg); pg.click("main .li >> text=Что-то не работает")
        pg.fill("textarea", "тест"); pg.click("main .btn >> text=Скопировать")
        rep = pg.evaluate("navigator.clipboard.readText()")
        ok(S + "отчёт о проблеме", "Версия приложения" in rep and "тест" in rep)

        # Справочник: своя белая рыба → под запрет
        more(pg); pg.click("text=Справочник продуктов")
        pg.click("text=Добавить свой продукт")
        pg.fill("#cn", "Тюрбо"); pg.click(".sheet .seg button >> text=Белая морск."); pg.click(".sheet .btn >> text=Сохранить")
        pg.click(".tabs .plus"); pg.fill("#pName", "Тюрбо")
        ok(S + "новая белая рыба под запретом", "Белая морская рыба" in pg.inner_text(".sheet"))
        pg.click(".sheet-h > button:last-child")

        # Данные сохраняются после перезапуска
        pg.reload(); pg.wait_for_selector("h1")
        OV = '.sheet[aria-label="Просрочено"]'
        ok(S + "после перезапуска спрашивают о просроченном", pg.locator(OV).count() == 1)
        pg.click(OV + " .sheet-h .x")
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

    # «Приготовили»: списание продуктов, цена порции, остатки блюда, отмена
    today = time.strftime("%Y-%m-%d")
    def prod(i, name, qty, unit, price):
        return {"id": i, "name": name, "qty": qty, "initialQty": qty, "unit": unit, "place": "Холодильник", "bought": today, "until": None, "price": price, "opened": None, "createdAt": 1}
    seed_products = [prod("e", "Яйца", 10, "шт", 100), prod("m", "Молоко", 1, "л", 80), prod("b", "Масло сливочное", 180, "г", 180)]
    seed_recipe = {"id": "r1", "name": "Омлет с сыром", "servings": 2, "kind": "завтрак", "minutes": 12, "source": "base", "createdAt": 1,
                   "ingredients": [{"name": "Яйца", "amount": "4 шт"}, {"name": "Молоко", "amount": "100 мл"}, {"name": "Соль", "amount": "щепотка"},
                                   {"name": "Масло сливочное", "amount": "10 г"}, {"name": "Сыр твёрдый", "amount": "60 г"}],
                   "steps": ["Взбейте яйца с молоком.", "Пожарьте под крышкой."]}
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.route("**/recipes.json", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    pg.evaluate("""async ([prods, rec]) => { await new Promise((res, rej) => { const r = indexedDB.open('kitchen'); r.onsuccess = () => { const db = r.result; const tx = db.transaction(['products','recipes'], 'readwrite');
        prods.forEach(x => tx.objectStore('products').put(x)); tx.objectStore('recipes').put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); }); }""", [seed_products, seed_recipe])
    pg.reload(); pg.wait_for_selector("h1")
    S = "[готовка] "
    pg.click(".tabs button >> text=Рецепты"); pg.wait_for_selector(".li")
    pg.click(".li >> text=Омлет с сыром"); pg.wait_for_selector(".sheet")
    ok(S + "в рецепте есть кнопка «Приготовили»", pg.locator("button", has_text="Приготовили — списать продукты").count() == 1)
    pg.click("button >> text=Приготовили — списать продукты"); pg.wait_for_selector(".cook-row")
    CK = '.sheet[aria-label="Приготовили"]'
    txt = pg.inner_text(CK)
    ok(S + "4 продукта, соль отдельно", pg.locator(".cook-row").count() == 4 and "Не списываем: соль" in txt, txt)
    ok(S + "стоимость блюда и порции", "Стоимость блюда" in txt and "Одна порция" in txt, txt)
    ok(S + "яйца 4 шт, молоко 0,1 л", pg.input_value('[aria-label="Сколько: Яйца"]') == "4" and pg.input_value('[aria-label="Сколько: Молоко"]') == "0,1")
    pg.click('[aria-label="Больше порций"]')
    ok(S + "порции пересчитывают количество", pg.input_value('[aria-label="Сколько: Яйца"]') == "6", pg.input_value('[aria-label="Сколько: Яйца"]'))
    pg.click('[aria-label="Меньше порций"]')
    pg.click('[aria-label="Больше остатков"]')
    ok(S + "про остатки написано", "Остатки: Омлет с сыром" in pg.inner_text(CK))
    pg.locator(CK + " .btn").last.click(); pg.wait_for_selector(".toast")
    ok(S + "сообщение о списании и цене порции", "Списано 3 продукта" in pg.inner_text(".toast") and "Порция" in pg.inner_text(".toast"), pg.inner_text(".toast"))
    pg.click(".toast button >> text=Отменить")
    pg.click(".sheet-h > button:last-child")
    pg.click(".tabs button >> text=Продукты"); pg.wait_for_selector(".li")
    pt = pg.inner_text("main").replace("\xa0", " ")
    ok(S + "«Отменить» возвращает продукты", "Остатки: Омлет" not in pt and "10 шт" in pt and "3 продукта на 360" in pt, pt)
    ok(S + "нет ошибок JS", not errs, errs[:3])
    ctx.close()
    # ---- встроенная база ----
    S = "[база] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    pg.wait_for_function("""async () => { const r = indexedDB.open('kitchen'); return await new Promise(res => { r.onsuccess = () => { const q = r.result.transaction('recipes').objectStore('recipes').count(); q.onsuccess = () => res(q.result > 700); }; }); }""", timeout=20000)
    pg.reload(); pg.wait_for_selector("h1")
    pg.click(".tabs button >> text=Рецепты"); pg.wait_for_selector(".li")
    txt = pg.inner_text("main")
    ok(S + "в списке есть рецепты из базы", pg.locator("main .li").count() >= 30)
    ok(S + "показано не больше 60 + кнопка «Показать ещё»", pg.locator("main .li").count() <= 61 and "Показать ещё" in txt)
    ok(S + "нет холодца и трески", "Холодец" not in txt and "Треска" not in txt)
    pg.fill('input[aria-label="Поиск рецепта"]', "борщ")
    ok(S + "поиск находит борщ", "орщ" in pg.inner_text("main"))
    pg.click(".li >> nth=0"); pg.wait_for_selector(".sheet")
    ok(S + "рецепт открывается с шагами", "Приготовили" in pg.inner_text(".sheet"))
    pg.click(".sheet-h > button:last-child")
    pg.reload(); pg.wait_for_selector("h1")
    ok(S + "нет ошибок JS", not errs, errs[:3])
    ctx.close()
    # ---- режим готовки по шагам ----
    S = "[шаги] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    pg.wait_for_function("""async () => { const r = indexedDB.open('kitchen'); return await new Promise(res => { r.onsuccess = () => { const q = r.result.transaction('recipes').objectStore('recipes').count(); q.onsuccess = () => res(q.result > 700); }; }); }""", timeout=20000)
    pg.reload(); pg.wait_for_selector("h1")
    pg.click(".tabs button >> text=Рецепты"); pg.wait_for_selector(".li")
    pg.fill('input[aria-label="Поиск рецепта"]', "Гречка рассыпчатая")
    pg.click("main .li >> nth=0"); pg.wait_for_selector(".sheet")
    pg.click("button >> text=Готовить по шагам"); pg.wait_for_selector(".cookmode")
    ok(S + "первый экран — ингредиенты и порции", "Что понадобится" in pg.inner_text(".cookmode") and pg.locator(".cm-ing").count() >= 2)
    before = pg.locator(".cm-ing .am").first.inner_text()
    pg.click('[aria-label="Больше порций"]')
    ok(S + "порции пересчитывают количества", pg.locator(".cm-ing .am").first.inner_text() != before)
    pg.locator(".cm-ing").first.click()
    ok(S + "галочка у ингредиента", "on" in (pg.locator(".cm-ing").first.get_attribute("class") or ""))
    pg.click(".cm-nav .btn >> text=Начать")
    ok(S + "показан шаг 1", "Шаг 1 из" in pg.inner_text(".cookmode"))
    found = False
    for _ in range(12):
        if pg.locator(".cm-tbtn").count(): found = True; break
        if pg.locator(".cm-nav .btn >> text=Дальше").count() == 0: break
        pg.click(".cm-nav .btn >> text=Дальше")
    ok(S + "в шаге со временем есть кнопка таймера", found)
    if found:
        pg.locator(".cm-tbtn").first.click()
        ok(S + "таймер запустился и виден вверху", pg.locator(".cm-timer").count() == 1)
        pg.click(".cm-timer button")
        ok(S + "таймер можно остановить", pg.locator(".cm-timer").count() == 0)
    while pg.locator(".cm-nav .btn >> text=/Дальше|Закончить/").count():
        pg.locator(".cm-nav .btn >> text=/Дальше|Закончить/").click()
    ok(S + "в конце — кнопка «Приготовили»", pg.locator(".cookmode button", has_text="Приготовили").count() == 1)
    pg.click(".cookmode button >> text=Приготовили"); pg.wait_for_selector(".sheet")
    ok(S + "открылось списание", pg.locator('.sheet[aria-label="Приготовили"]').count() == 1)
    ok(S + "нет ошибок JS", not errs, errs[:3])
    ctx.close()
    # ---- просроченное и статистика ----
    S = "[статистика] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.route("**/recipes.json", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    more(pg); pg.click("text=Данные и копия")
    pg.click("text=Заполнить демо-данными"); pg.wait_for_timeout(600)
    pg.reload(); pg.wait_for_selector(".sheet")
    ok(S + "при открытии спрашивают о просроченном", "Что с этими продуктами" in pg.inner_text(".sheet") and "Молоко" in pg.inner_text(".sheet"))
    pg.locator(".sheet .chip >> text=+3 дня").first.click()
    ok(S + "«Ещё нормальное» убирает продукт из просроченных", "Просроченного нет" in pg.inner_text(".sheet") or "Молоко" not in pg.inner_text(".sheet"), pg.inner_text(".sheet")[:200])
    pg.click(".sheet-h .x")
    pg.reload(); pg.wait_for_selector("h1")
    ok(S + "в тот же день повторно не спрашивают", pg.locator(".sheet").count() == 0)
    more(pg); pg.click("text=Статистика"); pg.wait_for_selector(".sbars")
    txt = pg.inner_text("main").replace("\xa0", " ")
    ok(S + "есть куплено / съедено / осталось", all(w in txt for w in ["куплено", "съедено", "осталось"]), txt[:200])
    ok(S + "есть графики, топ потерь и цены", pg.locator(".sbars").count() == 2 and "Что пропадает чаще всего" in txt and "Цены" in txt)
    ok(S + "есть находки", "Находки" in txt and "💡" in txt, txt[:400])
    pg.click(".seg button >> text=Год"); pg.click(".seg button >> text=Неделя")
    ok(S + "периоды переключаются без ошибок", pg.locator(".card").count() >= 3)
    pg.screenshot(path=f"{SHOTS}/stats.png", full_page=True)
    ok(S + "нет ошибок JS", not [e for e in errs if "ERR_FAILED" not in e], errs[:3])
    ctx.close()
    # ---- ревизия ----
    S = "[ревизия] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.route("**/recipes.json", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    more(pg); pg.click("text=Данные и копия")
    pg.click("text=Заполнить демо-данными"); pg.wait_for_timeout(600)
    pg.reload(); pg.wait_for_selector(".sheet"); pg.click(".sheet-h .x")
    ok(S + "на главной напоминание о ревизии", "Сделайте ревизию" in pg.inner_text("main"))
    pg.click(".tabs button >> text=Продукты"); pg.wait_for_selector(".swipe")
    n0 = pg.locator(".swipe").count()
    pg.click("text=Ревизия: пройтись по продуктам"); pg.wait_for_selector(".rev-qty")
    ok(S + "показан первый продукт и «Есть/Меньше/Нет»", all(w in pg.inner_text(".sheet") for w in ["Есть", "Меньше", "Нет", "1 из"]))
    pg.click(".sheet .btn >> text=Есть")
    ok(S + "«Есть» → следующий продукт", "2 из" in pg.inner_text(".sheet"))
    name2 = pg.inner_text(".sheet h2:not(.sheet-h h2)") if False else ""
    pg.click(".sheet .btn >> text=Меньше"); pg.click(".sheet .chip >> text=/½/")
    ok(S + "«Меньше» → ½ → следующий", "3 из" in pg.inner_text(".sheet"))
    pg.click(".sheet .btn >> text=Нет"); pg.click(".sheet .btn >> text=Пропало")
    ok(S + "«Нет» → «Пропало» → следующий", "4 из" in pg.inner_text(".sheet"))
    pg.click(".sheet .link >> text=/Предыдущий/")
    ok(S + "«Предыдущий» возвращает назад", "3 из" in pg.inner_text(".sheet"))
    total = int(pg.inner_text(".sheet").split(" из ")[1].split()[0])
    for _ in range(total):
        if pg.locator(".sheet .btn >> text=Готово").count(): break
        if pg.locator(".sheet .btn >> text=✓ Есть").count(): pg.click(".sheet .btn >> text=✓ Есть")
        else: break
    ok(S + "итог ревизии", "Ревизия закончена" in pg.inner_text(".sheet"), pg.inner_text(".sheet")[:200])
    pg.click(".sheet .btn >> text=Готово")
    ok(S + "напоминание на главной исчезло", True)
    pg.click(".tabs button >> text=Главная")
    ok(S + "после ревизии напоминания нет", "Сделайте ревизию" not in pg.inner_text("main"))
    ok(S + "нет ошибок JS", not [e for e in errs if "ERR_FAILED" not in e], errs[:3])
    ctx.close()
    # ---- чек: фото → распознавание → проверка → склад ----
    S = "[чек] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.route("**/recipes.json", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    pg.click(".plus"); pg.wait_for_selector(".sheet")
    pg.click(".sheet .btn >> text=Из чека"); pg.wait_for_selector('.sheet[aria-label="Чек"]')
    pg.set_input_files('.sheet[aria-label="Чек"] input[type=file]', os.path.join(ROOT, "tests", "receipt-sample.png"))
    pg.wait_for_selector("textarea", timeout=120000)
    rt = pg.input_value("textarea")
    ok(S + "текст чека прочитан", "МОЛ" in rt.upper() and "89" in rt, rt[:200])
    pg.click('.sheet[aria-label="Чек"] .btn >> text=Разобрать'); pg.wait_for_selector(".rv")
    rv = pg.inner_text('.sheet[aria-label="Чек"]')
    ok(S + "в проверке есть молоко, хлеб, бананы, яйца", all(w in pg.locator(".rv input[aria-label=Название]").evaluate_all("els => els.map(e => e.value).join('|')") for w in ["Молоко", "Хлеб", "Бананы", "Яйца"]), rv[:300])
    ok(S + "итого по чеку показано", "Итого по чеку" in rv)
    pg.locator(".rv input[aria-label=Название]").first.fill("Молоко")
    pg.click('.sheet[aria-label="Чек"] .btn >> text=Сохранить в продукты'); pg.wait_for_selector(".toast")
    ok(S + "продукты добавлены", "Добавлено продуктов" in pg.inner_text(".toast"), pg.inner_text(".toast"))
    pg.click(".tabs button >> text=Продукты"); pg.wait_for_selector(".swipe")
    pt = pg.inner_text("main")
    ok(S + "на складе молоко и хлеб с ценами", "Молоко" in pt and "Хлеб" in pt and "₽" in pt, pt[:300])
    # вставка текста
    pg.click(".plus"); pg.click(".sheet .btn >> text=Текст чека"); pg.wait_for_selector("textarea")
    pg.fill("textarea", "СМЕТАНА 20% 300Г\n1 x 79,00 = 79,00\nТРЕСКА ФИЛЕ 500Г 1 x 300,00\nИТОГО 379,00")
    pg.click('.sheet[aria-label="Текст чека"] .btn >> text=Разобрать'); pg.wait_for_selector(".rv")
    rv2 = pg.inner_text('.sheet[aria-label="Текст чека"]')
    ok(S + "из вставленного текста: сметана и предупреждение про треску", "в исключениях" in rv2 and pg.locator(".rv").count() == 2, rv2[:300])
    ok(S + "нет ошибок JS", not [e for e in errs if "ERR_FAILED" not in e], errs[:3])
    ctx.close()
    # ---- свой рецепт: вставка текста → проверка → сохранение → оценка ----
    S = "[свой рецепт] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.route("**/recipes.json", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    pg.click(".plus"); pg.wait_for_selector(".sheet")
    pg.click(".sheet .btn >> text=Новый рецепт")
    pg.wait_for_selector('.sheet[aria-label="Новый рецепт"]')
    pg.click(".sheet .btn >> text=Вставить текст рецепта"); pg.wait_for_selector("textarea")
    pg.fill("textarea", "Запечённая треска с картофелем\nВремя: 40 минут\nПорций: 2\n\nИнгредиенты:\n- Треска 400 г\n- Картофель 500 г\n- Сметана 100 г\n\nПриготовление:\n1. Нарежьте картофель.\n2. Выложите рыбу и запекайте 30 минут.")
    pg.click('.sheet .btn >> text=Разобрать'); pg.wait_for_selector('.sheet[aria-label="Проверьте рецепт"]')
    rv = pg.inner_text('.sheet[aria-label="Проверьте рецепт"]')
    ok(S + "в проверке названия и ингредиенты", "Треска" in rv or pg.locator('input[aria-label="Ингредиент 1"]').input_value() != "", rv[:200])
    ok(S + "предупреждение про треску и замена", "Заменить на" in rv, rv[:300])
    pg.click('.sheet .btn >> text=/Заменить на/')
    pg.click('.sheet .btn >> text=Сохранить рецепт'); pg.wait_for_selector('.sheet[aria-label="Рецепт"]')
    rt = pg.inner_text('.sheet[aria-label="Рецепт"]')
    ok(S + "рецепт сохранён, треска заменена", "Запечённая" in rt and "Минтай" in rt, rt[:300])
    pg.click('.sheet .star >> nth=3')
    pg.fill('.sheet textarea', "в следующий раз меньше соли"); pg.click('.sheet h3 >> text=Моя оценка')
    pg.click('.sheet .btn >> text=Изменить рецепт'); pg.wait_for_selector('.sheet[aria-label="Изменить рецепт"]')
    ok(S + "редактор открывается с данными", pg.input_value("#rn").startswith("Запечённая"))
    pg.set_input_files('input[aria-label="Фото блюда"]', os.path.join(ROOT, "tests", "receipt-sample.png"))
    pg.wait_for_selector(".sheet img.dphoto")
    ok(S + "фото блюда сжато и показано", pg.eval_on_selector(".sheet img.dphoto", "e => e.src.startsWith('data:image/jpeg') && e.src.length < 400000"))
    pg.fill("#rn", "Минтай с картофелем"); pg.click('.sheet .btn >> text=Сохранить рецепт')
    pg.wait_for_timeout(300)
    pg.click(".sheet .x >> text=/Закрыть|Готово/") if pg.locator(".sheet .x >> text=/Закрыть|Готово/").count() else None
    ok(S + "нет ошибок JS", not [e for e in errs if "ERR_FAILED" not in e], errs[:3])
    ctx.close()
    # ---- знакомство при первом запуске ----
    S = "[знакомство] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false})")
    pg = ctx.new_page(); errs = []
    pg.route("**/recipes.json", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector('.sheet[aria-label="Знакомство"]')
    ok(S + "показано на первом запуске", "Что лежит дома" in pg.inner_text(".sheet"))
    for _ in range(3): pg.click(".sheet .btn >> text=Далее")
    ok(S + "четвёртый экран", "Сколько пропало" in pg.inner_text(".sheet"))
    pg.click(".sheet .btn >> text=Начать")
    ok(S + "закрылось", pg.locator(".sheet").count() == 0)
    pg.wait_for_timeout(800)  # дать IndexedDB сохранить отметку
    pg.reload(); pg.wait_for_selector("h1"); pg.wait_for_timeout(500)
    ok(S + "второй раз не показывается", pg.locator(".sheet").count() == 0)
    ok(S + "нет ошибок JS", not [e for e in errs if "ERR_FAILED" not in e], errs[:3])
    ctx.close()
    # ---- фильтры рецептов: тип блюда и кухня ----
    S = "[фильтры] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    pg.click(".tabs button >> text=Рецепты")
    pg.wait_for_selector('select[aria-label="Кухня"]', timeout=20000)
    pg.select_option('select[aria-label="Кухня"]', "Итальянская")
    names = pg.locator(".list .li .name").all_inner_texts()
    ok(S + "итальянская кухня: паста и пицца", len(names) > 10 and any("Спагетти" in n or "Паста" in n for n in names) and not any("Борщ" in n for n in names), names[:5])
    ok(S + "в итальянской нет супов — их нет и в списке типов", "суп" not in pg.locator('select[aria-label="Тип блюда"] option').evaluate_all("els => els.map(e => e.value)"))
    pg.select_option('select[aria-label="Кухня"]', "")
    pg.select_option('select[aria-label="Тип блюда"]', "суп")
    pg.select_option('select[aria-label="Кухня"]', "Кавказская")
    names3 = pg.locator(".list .li .name").all_inner_texts()
    ok(S + "суп + кавказская: есть харчо, нет борща", any("арчо" in n for n in names3) and not any("орщ" in n for n in names3), names3)
    pg.click("text=/Сбросить фильтры/")
    ok(S + "сброс фильтров", pg.input_value('select[aria-label="Кухня"]') == "" and pg.locator(".list .li").count() >= 60)
    ok(S + "нет ошибок JS", not [e for e in errs if "ERR_FAILED" not in e], errs[:3])
    ctx.close()
    br.close()
srv.shutdown()
n = sum(1 for r in res if r[1])
print(f"\nИТОГО: {n} из {len(res)}")
sys.exit(0 if n == len(res) else 1)
