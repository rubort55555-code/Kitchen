# Проверка добавления продукта по штрихкоду в браузере: python3 tests/e2e_barcode.py
# Open Food Facts подменяется заготовленными ответами (сеть не нужна). Камера — поддельная,
# показывает нарисованный штрихкод (Chromium умеет брать видео из файла .y4m).
import json, os, sys, tempfile, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PORT = 8124

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"

res = []
def ok(name, cond, extra=""):
    res.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:300]))

# ---------- рисуем штрихкод ----------
L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
R = ["".join("1" if b == "0" else "0" for b in x) for x in L]
PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

def bits(code):
    p = PAR[int(code[0])]
    s = "101" + "".join((L if p[i] == "L" else G)[int(code[i + 1])] for i in range(6)) + "01010"
    s += "".join(R[int(c)] for c in code[7:]) + "101"
    return s

def draw(code, w, h, mw, bar_h, blur=0.0, angle=0):
    img = Image.new("L", (w, h), 235)
    d = ImageDraw.Draw(img)
    b = bits(code)
    x0 = (w - len(b) * mw) // 2
    y0 = (h - bar_h) // 2
    for i, c in enumerate(b):
        if c == "1":
            d.rectangle([x0 + i * mw, y0, x0 + (i + 1) * mw - 1, y0 + bar_h], fill=25)
    if angle:
        img = img.rotate(angle, expand=False, fillcolor=235)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return img

MILK = "4607001771531"   # есть в «базе»
NOPE = "4600000000008"   # нет в базе
PHOTO = "5449000000996"  # на фото
CAM = "4690228007798"    # в камере

tmp = tempfile.mkdtemp()
photo = os.path.join(tmp, "code.jpg")
draw(PHOTO, 1600, 1200, 9, 500, blur=1.2, angle=3).convert("RGB").save(photo, quality=85)

# видео для поддельной камеры: 1280×720, несколько одинаковых кадров
y4m = os.path.join(tmp, "cam.y4m")
frame = draw(CAM, 1280, 720, 7, 260, blur=1.0)
with open(y4m, "wb") as f:
    f.write(b"YUV4MPEG2 W1280 H720 F15:1 Ip A1:1 C420jpeg\n")
    yb = frame.tobytes(); uv = bytes([128]) * (640 * 360)
    for _ in range(10):
        f.write(b"FRAME\n"); f.write(yb); f.write(uv); f.write(uv)

OFF = {
    MILK: {"code": MILK, "status": 1, "status_verbose": "product found", "product": {
        "product_name": "Milk", "product_name_ru": "Молоко пастеризованное 3,2%", "brands": "Простоквашино",
        "quantity": "930 мл", "nutriments": {"energy-kcal_100g": 58, "proteins_100g": 3, "fat_100g": 3.2, "carbohydrates_100g": 4.7}}},
    PHOTO: {"code": PHOTO, "status": 1, "product": {"product_name_ru": "Кефир 2,5%", "brands": "Домик в деревне", "quantity": "1 л",
        "nutriments": {"energy-kcal_100g": 53, "proteins_100g": 3, "fat_100g": 2.5, "carbohydrates_100g": 4}}},
    CAM: {"code": CAM, "status": 1, "product": {"product_name_ru": "Сметана 20%", "brands": "Простоквашино", "quantity": "300 г",
        "nutriments": {"energy-kcal_100g": 204}}},
}
calls = []
online = {"on": True}
def off_route(route):
    url = route.request.url
    code = url.split("/product/")[1].split(".json")[0]
    calls.append(code)
    if not online["on"]:
        return route.abort()
    if code in OFF:
        return route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(OFF[code]))
    return route.fulfill(status=404, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"code": code, "status": 0, "status_verbose": "product not found"}))

def open_add(pg):
    pg.click(".tabs .plus"); pg.wait_for_selector("#pName")

def manual(pg, code):
    pg.click("text=▥ Сканировать штрихкод")
    pg.fill('[aria-label="Цифры штрихкода"]', code)
    pg.click(".scan-manual button")

def unit(pg):
    return pg.inner_text('.seg[aria-label="Единица"] button[aria-pressed="true"]')

def products(pg):
    return pg.evaluate("""() => new Promise((ok) => { const r = indexedDB.open('kitchen'); r.onsuccess = () => { const t = r.result.transaction('products').objectStore('products').getAll(); t.onsuccess = () => ok(t.result); }; })""")

with sync_playwright() as p:
    # обычная поддельная камера (цветная заставка, без штрихкода) — для ручного ввода и фото
    br = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, permissions=["camera"])
    pg = ctx.new_page()
    pg.route("**/recipes.json", lambda r: r.abort())
    pg.route("https://world.openfoodfacts.org/**", off_route)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")

    # 1. цифры вручную → товар найден
    open_add(pg)
    manual(pg, MILK)
    pg.wait_for_selector(".code-card .code-title")
    card = pg.inner_text(".code-card")
    ok("найден товар: название с упаковки", "Молоко пастеризованное 3,2%" in card, card)
    ok("показано КБЖУ на 100 г", "58 ккал" in card and "Б 3" in card and "Ж 3,2" in card, card)
    ok("указан источник Open Food Facts", "Open Food Facts" in card and "ODbL" in card, card)
    ok("название из справочника: Молоко", pg.input_value("#pName") == "Молоко", pg.input_value("#pName"))
    ok("вес упаковки: 930 мл", pg.input_value("#pQty") == "930" and unit(pg) == "мл", (pg.input_value("#pQty"), unit(pg)))
    ok("цену просим вписать", pg.evaluate("document.activeElement.id") == "pPrice", pg.evaluate("document.activeElement.id"))
    pg.fill("#pPrice", "89")
    pg.click("form .btn[type=submit]")
    pg.wait_for_timeout(500)
    ps = products(pg)
    milk = next((x for x in ps if x["name"] == "Молоко"), None)
    ok("продукт добавлен со штрихкодом", milk and milk.get("barcode") == MILK and milk["qty"] == 930 and milk["unit"] == "мл", ps)
    ok("карточка штрихкода убрана после добавления", pg.query_selector(".code-card") is None)

    # 2. тот же код без интернета — узнаём из запомненного
    online["on"] = False
    n0 = len(calls)
    manual(pg, MILK)
    pg.wait_for_selector(".code-card")
    ok("повторный код без сети: название подставлено", pg.input_value("#pName") == "Молоко")
    ok("повторный код: цена прошлой покупки", pg.input_value("#pPrice") == "89", pg.input_value("#pPrice"))
    ok("повторный код: в сеть не ходили", len(calls) == n0, calls)
    ok("повторный код: КБЖУ из памяти", "58 ккал" in pg.inner_text(".code-card"))
    pg.click('[aria-label="Убрать штрихкод"]')
    pg.fill("#pName", ""); pg.fill("#pPrice", "")

    # 3. нет интернета, новый код
    manual(pg, NOPE)
    try:
        pg.wait_for_selector(".code-card", timeout=5000)
    except Exception:
        pg.screenshot(path="/tmp/claude-0/-home-claude/bc837202-9ac9-5713-9ea7-61764190d27c/scratchpad/s3.png"); print(pg.inner_text(".sheet")[:600]); print(errs); raise
    ok("нет сети: понятное сообщение", "Нет интернета" in pg.inner_text(".code-card") or "Не получилось связаться" in pg.inner_text(".code-card"), pg.inner_text(".code-card"))
    online["on"] = True
    pg.click('[aria-label="Убрать штрихкод"]')

    # 4. товара нет в базе → пишем название сами → код запоминается
    manual(pg, NOPE)
    pg.wait_for_function("document.querySelector('.code-card') && document.querySelector('.code-card').innerText.includes('нет в базе')")
    ok("нет в базе: подсказка написать название", "нет в базе" in pg.inner_text(".code-card"))
    ok("нет в базе: ссылка добавить в OFF", pg.query_selector('.code-card a[href*="openfoodfacts.org/product/' + NOPE + '"]') is not None)
    ok("нет в базе: фокус на названии", pg.evaluate("document.activeElement.id") == "pName", pg.evaluate("document.activeElement.outerHTML.slice(0,120)"))
    pg.fill("#pName", "Квас Очаковский"); pg.fill("#pQty", "2"); pg.click('.seg[aria-label="Единица"] button:text-is("л")'); pg.fill("#pPrice", "120")
    pg.click("form .btn[type=submit]"); pg.wait_for_timeout(400)
    online["on"] = False
    manual(pg, NOPE)
    pg.wait_for_selector(".code-card")
    ok("своё название запомнилось по коду", pg.input_value("#pName") == "Квас Очаковский", pg.input_value("#pName"))
    ok("и количество из прошлой покупки", pg.input_value("#pQty") == "2", pg.input_value("#pQty"))
    online["on"] = True
    pg.click('[aria-label="Убрать штрихкод"]'); pg.fill("#pName", ""); pg.fill("#pPrice", "")

    # 5. неверные цифры
    pg.click("text=▥ Сканировать штрихкод")
    pg.fill('[aria-label="Цифры штрихкода"]', "4607001771532")
    pg.click(".scan-manual button")
    ok("неверная контрольная цифра — подсказка", "Проверьте цифры" in pg.inner_text(".scan"))
    pg.click('.scan button:has-text("Отмена")')

    # 6. фото кода
    pg.click("text=▥ Сканировать штрихкод")
    pg.set_input_files('.scan input[type=file]', photo)
    pg.wait_for_selector(".code-card .code-title", timeout=15000)
    ok("фото: код распознан и товар найден", "Кефир" in pg.inner_text(".code-card"), pg.inner_text(".code-card"))
    ok("фото: название Кефир, 1 л", pg.input_value("#pName") == "Кефир" and pg.input_value("#pQty") == "1" and unit(pg) == "л", (pg.input_value("#pName"), pg.input_value("#pQty")))
    pg.click('[aria-label="Убрать штрихкод"]'); pg.fill("#pName", "")

    ok("нет ошибок на странице", not errs, errs)
    br.close()

    # 7. живая камера (поддельная, показывает штрихкод)
    br = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", f"--use-file-for-fake-video-capture={y4m}"])
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, permissions=["camera"])
    pg = ctx.new_page()
    pg.route("**/recipes.json", lambda r: r.abort())
    pg.route("https://world.openfoodfacts.org/**", off_route)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1")
    open_add(pg)
    pg.click("text=▥ Сканировать штрихкод")
    try:
        pg.wait_for_selector(".code-card .code-title", timeout=15000)
        cam_ok = True
    except Exception:
        cam_ok = False
    ok("камера: код распознан сам", cam_ok and "Сметана" in pg.inner_text(".code-card"), pg.inner_text(".sheet")[:200])
    ok("камера: название Сметана, 300 г", pg.input_value("#pName") == "Сметана" and pg.input_value("#pQty") == "300" and unit(pg) == "г", (pg.input_value("#pName"), pg.input_value("#pQty")))
    ok("камера выключена после распознавания", pg.query_selector(".scan video") is None)
    pg.screenshot(path=os.path.join(ROOT, "tests", "barcode-found.png"))
    ok("нет ошибок на странице (камера)", not errs, errs)
    br.close()

    # тёмная тема: внешний вид сканера (камера поддельная)
    br = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, permissions=["camera"], color_scheme="dark")
    pg = ctx.new_page(); pg.route("**/recipes.json", lambda r: r.abort())
    pg.goto(URL); pg.wait_for_selector("h1"); open_add(pg); pg.click("text=▥ Сканировать штрихкод")
    pg.wait_for_selector(".scan video"); pg.wait_for_timeout(800)
    ok("нет горизонтальной прокрутки со сканером", pg.evaluate("document.querySelector('.sheet-b').scrollWidth <= document.querySelector('.sheet-b').clientWidth + 1"))
    pg.screenshot(path=os.path.join(ROOT, "tests", "barcode-scan-dark.png"))
    br.close()

srv.shutdown()
bad = [n for n, c in res if not c]
print(f"\nШтрихкод: {len(res) - len(bad)} из {len(res)}")
sys.exit(1 if bad else 0)
