# Проверка дневника питания в браузере: python3 tests/e2e_diary.py
import os, sys, json, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8127
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=os.path.join(ROOT, "dist")))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"

res = []
def ok(name, cond, extra=""):
    res.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:400]))

M = '.sheet[aria-label="Что вы съели"]'  # окно записи еды (поверх дневника)
D = '.sheet[aria-label="Дневник питания"]'
SEED = """(settings) => new Promise((res, rej) => {
  const r = indexedDB.open('kitchen');
  r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(settings, 'settings'); tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); };
  r.onerror = () => rej(r.error);
})"""
SETTINGS = {
    "members": [
        {"id": "m1", "name": "Аня", "allergies": [], "dislikes": [], "body": {"sex": "f", "born": 1991, "height": 165, "weight": 62, "goal": "keep"}},
        {"id": "m2", "name": "Миша", "allergies": [], "dislikes": [], "body": {"sex": "m", "born": 1988, "height": 180, "weight": 80, "goal": "keep"}},
    ],
    "tipsSeen": ["intro", "home-gear"], "lastBackup": 1999999999999,
}

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    for scheme in ["light", "dark"]:
        ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme=scheme)
        pg = ctx.new_page()
        # Open Food Facts в тесте: любой код — «товара нет» (проверка ручного ввода с этикетки); после запоминания интернет не нужен
        off_calls = []
        def off_route(route):
            off_calls.append(route.request.url)
            route.fulfill(status=404, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"code": "x", "status": 0, "status_verbose": "product not found"}))
        pg.route("https://world.openfoodfacts.org/**", off_route)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("h1")
        pg.evaluate(SEED, SETTINGS)
        pg.reload(); pg.wait_for_selector("h1")
        S = f"[{scheme}] "
        ok(S + "главная: карточка «Сегодня съедено»", pg.query_selector(".today") is not None and "Сегодня съедено" in pg.inner_text(".today"))
        ok(S + "карточка: есть норма «из N ккал»", "из " in pg.inner_text(".today .hero"), pg.inner_text(".today .hero"))
        ok(S + "карточка: пока 0 съедено, остаток = норма", pg.inner_text(".today .hero b").strip() == "0" and "Осталось" in pg.inner_text(".today"))

        # Быстрая запись: рецепт
        pg.click(".today .btn:has-text('Записать еду')"); pg.wait_for_selector("text=Что вы съели")
        pg.click(M + ' .chip:has-text("Рецепт")')
        pg.fill('[aria-label="Поиск рецепта"]', "Омлет классический")
        pg.click(M + ' .li:has-text("Омлет классический")')
        ok(S + "рецепт: показана ценность на порцию", "на порцию ≈" in pg.inner_text(M), pg.inner_text(M)[:200])
        pg.click(M + ' button[aria-label="Больше"]')
        ok(S + "порции: 1,5", "1,5 порции" in pg.inner_text(M))
        pg.click(M + ' .btn:has-text("Записать")')
        pg.wait_for_selector(".toast")
        ok(S + "после записи сообщение с калориями", "Записано: Омлет классический" in pg.inner_text(".toast") and "ккал" in pg.inner_text(".toast"), pg.inner_text(".toast"))
        pg.wait_for_selector(".sheet", state="detached")
        kc = int(pg.inner_text(".today .hero b").replace("\xa0", "").replace(" ", ""))
        ok(S + "карточка: калории выросли", kc > 100, kc)

        # Дневник
        pg.click(".today .link:has-text('Дневник')"); pg.wait_for_selector("text=Дневник питания")
        sh = pg.inner_text(D)
        ok(S + "дневник: запись в списке с калориями", "Омлет классический" in sh and "1,5 порции" in sh and any(x in sh for x in ["Завтрак", "Обед", "Ужин", "Перекус"]), sh[:400])
        ok(S + "дневник: два человека", pg.query_selector(D + ' .chip:has-text("Аня")') is not None and pg.query_selector(D + ' .chip:has-text("Миша")') is not None)
        ok(S + "дневник: заголовок «Сегодня»", "Сегодня" in sh)
        # витамины и минералы
        ok(S + "витамины: блок есть, показано, чего меньше всего", "Витамины и минералы" in pg.inner_text(D) and "Меньше всего пока:" in pg.inner_text(D), pg.inner_text(D)[:600])
        ok(S + "витамины: список открыт сразу, полоски заполнения у каждого", len(pg.query_selector_all(D + ' .mrow[role=progressbar]')) >= 20, len(pg.query_selector_all(D + ' .mrow')))
        w = pg.evaluate("Array.from(document.querySelectorAll('.mrow .dbar i')).map(i => parseFloat(i.style.width))")
        ok(S + "витамины: полоски частично заполнены (от 0 до 100%)", any(0 < x < 100 for x in w) and all(0 <= x <= 100 for x in w), w[:10])
        mt = pg.inner_text(D)
        ok(S + "витамины: перечень витаминов и минералов с % нормы", all(w in mt for w in ["Витамин C", "Витамин B12", "Кальций", "Железо", "Магний"]) and "%" in mt, mt[:500])
        ok(S + "витамины: сказано, что не учитывается", "Не учитываются" in mt and "хром" in mt)
        pg.click(D + ' .link:has-text("Свернуть список")')
        ok(S + "витамины: список сворачивается", len(pg.query_selector_all(D + ' .mrow')) == 0)
        # железо: оценка приёма пищи (в омлете есть железо; формулировка про усвоение)
        ok(S + "железо: строка оценки приёма пищи", "🩸" in pg.inner_text(D) and "железа" in pg.inner_text(D) and ("усвоени" in pg.inner_text(D)), pg.inner_text(D)[:700])
        # вода
        pg.click(D + ' .chip:has-text("+ стакан")'); pg.click(D + ' .chip:has-text("+ стакан")')
        ok(S + "вода: 500 мл", "500 мл" in pg.inner_text(D + ' .wrow'), pg.inner_text(D + ' .wrow'))
        # своё блюдо
        pg.click(D + ' .btn:has-text("Записать приём пищи")'); pg.wait_for_selector("text=Что вы съели")
        pg.click(M + ' .chip:has-text("Своё")')
        ok(S + "«Своё»: кнопка выключена без данных", pg.is_disabled(M + ' .btn:has-text("Записать")'))
        pg.fill("#on", "Обед в кафе"); pg.fill("#ok", "650"); pg.fill("#op", "30")
        pg.click(M + ' .btn:has-text("Записать")'); pg.wait_for_selector(".toast")
        pg.wait_for_function("document.querySelectorAll('.sheet').length === 1")
        sh = pg.inner_text(D)
        ok(S + "своё блюдо в дневнике", "Обед в кафе" in sh and "650" in sh, sh[:300])
        # недавнее
        pg.click(D + ' .btn:has-text("Записать приём пищи")'); pg.wait_for_selector("text=Что вы съели")
        ok(S + "«Недавнее» открыто по умолчанию и содержит прошлые блюда", "Обед в кафе" in pg.inner_text(M) and "Омлет классический" in pg.inner_text(M))
        pg.click(M + ' .li:has-text("Омлет классический")'); pg.wait_for_selector(".toast")
        pg.wait_for_function("document.querySelectorAll('.sheet').length === 1")
        ok(S + "повтор из «Недавнего»: омлет теперь дважды", pg.inner_text(D).count("Омлет классический") == 2)
        # продукт из справочника
        pg.click(D + ' .btn:has-text("Записать приём пищи")'); pg.wait_for_selector("text=Что вы съели")
        pg.click(M + ' .chip:has-text("Продукт")')
        pg.fill('[aria-label="Поиск продукта"]', "ябл")
        pg.click(M + ' .li:has-text("Яблок")')
        pg.fill("#pg", "200")
        ok(S + "продукт: считает ккал на вес", "ккал" in pg.inner_text(M))
        pg.click(M + ' .btn:has-text("Записать")'); pg.wait_for_selector(".toast")
        pg.wait_for_function("document.querySelectorAll('.sheet').length === 1")
        ok(S + "продукт в дневнике", "Яблок" in pg.inner_text(D))
        # штрихкод: товара нет в базе → данные с этикетки → запомнили → второй раз находится без интернета
        pg.click(D + ' .btn:has-text("Записать приём пищи")'); pg.wait_for_selector("text=Что вы съели")
        pg.click(M + ' .chip:has-text("Штрихкод")')
        pg.click(M + ' .btn:has-text("Сканировать штрихкод")')
        pg.fill('[aria-label="Цифры штрихкода"]', "4607001771531"); pg.click(".scan-manual button")
        pg.wait_for_selector("#mn")
        ok(S + "штрихкод: товара нет в базе — предложено ввести данные с этикетки", "Введите данные с этикетки" in pg.inner_text(M) or "нет в Open Food Facts" in pg.inner_text(M), pg.inner_text(M)[:300])
        pg.fill("#mn", "Творог 5% Простоквашино"); pg.fill("#mk", "121"); pg.fill("#mp", "17"); pg.fill("#mf", "5"); pg.fill("#mc", "1.8")
        pg.click(M + ' .btn:has-text("Запомнить товар")'); pg.wait_for_selector("#sg")
        ok(S + "после ввода: показан товар из «вашей памяти»", "Из вашей памяти" in pg.inner_text(M) and "121" in pg.inner_text(M), pg.inner_text(M)[:300])
        pg.fill("#sg", "200")
        ok(S + "оценка микроэлементов по справочнику помечена", "оценены по справочнику" in pg.inner_text(M), pg.inner_text(M)[:400])
        pg.click(M + ' .btn:has-text("Записать")'); pg.wait_for_selector(".toast")
        pg.wait_for_function("document.querySelectorAll('.sheet').length === 1")
        ok(S + "товар по штрихкоду записан (242 ккал на 200 г)", "Творог 5% Простоквашино" in pg.inner_text(D) and "242" in pg.inner_text(D), pg.inner_text(D)[:500])
        calls_before = len(off_calls)
        pg.click(D + ' .btn:has-text("Записать приём пищи")'); pg.wait_for_selector("text=Что вы съели")
        pg.click(M + ' .chip:has-text("Штрихкод")'); pg.click(M + ' .btn:has-text("Сканировать штрихкод")')
        pg.fill('[aria-label="Цифры штрихкода"]', "4607001771531"); pg.click(".scan-manual button")
        pg.wait_for_selector("#sg")
        ok(S + "второй скан того же кода: найден в памяти, запрос в интернет не отправлялся", len(off_calls) == calls_before and "Из вашей памяти" in pg.inner_text(M), (calls_before, len(off_calls)))
        pg.click(M + ' .btn:has-text("Другой товар")'); pg.click(M + ' .x:has-text("Готово")')
        # напиток с кофеином и подсказки о сочетаниях
        pg.click(D + ' .btn:has-text("Записать приём пищи")'); pg.wait_for_selector("text=Что вы съели")
        pg.click(M + ' .chip:has-text("Напиток")')
        pg.click(M + ' .li:has-text("Кофе заварной")')
        for _ in range(4): pg.click(M + ' button[aria-label="Больше"]')
        ok(S + "напиток: 3 порции кофе — 285 мг кофеина", "285 мг" in pg.inner_text(M), pg.inner_text(M)[:300])
        pg.click(M + ' .btn:has-text("Записать")'); pg.wait_for_selector(".toast")
        pg.wait_for_function("document.querySelectorAll('.sheet').length === 1")
        sh = pg.inner_text(D)
        ok(S + "кофеин в дневнике: 285 мг из 400", "Кофеин: 285 мг из 400 мг" in sh.replace("\n", " "), sh[:900])
        ok(S + "подсказка: больше 200 мг за раз", "больше 200 мг за раз" in sh, sh[:900])
        pg.click(D + ' .hint summary >> nth=0')
        ok(S + "подсказка раскрывается и показывает источник EFSA", "EFSA" in pg.inner_text(D))
        pg.click(D + ' button[aria-label^="Удалить Кофе заварной"]')
        ok(S + "после удаления кофе блок кофеина исчезает", "Кофеин:" not in pg.inner_text(D))
        # удаление и отмена
        n0 = len(pg.query_selector_all(D + ' .li'))
        pg.click(D + ' button[aria-label^="Удалить Яблок"]')
        ok(S + "удаление: записей на одну меньше", len(pg.query_selector_all(D + ' .li')) == n0 - 1)
        pg.click(".toast button:has-text('Отменить')")
        ok(S + "отмена удаления возвращает запись", len(pg.query_selector_all(D + ' .li')) == n0)
        # вчера и «Повторить вчера»
        pg.click(D + ' button[aria-label="Предыдущий день"]')
        ok(S + "вчера: пусто и заголовок «Вчера»", "Вчера" in pg.inner_text(D + ' .dnav') and "ничего не записано" in pg.inner_text(D))
        pg.click(D + ' button[aria-label="Следующий день"]')
        ok(S + "сегодня: «›» выключена", pg.is_disabled(D + ' button[aria-label="Следующий день"]'))
        # переключение на Мишу: у него дневник пуст
        pg.click(D + ' .chip:has-text("Миша")')
        ok(S + "другой человек: у Миши записей пока нет", "Омлет классический" not in pg.inner_text(D) and "ничего не записано" in pg.inner_text(D), pg.inner_text(D)[:300])
        pg.screenshot(path=os.path.join(ROOT, "tests", f"{scheme}-diary.png"))
        pg.click(D + ' .chip:has-text("Аня")')
        pg.click(D + " .x:has-text('Готово')")
        ok(S + "после закрытия на карточке видны съеденные калории", int(pg.inner_text(".today .hero b").replace("\xa0", "").replace(" ", "")) > kc)
        # данные сохраняются после перезагрузки
        pg.reload(); pg.wait_for_selector(".today")
        ok(S + "после перезагрузки записи сохранены", int(pg.inner_text(".today .hero b").replace("\xa0", "").replace(" ", "")) > kc)
        ok(S + "без ошибок в консоли страницы", not errs, errs)
        ctx.close()
    br.close()

fails = [n for n, c in res if not c]
print(f"\nдневник (браузер): {len(res) - len(fails)} из {len(res)}")
sys.exit(1 if fails else 0)
