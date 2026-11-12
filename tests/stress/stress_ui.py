# Стресс-тест приложения в браузере (телефонный экран): python3 tests/stress/stress_ui.py
# Нужна сборка: npm run build. Результат — tests/stress/result.json и строки PASS/FAIL/INFO.
import json, os, random, sys, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tests", "stress")
PORT = 8177
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=os.path.join(ROOT, "dist")))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"
CHROME = os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium")

R = []
def rec(kind, name, cond=True, extra=""):
    st = "INFO" if kind == "info" else ("PASS" if cond else "FAIL")
    R.append({"section": SECTION[0], "status": st, "name": name, "extra": str(extra)[:1500]})
    print(f"{st} [{SECTION[0]}] {name}" + (f" | {str(extra)[:400]}" if extra and (st != "PASS") else ""), flush=True)
SECTION = ["-"]
BIG_BACKUP = None

V = "2026-11-10"
BASE_SETTINGS = {"tipsSeen": ["intro", "home-gear", "menu"], "lastBackup": 1999999999999, "seenNews": "2099-01-01", "overdueAsked": time.strftime("%Y-%m-%d"),
                 "consent": {k: {"version": V, "at": 1} for k in ("policy", "health", "off")}}

IDB = """
window.__idb = (fn) => new Promise((res, rej) => { const r = indexedDB.open('kitchen'); r.onsuccess = () => { try { fn(r.result, res, rej); } catch (e) { rej(e); } }; r.onerror = () => rej(r.error); });
"""
PATCH_SETTINGS = """(patch) => new Promise((res, rej) => { const r = indexedDB.open('kitchen'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); const os = tx.objectStore('kv'); const g = os.get('settings'); g.onsuccess = () => { os.put(Object.assign(g.result || {}, patch), 'settings'); }; tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }; })"""
COUNT = """(store) => new Promise((res) => { const r = indexedDB.open('kitchen'); r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).count(); q.onsuccess = () => { db.close(); res(q.result); }; }; })"""
GET_ALL = """(store) => new Promise((res) => { const r = indexedDB.open('kitchen'); r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { db.close(); res(q.result); }; }; })"""
GET_SETTINGS = """() => new Promise((res) => { const r = indexedDB.open('kitchen'); r.onsuccess = () => { const db = r.result; const q = db.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => { db.close(); res(q.result); }; }; })"""
# Большой объём данных: генерируется прямо в браузере
SEED_BIG = """async ({nProducts, nLog, nMeals, nPlan, nShop}) => {
  const names = ['Молоко','Хлеб','Яйца','Куриное филе','Помидоры','Огурцы','Творог','Сыр твёрдый','Картофель','Бананы','Минтай','Сметана','Гречка','Рис','Морковь','Лук репчатый','Яблоки','Кефир','Масло сливочное','Говядина'];
  const units = {'Молоко':'л','Хлеб':'шт','Яйца':'шт','Куриное филе':'г','Помидоры':'кг','Огурцы':'кг','Творог':'г','Сыр твёрдый':'г','Картофель':'кг','Бананы':'кг','Минтай':'г','Сметана':'г','Гречка':'г','Рис':'г','Морковь':'кг','Лук репчатый':'кг','Яблоки':'кг','Кефир':'л','Масло сливочное':'г','Говядина':'г'};
  const places = ['Холодильник','Морозилка','Шкаф']; const reasons = ['bought','eaten','cooked','spoiled','thrown','adjust'];
  const day = 86400000, now = Date.now(); let s = 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const ymd = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
  const products = [], log = [], meals = [];
  for (let i = 0; i < nProducts; i++) { const n = names[i % names.length]; products.push({ id: 'sp' + i, name: n + (i >= names.length ? ' ' + i : ''), qty: 1 + Math.floor(rnd()*5), initialQty: 5, unit: units[n], place: places[i % 3], bought: ymd(now - rnd()*30*day), until: rnd() < 0.1 ? null : ymd(now + (rnd()*40 - 10)*day), price: Math.round(50 + rnd()*500), opened: null, createdAt: now - i }); }
  for (let i = 0; i < nLog; i++) { const n = names[i % names.length]; log.push({ id: 'sl' + i, t: now - Math.floor(rnd()*730*day), name: n, reason: reasons[Math.floor(rnd()*6)], qty: 1 + Math.floor(rnd()*3), unit: units[n], rub: Math.round(rnd()*400) }); }
  log.sort((a,b) => a.t - b.t);
  const slots = ['завтрак','обед','ужин','перекус'];
  for (let i = 0; i < nMeals; i++) { const t = now - Math.floor(rnd()*365*day); meals.push({ id: 'sm' + i, date: ymd(t), t, slot: slots[i % 4], name: names[i % names.length], qty: '150 г', n: { kcal: 100 + rnd()*500, protein: rnd()*30, fat: rnd()*20, carbs: rnd()*60, fiber: rnd()*5, na: rnd()*500 } }); }
  const plan = []; for (let i = 0; i < nPlan; i++) plan.push({ id: 'spl' + i, date: ymd(now + (i % 120 - 60) * day), slot: slots[i % 4], name: 'Блюдо ' + i });
  const shop = []; for (let i = 0; i < nShop; i++) shop.push({ id: 'ss' + i, name: names[i % names.length] + ' ' + i, amount: '1 шт', done: i % 3 === 0, createdAt: now - i });
  await new Promise((res, rej) => { const r = indexedDB.open('kitchen'); r.onsuccess = () => { const db = r.result; const tx = db.transaction(['products','log','meals','kv'], 'readwrite');
    products.forEach((p) => tx.objectStore('products').put(p)); log.forEach((p) => tx.objectStore('log').put(p)); meals.forEach((p) => tx.objectStore('meals').put(p));
    const kv = tx.objectStore('kv'); const g = kv.get('settings'); g.onsuccess = () => { const st = g.result || {}; st.plan = plan; st.shop = shop; kv.put(st, 'settings'); };
    tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; });
  return { products: products.length, log: log.length, meals: meals.length };
}"""
# Время отрисовки после нажатия (React обрабатывает нажатие синхронно) + два кадра
TIMED_CLICK = """async (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return -1; const t = performance.now(); el.click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; }"""
TIMED_CLICK_TEXT = """async ([sel, text]) => { const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text)); if (!el) return -1; const t = performance.now(); el.click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; }"""
LONGTASKS = """() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {} }"""
BAD_TEXT = """() => { const t = document.body.innerText; const out = []; for (const w of ['NaN', 'undefined', 'Infinity', '[object Object]', 'null ₽', 'Invalid Date']) { const i = t.indexOf(w); if (i >= 0) out.push(w + ': …' + t.slice(Math.max(0, i - 60), i + 40).replace(/\\n/g, ' ') + '…'); } return out; }"""

def new_page(br, errs, **kw):
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                         permissions=["clipboard-read", "clipboard-write"], accept_downloads=True, **kw)
    pg = ctx.new_page()
    pg.route("**/recipes.json", lambda r: r.continue_())
    pg.route(lambda u: not u.startswith(URL) and not u.startswith("data:") and not u.startswith("blob:"), lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console.error: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "Failed to load resource" not in m.text else None)
    pg.on("dialog", lambda d: d.accept())
    return ctx, pg

def boot(pg, settings=BASE_SETTINGS):
    pg.goto(URL); pg.wait_for_selector("h1")
    pg.wait_for_timeout(1500)  # базовые рецепты записываются
    pg.evaluate(PATCH_SETTINGS, settings); pg.reload(); pg.wait_for_selector("h1"); pg.wait_for_timeout(500)

def more(pg):
    tab(pg, "Главная"); pg.click('[aria-label="Ещё: семья, ограничения, данные"]')

def close_sheets(pg):
    for _ in range(8):
        n = pg.evaluate("() => { const h = [...document.querySelectorAll('.sheet-h')]; if (!h.length) return 0; const last = h[h.length - 1]; const b = last.querySelector('.x:not(.l)') || last.querySelector('button:last-child'); if (b) b.click(); else document.querySelector('.overlay:last-of-type')?.click(); return h.length; }")
        if not n: break
        pg.wait_for_timeout(80)

def tab(pg, name):
    close_sheets(pg)
    pg.evaluate("t => document.querySelector(`.tabs button[aria-label=${t}]`).click()", name); pg.wait_for_timeout(120)

def crashed(pg):
    try: t = pg.inner_text("body", timeout=3000)
    except Exception: return "страница не отвечает"
    if "Приложение не открылось" in t: return "запасной экран «Приложение не открылось»"
    if len(t.strip()) < 5: return "белый экран"
    return None

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME, args=["--enable-precise-memory-info", "--js-flags=--expose-gc"])

    # ======================= 1. Большой объём данных =======================
    SECTION[0] = "объём"
    errs = []
    ctx, pg = new_page(br, errs)
    boot(pg)
    sizes = {"nProducts": int(os.environ.get("NP", 1000)), "nLog": int(os.environ.get("NL", 20000)), "nMeals": int(os.environ.get("NM", 15000)), "nPlan": 1500, "nShop": 60}
    t0 = time.time(); got = pg.evaluate(SEED_BIG, sizes); rec("info", f"записано в базу: {got} за {time.time()-t0:.1f} с")
    pg.add_init_script(LONGTASKS)
    t0 = time.time(); pg.reload(); pg.wait_for_selector("h1", timeout=60000); load = time.time() - t0
    rec("check", f"запуск с большой базой ({sizes}): {load:.1f} с", load < 5, f"{load:.1f} с")
    pg.wait_for_timeout(1500)
    lt = pg.evaluate("window.__lt || []")
    rec("check", f"долгие задачи главного потока при запуске: max {max(lt) if lt else 0} мс, всего {sum(lt)} мс", (max(lt) if lt else 0) < 1000, lt[:20])
    mem = pg.evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize/1e6) : -1")
    rec("info", f"память JS после запуска: {mem} МБ")
    timings = {}
    for tn in ["Продукты", "Рецепты", "Покупки", "Главная"]:
        ms = pg.evaluate(TIMED_CLICK, f".tabs button[aria-label={tn}]"); timings[tn] = round(ms)
        rec("check", f"вкладка «{tn}» открывается: {ms:.0f} мс", ms < 1500, f"{ms:.0f} мс")
        c = crashed(pg); rec("check", f"вкладка «{tn}» без сбоя", not c, c)
    # Набор в поле «Что купить» при 60 позициях списка и 100 000 записей журнала
    tab(pg, 'Покупки')
    t0 = time.time(); pg.type('[aria-label="Что купить"]', "мол", delay=0); dt = (time.time() - t0) * 1000
    rec("check", f"«Покупки» (60 позиций, журнал {sizes['nLog']}): набор 3 букв в «Что купить» — {dt:.0f} мс", dt < 1500, f"{dt:.0f} мс")
    pg.fill('[aria-label="Что купить"]', "")
    # Поиск по продуктам — набор по буквам
    tab(pg, 'Продукты')
    search = pg.query_selector("main input")
    if search:
        t0 = time.time(); search.type("молоко", delay=0); dt = (time.time() - t0) * 1000
        rec("check", f"набор «молоко» в поиске продуктов ({sizes['nProducts']} шт): {dt:.0f} мс на 6 букв", dt < 3000, f"{dt:.0f} мс")
        search.fill("")
    nrows = pg.locator(".swipe").count()
    rec("info", f"строк в списке продуктов на экране: {nrows} (нет постраничной подгрузки — все строки в DOM)" if nrows > 500 else f"строк в списке продуктов: {nrows}")
    dom = pg.evaluate("document.getElementsByTagName('*').length"); rec("info", f"элементов на странице продуктов: {dom}")
    # Прокрутка списка
    t0 = time.time()
    for _ in range(20): pg.mouse.wheel(0, 3000)
    pg.wait_for_timeout(100); rec("info", f"прокрутка списка 20 рывков: {(time.time()-t0)*1000:.0f} мс")
    # Страницы «Ещё»
    for title in ["Статистика", "Питание", "Семья", "Ограничения в питании", "Справочник продуктов", "Конфиденциальность", "Оформление", "Данные и копия", "Помощь", "Пробные функции", "О приложении"]:
        more(pg)
        ms = pg.evaluate(TIMED_CLICK_TEXT, [".li", title])
        c = crashed(pg)
        rec("check", f"«Ещё → {title}»: {ms:.0f} мс", ms >= 0 and ms < 2000 and not c, c or f"{ms:.0f} мс")
        if title == "Статистика":
            for per in ["Неделя", "Месяц", "Год"]:
                ms2 = pg.evaluate(TIMED_CLICK_TEXT, ["button", per])
                if ms2 >= 0: rec("check", f"статистика за «{per}» (журнал {sizes['nLog']}): {ms2:.0f} мс", ms2 < 2000, f"{ms2:.0f} мс")
        if title == "Данные и копия":
            t0 = time.time()
            try:
                with pg.expect_download(timeout=30000) as dl:
                    pg.click("text=Сохранить копию")
                path = dl.value.path(); size = os.path.getsize(path)
                rec("check", f"сохранение копии большой базы: {time.time()-t0:.1f} с, {size/1e6:.1f} МБ", time.time() - t0 < 10, size)
                BIG_BACKUP = open(path, encoding="utf-8").read()
            except Exception as e:
                rec("check", "сохранение копии большой базы", False, e); BIG_BACKUP = None
        c = crashed(pg)
        if c: pg.reload(); pg.wait_for_selector("h1")
    # Дневник питания и меню
    tab(pg, 'Главная')
    for label in ["Сегодня съедено", "Меню"]:
        ms = pg.evaluate(TIMED_CLICK_TEXT, ["main button, main .card, main a", label])
        c = crashed(pg)
        if ms >= 0: rec("check", f"главная → «{label}»: {ms:.0f} мс", ms < 2000 and not c, c or f"{ms:.0f} мс")
        close_sheets(pg)
    bad = pg.evaluate(BAD_TEXT); rec("check", "нет «NaN/undefined/[object Object]» в тексте на большой базе", not bad, bad)
    mem = pg.evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize/1e6) : -1"); rec("info", f"память JS после обхода экранов: {mem} МБ")
    rec("check", "без ошибок страницы на большой базе", not errs, errs[:8])
    ctx.close()

    # ======================= 2. Быстрые повторные действия =======================
    SECTION[0] = "скорость нажатий"
    errs = []
    ctx, pg = new_page(br, errs)
    boot(pg)
    # 200 продуктов подряд через форму без пауз
    close_sheets(pg); pg.click(".tabs .plus"); pg.wait_for_selector("#pName")
    t0 = time.time()
    for i in range(200):
        pg.fill("#pName", f"Продукт {i}"); pg.fill("#pQty", "1"); pg.fill("#pPrice", "10")
        pg.click(".sheet button[type=submit]")
    dt = time.time() - t0
    pg.wait_for_timeout(1500)
    n = pg.evaluate(COUNT, "products")
    rec("check", f"200 добавлений подряд: сохранено {n} из 200 за {dt:.1f} с", n == 200, n)
    # двойное/тройное нажатие «Добавить»
    pg.fill("#pName", "Двойной клик"); pg.fill("#pQty", "1"); pg.fill("#pPrice", "10")
    pg.dblclick(".sheet button[type=submit]"); pg.wait_for_timeout(500)
    ps = pg.evaluate(GET_ALL, "products"); dup = sum(1 for x in ps if x["name"] == "Двойной клик")
    rec("check", f"двойное нажатие «Добавить» не создаёт дубль (создано {dup})", dup == 1, dup)
    pg.evaluate("() => { const b = document.querySelector('.sheet button[type=submit]'); document.querySelector('#pName'); }")
    close_sheets(pg)
    # 300 переключений вкладок
    t0 = time.time()
    tabs = ["Главная", "Продукты", "Рецепты", "Покупки"]
    for i in range(300): pg.evaluate("(t) => document.querySelector(`.tabs button[aria-label=${t}]`).click()", tabs[i % 4])
    pg.wait_for_timeout(300)
    rec("check", f"300 переключений вкладок: {time.time()-t0:.1f} с, без сбоя", not crashed(pg), crashed(pg))
    # открыть/закрыть окно 150 раз — утечки памяти и элементов
    tab(pg, 'Главная')
    pg.evaluate("() => window.gc && gc()")
    m0 = pg.evaluate("performance.memory.usedJSHeapSize"); d0 = pg.evaluate("document.getElementsByTagName('*').length")
    for i in range(150):
        pg.evaluate("() => document.querySelector('.tabs .plus').click()")
        pg.evaluate("() => { const b = document.querySelector('.sheet-h .x'); b && b.click(); }")
    pg.wait_for_timeout(500); pg.evaluate("() => window.gc && gc()"); pg.wait_for_timeout(300)
    m1 = pg.evaluate("performance.memory.usedJSHeapSize"); d1 = pg.evaluate("document.getElementsByTagName('*').length")
    rec("check", f"150 раз открыть/закрыть окно: память {m0/1e6:.1f}→{m1/1e6:.1f} МБ, элементов {d0}→{d1}", (m1 - m0) < 15e6 and d1 <= d0 + 50, (m0, m1, d0, d1))
    ov = pg.evaluate("document.body.style.overflow"); rec("check", "после закрытия окон прокрутка страницы не заблокирована", ov != "hidden", ov)
    # Наслоение окон: открыть «+», затем «Из чека», «Новый рецепт»... быстро
    close_sheets(pg); pg.click(".tabs .plus"); pg.click("text=📷 Из чека"); pg.wait_for_timeout(200)
    nsh = pg.locator(".sheet").count(); rec("info", f"окон поверх друг друга после «+ → Из чека»: {nsh}")
    close_sheets(pg)
    rec("check", "без ошибок страницы при быстрых действиях", not errs, errs[:8])
    ctx.close()

    # ======================= 3. Ввод: граничные значения =======================
    SECTION[0] = "ввод"
    errs = []
    ctx, pg = new_page(br, errs)
    boot(pg)
    close_sheets(pg); pg.click(".tabs .plus"); pg.wait_for_selector("#pName")
    cases = [
        ("имя 10 000 символов", "Я" * 10000, "1", "10"),
        ("эмодзи и спецсимволы", "🍕<b>x</b>'\"; DROP TABLE", "1", "10"),
        ("отрицательное количество", "Тест-отр", "-5", "10"),
        ("количество 0", "Тест-ноль", "0", "10"),
        ("количество 1e309", "Тест-беск", "1e309", "10"),
        ("количество буквами", "Тест-буквы", "abc", "10"),
        ("цена отрицательная", "Тест-цена", "1", "-100"),
        ("цена 1e20", "Тест-огромная", "1", "100000000000000000000"),
        ("цена с запятой и пробелами", "Тест-запятая", "1,5", " 12,50 "),
        ("количество 0,0001", "Тест-микро", "0,0001", "10"),
        ("количество 999999999", "Тест-макси", "999999999", "10"),
    ]
    for name, n_, q, pr in cases:
        pg.fill("#pName", n_); pg.fill("#pQty", q); pg.fill("#pPrice", pr)
        pg.evaluate("() => document.querySelector('.sheet button[type=submit]').click()"); pg.wait_for_timeout(150)
        ps = pg.evaluate(GET_ALL, "products"); saved = [x for x in ps if x["name"].startswith(n_[:30].strip())]
        err = pg.inner_text(".sheet .err") if pg.query_selector(".sheet .err") else ""
        rec("info", f"{name}: " + (f"СОХРАНЕНО qty={saved[-1]['qty']} price={saved[-1]['price']}" if saved else f"отклонено ({err[:80]})"))
    ps = pg.evaluate(GET_ALL, "products")
    badq = [(x["name"][:20], x["qty"], x["price"]) for x in ps if not (isinstance(x["qty"], (int, float)) and x["qty"] > 0 and x["qty"] < 1e12) or not (isinstance(x["price"], (int, float)) and 0 <= x["price"] < 1e12)]
    rec("check", "не сохраняются бесконечные/отрицательные/гигантские количества и цены", not badq, badq)
    close_sheets(pg)
    for tn in ["Главная", "Продукты"]:
        tab(pg, tn); pg.wait_for_timeout(200)
        bad = pg.evaluate(BAD_TEXT); rec("check", f"«{tn}»: нет NaN/Infinity после странного ввода", not bad, bad)
        ov = pg.evaluate("document.documentElement.scrollWidth <= innerWidth"); rec("check", f"«{tn}»: длинное имя не ломает ширину экрана", ov)
    # Список покупок: пустое, длинное, 300 штук
    tab(pg, 'Покупки')
    inp = pg.query_selector('[aria-label="Что купить"]')
    if inp:
        pg.fill('[aria-label="Что купить"]', "   "); pg.keyboard.press("Enter"); pg.wait_for_timeout(100)
        st = pg.evaluate(GET_SETTINGS); rec("check", "пустая строка не попадает в список покупок", not any(not x["name"].strip() for x in st.get("shop", [])), [x["name"] for x in st.get("shop", [])][:5])
        t0 = time.time()
        for i in range(300): pg.fill('[aria-label="Что купить"]', f"Покупка {i}"); pg.keyboard.press("Enter")
        pg.wait_for_timeout(800); st = pg.evaluate(GET_SETTINGS)
        k = sum(1 for x in st.get("shop", []) if x["name"].startswith("Покупка "))
        rec("check", f"300 покупок подряд: сохранено {k} за {time.time()-t0:.1f} с", k == 300, k)
    # Ответ Claude неверного формата
    tab(pg, 'Рецепты')
    try:
        pg.click("text=Спросить Claude: что приготовить", timeout=5000); pg.wait_for_selector('[aria-label="Ответ Claude"]')
        for ans, title in [('{"recipes":"x"}', "recipes — строка"), ('{"dishes":5}', "dishes — число"), ("{" * 20000, "20 000 скобок"), ("x" * 300000, "300 000 символов")]:
            errs_before = len(errs)
            pg.fill('[aria-label="Ответ Claude"]', ans)
            b = pg.query_selector("text=Разобрать ответ")
            if b: b.click(); pg.wait_for_timeout(200)
            msg = pg.inner_text(".sheet .err") if pg.query_selector(".sheet .err") else ""
            new_errs = errs[errs_before:]
            rec("check", f"ответ Claude «{title}»: понятное сообщение, без исключения", bool(msg) and not new_errs, (msg[:100], new_errs[:2]))
        close_sheets(pg)
    except Exception as e:
        rec("check", "окно «Спросить Claude»", False, e)
    # Текст чека: шумный OCR-текст 150 строк
    try:
        close_sheets(pg); pg.click(".tabs .plus"); pg.click("text=📋 Текст чека"); pg.wait_for_timeout(300)
        ta = pg.query_selector(".sheet:last-of-type textarea")
        random.seed(3); A = "абвгдежзиклмнопрстуфхцчшщыэюяАБВГДЕЖЗИКЛМНОПРСТУ0123456789 .,:-x"
        noise = "\n".join("".join(random.choice(A) for _ in range(48)) for _ in range(150))
        ta.fill(noise)
        btn = [b for b in pg.query_selector_all(".sheet:last-of-type button") if b.is_enabled() and ("Дальше" in b.inner_text() or "Разобрать" in b.inner_text() or "Проверить" in b.inner_text())]
        if btn:
            ms = pg.evaluate(TIMED_CLICK, btn[0])
            rec("check", f"разбор зашумлённого текста чека (150 строк): интерфейс завис на {ms:.0f} мс", ms < 1500, f"{ms:.0f} мс; кнопка «{btn[0].inner_text()}»")
        else:
            rec("info", "кнопка разбора текста чека не найдена: " + " | ".join(b.inner_text() for b in pg.query_selector_all(".sheet:last-of-type button"))[:300])
        close_sheets(pg)
    except Exception as e:
        rec("check", "окно «Текст чека»", False, e)
    rec("check", "без ошибок страницы при граничном вводе", not errs, errs[:8])
    ctx.close()

    # ======================= 4. Восстановление из копии =======================
    SECTION[0] = "копия"
    errs = []
    ctx, pg = new_page(br, errs)
    boot(pg)
    tmp = os.path.join(OUT, "_tmp"); os.makedirs(tmp, exist_ok=True)
    files = {
        "мусор.json": "это не json {{{",
        "пустой.json": "",
        "без-полей.json": json.dumps({"app": "kitchen-app", "products": []}),
        "битые-продукты.json": json.dumps({"app": "kitchen-app", "v": 1, "at": "x", "products": [None, {"id": 1}, {"id": "a", "name": None, "qty": "x"}], "log": [None], "recipes": [None], "settings": {}}),
        "битые-настройки.json": json.dumps({"app": "kitchen-app", "v": 1, "at": "2026-01-01", "products": [], "log": [], "recipes": [], "settings": {"members": "сломано", "rules": 5, "plan": "x", "shop": None}}),
    }
    if BIG_BACKUP: files["большая-копия.json"] = BIG_BACKUP
    for fname, content in files.items():
        path = os.path.join(tmp, fname); open(path, "w", encoding="utf-8").write(content)
        pg.goto(URL); pg.wait_for_selector("h1")
        more(pg); pg.click(".li:has-text('Данные и копия')")
        e0 = len(errs); t0 = time.time()
        pg.set_input_files("input[type=file]", path); pg.wait_for_timeout(500)
        body = pg.inner_text("main")
        if "Заменить" in body or "Добавить" in body:
            btn = pg.query_selector("button:has-text('Заменить')") or pg.query_selector("button:has-text('Добавить')")
            btn.click(); pg.wait_for_timeout(1500 if fname != "большая-копия.json" else 8000)
            dt = time.time() - t0
            c = crashed(pg)
            if not c:
                for tn in ["Главная", "Продукты", "Рецепты", "Покупки"]:
                    try: tab(pg, tn); pg.wait_for_timeout(150)
                    except Exception as e: c = f"вкладка {tn} недоступна: {e}"; break
                    c = crashed(pg)
                    if c: c = f"после перехода на «{tn}»: {c}"; break
            if not c:
                pg.reload(); pg.wait_for_selector("h1", timeout=20000); c = crashed(pg)
                if c: c = "после перезапуска: " + c
            rec("check", f"«{fname}»: копия принята и восстановлена ({dt:.1f} с)" + (" — приложение после этого сломано" if c else ""), not c, (c, errs[e0:e0+3]))
            if c:
                pg.evaluate("() => new Promise(r => { const q = indexedDB.deleteDatabase('kitchen'); q.onsuccess = q.onerror = q.onblocked = () => r(); })")
                boot(pg)
        else:
            msg = pg.inner_text("main")
            rec("check", f"«{fname}»: отклонена с понятным сообщением", "не похоже на копию" in msg and len(errs) == e0, errs[e0:e0+2])
    rec("info", "ошибки страницы в разделе копий: " + "; ".join(errs[:5]))
    ctx.close()

    # ======================= 5. Две вкладки одновременно =======================
    SECTION[0] = "две вкладки"
    errs = []
    ctx, pgA = new_page(br, errs)
    boot(pgA)
    pgB = ctx.new_page(); pgB.on("pageerror", lambda e: errs.append("B pageerror: " + str(e))); pgB.on("dialog", lambda d: d.accept())
    pgB.goto(URL); pgB.wait_for_selector("h1")
    for pg_, nm in [(pgA, "Из вкладки A"), (pgB, "Из вкладки B")]:
        tab(pg_, 'Покупки')
        pg_.fill('[aria-label="Что купить"]', nm); pg_.keyboard.press("Enter"); pg_.wait_for_timeout(400)
    st = pgA.evaluate(GET_SETTINGS); names = [x["name"] for x in st.get("shop", [])]
    rec("check", f"покупки, добавленные в двух открытых вкладках, обе сохранились: {names}", "Из вкладки A" in names and "Из вкладки B" in names, names)
    for pg_, nm in [(pgA, "ПродуктA"), (pgB, "ПродуктB")]:
        close_sheets(pg_); pg_.click(".tabs .plus"); pg_.fill("#pName", nm); pg_.fill("#pQty", "1"); pg_.fill("#pPrice", "1"); pg_.click(".sheet button[type=submit]"); pg_.wait_for_timeout(300); close_sheets(pg_)
    tab(pgA, 'Продукты'); seen = pgA.inner_text("main")
    rec("check", "вкладка A видит продукт, добавленный во вкладке B (без перезагрузки)", "ПродуктB" in seen)
    ctx.close()

    # ======================= 6. Без интернета =======================
    SECTION[0] = "офлайн"
    errs = []
    ctx, pg = new_page(br, errs)
    boot(pg)
    pg.wait_for_timeout(2500)  # сервис-воркер кладёт файлы в кэш
    ctx.set_offline(True)
    try:
        pg.reload(); pg.wait_for_selector("h1", timeout=15000)
        rec("check", "приложение открывается без интернета", not crashed(pg), crashed(pg))
        tab(pg, 'Рецепты'); pg.wait_for_timeout(300)
        n = pg.locator("main .li").count(); rec("check", f"без интернета видны рецепты базы ({n})", n > 10, n)
        close_sheets(pg); pg.click(".tabs .plus"); pg.fill("#pName", "Офлайн-молоко"); pg.fill("#pQty", "1"); pg.fill("#pPrice", "90"); pg.click(".sheet button[type=submit]")
        pg.wait_for_timeout(300); close_sheets(pg)
        ps = pg.evaluate(GET_ALL, "products"); rec("check", "без интернета продукт добавляется", any(x["name"] == "Офлайн-молоко" for x in ps))
    except Exception as e:
        rec("check", "приложение открывается без интернета", False, e)
    ctx.set_offline(False)
    ctx.close()

    # ======================= 7. «Обезьяний» тест: случайные действия =======================
    SECTION[0] = "случайные действия"
    JUNK = ["", " ", "0", "-1", "1e309", "999999999999", "abc", "🍕🍕🍕", "<img src=x onerror=alert(1)>", "Я" * 3000, "1,5", "NaN", "'; --", "​"]
    total_actions = int(os.environ.get("MONKEY", "1500"))
    found = {}
    for run in range(3):
        errs = []
        ctx, pg = new_page(br, errs)
        boot(pg)
        if run > 0:
            more(pg); pg.click(".li:has-text('Данные и копия')"); pg.click("text=Заполнить демо-данными"); pg.wait_for_timeout(500)
            yes = pg.query_selector("button:has-text('Заменить')") or pg.query_selector(".sheet button.btn")
            if yes and "Заполнить" not in pg.inner_text("main")[:0]:
                try: yes.click(timeout=1000)
                except Exception: pass
            pg.wait_for_timeout(1500)
        rnd = random.Random(100 + run)
        trail = []
        pg.on("filechooser", lambda fc: None)
        for i in range(total_actions // 3):
            try:
                els = pg.query_selector_all("button:visible:not([disabled]), [role=radio]:visible, input:visible:not([type=file]), textarea:visible, select:visible, .li:visible, .row:visible")
                if not els: pg.goto(URL); pg.wait_for_selector("h1"); continue
                el = rnd.choice(els)
                tag = el.evaluate("e => e.tagName + (e.type ? ':' + e.type : '')")
                label = (el.get_attribute("aria-label") or el.inner_text() or el.get_attribute("placeholder") or "")[:40].replace("\n", " ")
                # кнопки, которые уводят в браузер/сбрасывают приложение — пропускаем
                if any(w in label for w in ["Обновить и перезапустить", "Обновить приложение", "Просто перезагрузить"]): continue
                if tag.startswith("INPUT:text") or tag.startswith("INPUT:search") or tag.startswith("INPUT:number") or tag.startswith("INPUT:date") or tag.startswith("TEXTAREA") or tag == "INPUT":
                    v = rnd.choice(JUNK) if not tag.endswith("date") else rnd.choice(["", "1900-01-01", "9999-12-31", "2026-02-30"])
                    el.fill(v, timeout=1500); trail.append(f"ввод «{v[:20]}» в {label}")
                    if rnd.random() < 0.3: pg.keyboard.press("Enter")
                elif tag.startswith("SELECT"):
                    opts = el.evaluate("e => [...e.options].map(o => o.value)")
                    if opts: el.select_option(rnd.choice(opts)); trail.append(f"выбор в {label}")
                else:
                    el.click(timeout=1500); trail.append(f"нажатие «{label}»")
                if rnd.random() < 0.05: pg.keyboard.press("Escape")
                pg.wait_for_timeout(30)
                if len(pg.context.pages) > 1:
                    for extra in pg.context.pages[1:]: extra.close()
                if not pg.url.startswith(URL):
                    trail.append("ушли со страницы: " + pg.url); pg.goto(URL); pg.wait_for_selector("h1")
                c = crashed(pg)
                if c:
                    key = c + " ← " + " → ".join(trail[-6:])
                    found.setdefault(c, []).append({"шаги": trail[-8:], "ошибки": errs[-3:]})
                    pg.goto(URL); pg.wait_for_selector("h1", timeout=15000)
                    if crashed(pg):
                        found.setdefault("не восстанавливается после перезапуска", []).append({"шаги": trail[-8:], "ошибки": errs[-3:]})
                        pg.evaluate("() => new Promise(r => { const q = indexedDB.deleteDatabase('kitchen'); q.onsuccess = q.onerror = q.onblocked = () => r(); })")
                        boot(pg)
                if i % 25 == 0:
                    bad = pg.evaluate(BAD_TEXT)
                    for b in bad: found.setdefault("в тексте экрана: " + b.split(":")[0], []).append({"шаги": trail[-6:], "фрагмент": b})
                    if not pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"):
                        found.setdefault("горизонтальная прокрутка", []).append({"шаги": trail[-6:], "заголовок": pg.inner_text("h1") if pg.query_selector("h1") else ""})
            except Exception as e:
                msg = str(e).split("\n")[0]
                if "Timeout" not in msg and "detached" not in msg and "not attached" not in msg and "not visible" not in msg and "intercepts pointer" not in msg and "Execution context" not in msg and "navigation" not in msg:
                    found.setdefault("ошибка теста: " + msg[:80], []).append(trail[-4:])
        uniq = {}
        for e in errs: uniq.setdefault(e.split("\n")[0][:200], 0); uniq[e.split("\n")[0][:200]] += 1
        for e, n in uniq.items(): found.setdefault("ошибка JS: " + e, []).append({"раз": n, "шаги": trail[-6:]})
        ctx.close()
    rec("info", f"выполнено случайных действий: {total_actions}")
    for k, v in found.items():
        rec("check", f"{k} (случаев: {len(v)})", False, json.dumps(v[:2], ensure_ascii=False))
    if not found: rec("check", "случайные действия: ни одного сбоя", True)

    br.close()

json.dump(R, open(os.path.join(OUT, "result.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
fails = [r for r in R if r["status"] == "FAIL"]
print(f"\nИтого проверок: {sum(1 for r in R if r['status'] != 'INFO')}, не прошло: {len(fails)}")
