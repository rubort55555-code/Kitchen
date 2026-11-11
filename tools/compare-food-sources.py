# Сравнение таблицы состава приложения (src/lib/compositionData.json: Fineli R18 + USDA SR28 + значения по ГОСТ) с CoFID 2021 и USDA SR27.
# Источники берутся из чанков (literature/food-composition-sources/*/chunks), результат — в literature/food-composition-sources/comparison/.
# Запуск (из корня репозитория, после tools/chunk-food-sources.py): python3 -I tools/compare-food-sources.py
import csv, glob, json, os, re, statistics
from collections import defaultdict

R = os.path.join("literature", "food-composition-sources")
OUT = os.path.join(R, "comparison"); os.makedirs(OUT, exist_ok=True)
KEYS = "kcal prot fat carb fib sug satfat vitc b1 b2 b3 b5 b6 b9dfe b12 vita vite vitd vitk ca fe mg p k na zn cu mn se chol iod".split()
RU = dict(kcal="Энергия, ккал", prot="Белки, г", fat="Жиры, г", carb="Углеводы (без клетчатки), г", fib="Клетчатка, г", sug="Сахара, г", satfat="Насыщенные жиры, г",
          vitc="Витамин C, мг", b1="B1, мг", b2="B2, мг", b3="Ниацин, мг", b5="Пантотеновая к-та, мг", b6="B6, мг", b9dfe="Фолаты, мкг", b12="B12, мкг",
          vita="Витамин A, мкг", vite="Витамин E, мг", vitd="Витамин D, мкг", vitk="Витамин K, мкг", ca="Кальций, мг", fe="Железо, мг", mg="Магний, мг", p="Фосфор, мг",
          k="Калий, мг", na="Натрий, мг", zn="Цинк, мг", cu="Медь, мг", mn="Марганец, мг", se="Селен, мкг", chol="Холестерин, мг", iod="Йод, мкг")
# значимый минимум: ниже него относительную разницу не считаем (шум округления)
MINV = {k: 0.5 for k in KEYS}
MINV.update(kcal=5, vitc=0.5, b1=0.05, b2=0.05, b3=0.3, b5=0.2, b6=0.05, b9dfe=5, b12=0.1, vita=5, vite=0.3, vitd=0.2, vitk=2, ca=5, fe=0.3, mg=5, p=10, k=20, na=5, zn=0.3, cu=0.05, mn=0.05, se=1, chol=2, iod=2)
SR27F = dict(kcal="kcal", prot="prot", fat="fat", fib="fib", sug="sug", satfat="satfat", vitc="vitc", b1="b1", b2="b2", b3="b3", b5="b5", b6="b6", b12="b12", vita="vita", vite="vite", vitd="vitd",
             vitk="vitk", ca="ca", fe="fe", mg="mg", p="p", k="k", na="na", zn="zn", cu="cu", mn="mn", se="se", chol="chol")
COFID = dict(kcal="KCALS", prot="PROT", fat="FAT", carb="CHO", fib="AOACFIB", sug="TOTSUG", satfat="SATFOD", vitc="VITC", b1="THIA", b2="RIBO", b3="NIAC", b5="PANTO", b6="VITB6", b9dfe="FOLT",
             b12="VITB12", vita="RETEQU", vite="VITE", vitd="VITD", vitk="VITK1", ca="CA", fe="FE", mg="MG", p="P", k="K", na="NA", zn="ZN", cu="CU", mn="MN", se="SE", chol="CHOL", iod="I")
FINELI = dict(kcal="ENERC", prot="PROT", fat="FAT", carb="CHOAVL", fib="FIBC", sug="SUGAR", satfat="FASAT", vitc="VITC", b1="THIA", b2="RIBF", b3="NIA", b6="VITPYRID", b9dfe="FOL", b12="VITB12", vita="VITA",
              vite="VITE", vitd="VITD", vitk="VITK", ca="CA", fe="FE", mg="MG", p="P", k="K", na="NA", zn="ZN", cu="CU", mn="MN", se="SE", chol="CHOLE", iod="ID")

def load(pattern):
    out = []
    for f in sorted(glob.glob(pattern)):
        out += [json.loads(l) for l in open(f, encoding="utf-8")]
    return out

sr27 = {r["ndb"]: r for r in load(os.path.join(R, "usda-sr27", "chunks", "foods", "*.jsonl"))}
cofid = load(os.path.join(R, "cofid-2021", "chunks", "foods", "*.jsonl"))
app = json.load(open(os.path.join("src", "lib", "compositionData.json"), encoding="utf-8"))["items"]
amap = {}
for l in open(os.path.join("tools", "nutrition-map.jsonl"), encoding="utf-8"):
    if l.strip(): r = json.loads(l); amap[r["name"]] = r
for c in cofid:
    c["g"] = c.get("group") or ""

# Российский справочник (Скурихин, Тутельяна, 2002): принятые строки tools/parse-russian-tables.py
RUF = dict(kcal="kcal", prot="prot", fat="fat", carb="carb", fib="fib", sug="mds", satfat="sfa", vitc="vitc", b1="b1", b2="b2", b3="pp", vita="re", vite="te", ca="ca", fe="fe", mg="mg", p="p", k="k", na="na", chol="chol")
RUCOL = dict(kcal="ЭЦ", prot="Бел", fat="Жир", carb="Угл", fib="ПВ", sug="МДС", satfat="НЖК", vitc="С", b1="B1", b2="B2", b3="PP", vita="РЭ", vite="ТЭ", ca="Ca", fe="Fe", mg="Mg", p="P", k="K", na="Na", chol="Хол")
RU_PATH = os.path.join(R, "russia-himsostav", "chunks", "tables", "foods_parsed.jsonl")
ru_rows = [json.loads(l) for l in open(RU_PATH, encoding="utf-8")] if os.path.exists(RU_PATH) else []
def rstem(w):
    w = w.lower().replace("ё", "е")
    return re.sub(r"(ами|ями|ого|ему|ыми|ими|ой|ый|ий|ая|яя|ое|ее|ые|ие|ов|ев|ей|ам|ям|ах|ях|ом|ем|ы|и|а|я|о|е|у|ю|ь|й)$", "", w) if len(w) > 4 else w
def rtoks(s): return [rstem(w) for w in re.findall(r"[А-Яа-яЁё]+", s)]
RSTATE = re.compile(r"сушен|вялен|жарен|обжарен|отварн|варен|припущ|тушен|запечен|фарширован|маринов|солен|копчен|консерв|пюре|сгущен|топлен|в масле|в томат|в собственном|по \d+-\d+|заморожен|сок\b|компот|варенье|джем|повидло|рубленая|затяжное")
def rstate(name): return frozenset(m.group(0) for m in RSTATE.finditer(name.lower().replace("ё", "е")))
for r in ru_rows: r["t"] = rtoks(r["name"]); r["st"] = rstate(r["name"])
def ru_cands(name):
    """Тот же первый слово и слова запроса в названии книги; состояние (сушёный, жареный, консервы, блюдо «по 1-206» …) должно совпадать с состоянием названия приложения."""
    q = rtoks(name); qs = rstate(name)
    if not q: return []
    return [r for r in ru_rows if r["t"] and r["t"][0] == q[0] and all(w in r["t"] for w in q[1:]) and r["st"] == qs]

def sr_vals(r):
    n = r["n"]; v = {}
    for k, f in SR27F.items():
        if f in n: v[k] = n[f]
    if "carb" in n: v["carb"] = max(0, n["carb"] - n.get("fib", 0))
    v["b9dfe"] = n.get("b9dfe", n.get("folate")) if ("b9dfe" in n or "folate" in n) else None
    return {k: x for k, x in v.items() if x is not None}

def cf_vals(c):
    v = {}
    for k, t in COFID.items():
        x = c["n"].get(t)
        if x == "Tr": x = 0.0
        if isinstance(x, (int, float)): v[k] = float(x)
    return v

# --- поиск продукта CoFID по английскому названию из карты приложения ---
STOP = set("raw all commercial varieties variety average with without and the of in from or a an on as for type style fresh pack packed brand drained solids only unprepared prepared made mature kind".split())
STATE = set("cooked boiled fried roasted roast grilled baked stewed steamed dried canned pickled smoked frozen microwaved braised stir tinned juice sauce casseroled curried poached deep shallow barbecued".split())
PARTS = set("skin peel fat bone rind shell stone gristle".split())          # части продукта: если есть в CoFID, но нет в запросе — это другой продукт
MODS = set("reduced low light diet free skimmed semi whole".split())             # «обезжиренный» и т. п.: то же правило
SOFT = set("skin flesh meat fresh ground whole edible portion unprepared regular enriched long grain only hull salt unsweetened unsalted".split())  # слова запроса, которых может не быть в CoFID без смены смысла
def toks(s):
    out = []
    s = re.sub(r"\bwithout\s+\w+(\s+and\s+\w+)?", " ", s.lower())
    for w in re.findall(r"[a-z]+", s):
        if w in STOP: continue
        w = re.sub(r"(ies)$", "y", w); w = re.sub(r"(oes)$", "o", w); w = re.sub(r"s$", "", w) if len(w) > 3 else w
        out.append(w)
    return out
cf_tok = []
for c in cofid:
    seq = toks(c.get("name") or "")
    if seq: cf_tok.append((seq[0], set(seq), c))

def best(query):
    """Главное слово совпадает с первым словом названия CoFID, состояние (сырой/варёный и т. п.) одинаково, сходство множеств слов ≥ 0,6; при нескольких равных кандидатах — «неоднозначно»."""
    q = toks(query)
    if not q: return None, 0, False
    qs = set(q); head = q[0]; qstate = qs & STATE; res = []
    for h, d, c in cf_tok:
        if h != head or (d & STATE) != qstate: continue
        if (d - qs) & (PARTS | MODS): continue
        if (qs - d) - SOFT: continue
        if d == {head, "skin"}: continue
        sc = len(qs & d) / len(qs | d)
        res.append((sc, c))
    if not res: return None, 0, False
    res.sort(key=lambda x: -x[0]); top = res[0]
    amb = len(res) > 1 and abs(res[1][0] - top[0]) < 1e-9 and res[1][1]["n"].get("KCALS") != top[1]["n"].get("KCALS")
    return top[1], top[0], amb

rows = []; long_rows = []
st = defaultdict(lambda: {"sr": [], "cf": [], "cs": [], "ru": []})
nru = 0
nmatch = nconf = nsr = 0
for it in app:
    m = amap.get(it["n"]);
    if not m: continue
    av = {k: x for k, x in zip(KEYS, it["v"]) if x is not None}
    src = "ГОСТ/маркировка поверх" if m.get("override") else ("Fineli R18 + USDA" if it["id"].startswith("fineli:") else "USDA SR28")
    sr = sr27.get(m["ndb"]); srv = sr_vals(sr) if sr else {}
    nsr += 1 if sr else 0
    cand = []
    for q in (m.get("fineli_match"), sr["long"] if sr else None, m.get("match")):
        if q: c, s, amb = best(q); cand.append((s, c, q, amb))
    s, c, q, amb = max(cand, key=lambda x: (x[0] if not x[3] else x[0] - 0.01)) if cand else (0, None, "", False)
    cfv = cf_vals(c) if c else {}
    conf = bool(c) and s >= 0.6 and not amb
    nmatch += 1 if c else 0; nconf += 1 if conf else 0
    rc = ru_cands(it["n"]); nru += 1 if rc else 0
    ruv = {}
    for k, f in RUF.items():
        xs = sorted(r["n"][f] for r in rc if isinstance(r["n"].get(f), (int, float)))
        if xs: ruv[k] = (statistics.median(xs), xs[0], xs[-1])
    rows.append([it["n"], src, m["ndb"], sr["name"] if sr else "(нет в SR27)", c["code"] if c else "", c["name"] if c else "", round(s, 2), "да" if conf else "нет", q,
                 len(rc), "; ".join(f"{r['code']} {r['name']}" for r in rc[:3])])
    for k in KEYS:
        a, b, d = av.get(k), srv.get(k), cfv.get(k)
        def rel(x, y):
            if x is None or y is None: return None
            if max(abs(x), abs(y)) < MINV[k]: return None
            return abs(x - y) / max(abs(x), abs(y))
        r1 = rel(a, b); r2 = rel(a, d) if conf else None; r3 = rel(b, d) if conf else None
        if r1 is not None: st[k]["sr"].append((r1, it["n"], a, b))
        if r2 is not None: st[k]["cf"].append((r2, it["n"], a, d))
        if r3 is not None: st[k]["cs"].append((r3, it["n"], b, d))
        ru = ruv.get(k); r4 = rel(a, ru[0]) if ru else None
        if r4 is not None: st[k]["ru"].append((r4, it["n"], a, ru[0], ru[1], ru[2]))
        long_rows.append([it["n"], k, a, b, d if conf else None, None if r1 is None else round(r1, 3), None if r2 is None else round(r2, 3),
                          None if not ru else round(ru[0], 3), None if not ru else ru[1], None if not ru else ru[2], None if r4 is None else round(r4, 3)])

with open(os.path.join(OUT, "products_match.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f); w.writerow(["Продукт приложения", "Источник значений в приложении", "NDB (SR)", "Название в SR27", "Код CoFID", "Название в CoFID", "Сходство названия", "Надёжное соответствие", "Запрос", "Кандидатов в рос. справочнике", "Примеры (код название)"]); w.writerows(rows)
with open(os.path.join(OUT, "values_long.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f); w.writerow(["Продукт", "Показатель", "Приложение", "SR27", "CoFID (только надёжные)", "Расхождение приложение/SR27", "Расхождение приложение/CoFID", "Рос. справочник: медиана кандидатов", "мин", "макс", "Расхождение приложение/медиана рос."]); w.writerows(long_rows)

def fill_rate_cofid(tag): return sum(1 for c in cofid if isinstance(c["n"].get(tag), (int, float)) or c["n"].get(tag) == "Tr")
def fill_rate_sr(field): return sum(1 for r in sr27.values() if field in r["n"])
fin = json.load(open(os.path.join("tools", "fineli-values.json"), encoding="utf-8")).get("foods", {})
def fill_rate_fin(code): return sum(1 for f in fin.values() if isinstance(f.get("v", {}).get(code), (int, float)))
def fill_rate_app(i): return sum(1 for it in app if it["v"][i] is not None)

def pct(xs, t=0.15): return f"{100 * sum(1 for x in xs if x[0] <= t) / len(xs):.0f}%" if xs else "—"
def med(xs): return f"{100 * statistics.median(x[0] for x in xs):.0f}%" if xs else "—"

L = []
L.append("# Сравнение: приложение «Кухня» ↔ CoFID 2021 ↔ USDA SR27 ↔ российский справочник\n")
L.append(f"Сформировано `tools/compare-food-sources.py` из чанков (без обращения к интернету). Продуктов в таблице приложения: **{len(app)}**; из них найдено в SR27 по коду NDB: **{nsr}**; в CoFID по названию: **{nmatch}** (надёжных: **{nconf}**, сходство названия ≥ 0,6, то же главное слово и состояние, соответствие однозначное).\n")
L.append("## 1. Источники\n")
L.append("| Источник | Год | Продуктов | Показателей | Лицензия | Чанки |\n|---|---|---|---|---|---|")
L.append(f"| Приложение «Кухня» (`compositionData.json`) | — | {len(app)} | 31 | Fineli CC BY 4.0, USDA — общественное достояние, ГОСТ — по маркировке | — |")
L.append(f"| McCance and Widdowson's CoFID, набор 2021 (Великобритания) | 2021 | {len(cofid)} (+393 выведенных из набора) | ≈ 280 (14 листов) | Open Government Licence | `cofid-2021/chunks/foods/` |")
L.append(f"| USDA National Nutrient Database SR, Release 27 | 2014 | {len(sr27)} | 53 в сокращённой таблице (в полной — 150 кодов NUTR_DEF) | общественное достояние | `usda-sr27/chunks/foods/` |")
L.append(f"| Химический состав российских пищевых продуктов (под ред. Скурихина и Тутельяна, Институт питания РАМН) | 2002 | {len(ru_rows)} принято автоматически из ≈ 1 080 строк таблиц 1–12 (остальные — см. README) | 16 (КБЖУ, МДС, клетчатка, НЖК, холестерин, 6 минералов, A/РЭ/ТЭ, B1, B2, PP, C) | не установлена (издание под защитой авторского права) | `russia-himsostav/chunks/` |\n")
L.append("## 2. Показатели: что есть в каждом источнике\n")
L.append("Доля продуктов с числовым значением (в CoFID «Tr» — следы — считается значением 0, «N» — не определено, — пропуском).\n")
L.append("| Показатель приложения | CoFID: код (доля) | SR27: поле (доля) | Fineli R18: код (доля) | Приложение (доля из 260) | Российский справочник |\n|---|---|---|---|---|---|")
for i, k in enumerate(KEYS):
    cf = f"{COFID[k]} ({100 * fill_rate_cofid(COFID[k]) / len(cofid):.0f}%)" if k in COFID else "нет"
    sf = (f"{SR27F[k]} ({100 * fill_rate_sr(SR27F[k]) / len(sr27):.0f}%)" if k in SR27F else ("carb−fib (" + f"{100 * fill_rate_sr('carb') / len(sr27):.0f}%)" if k == "carb" else ("b9dfe/folate (" + f"{100 * max(fill_rate_sr('b9dfe'), fill_rate_sr('folate')) / len(sr27):.0f}%)" if k == "b9dfe" else "нет")))
    fl = f"{FINELI[k]} ({100 * fill_rate_fin(FINELI[k]) / max(1, len(fin)):.0f}%)" if k in FINELI else "нет"
    L.append(f"| {RU[k]} | {cf} | {sf} | {fl} | {100 * fill_rate_app(i) / len(app):.0f}% | {('«' + RUCOL[k] + '» (' + str(len(ru_rows)) + ' строк)') if k in RUF else 'нет'} |")
L.append("")
L.append("## 3. Насколько значения приложения совпадают с источниками\n")
L.append("Относительная разница на 100 г: |a−b| / max(a, b); пары, где оба значения ниже порога значимости (шум округления), не считаются. «В пределах 15%» — доля пар, у которых разница не больше 15%. "
         "В CoFID берутся только надёжные соответствия по названию; остальные — на ручную проверку (`comparison/products_match.csv`).\n")
L.append("| Показатель | Приложение↔SR27: пар | в пределах 15% | медиана | Приложение↔CoFID: пар | в пределах 15% | медиана | SR27↔CoFID: в пределах 15% | Приложение↔рос. справочник: пар | в пределах 15% | медиана |\n|---|---|---|---|---|---|---|---|---|---|---|")
for k in KEYS:
    s = st[k]
    L.append(f"| {RU[k]} | {len(s['sr'])} | {pct(s['sr'])} | {med(s['sr'])} | {len(s['cf'])} | {pct(s['cf'])} | {med(s['cf'])} | {pct(s['cs'])} | {len(s['ru']) if k in RUF else '—'} | {pct(s['ru']) if k in RUF else '—'} | {med(s['ru']) if k in RUF else '—'} |")
L.append("")
L.append("## 4. Самые заметные расхождения (основные показатели)\n")
for k in ("kcal", "prot", "fat", "carb", "fe", "ca"):
    for name, key in (("SR27", "sr"), ("CoFID", "cf"), ("российским справочником (медиана кандидатов)", "ru")):
        xs = sorted(st[k][key], key=lambda x: -x[0])[:8]
        if not xs: continue
        L.append(f"**{RU[k]} — приложение против {name}:** " + "; ".join((f"{x[1]}: {x[2]:g} против {x[3]:g}" + (f" (диапазон {x[4]:g}–{x[5]:g})" if key == 'ru' else "")) for x in xs) + "\n")
L.append("## 5. Чем определения показателей различаются между источниками\n")
L.append("""- **Углеводы.** Приложение считает «усвояемые» (по разности минус клетчатка), как российские справочники и этикетки. USDA SR27 — «by difference» вместе с клетчаткой (для сравнения вычитается клетчатка). CoFID — доступные углеводы в моносахаридных эквивалентах (CHO) без клетчатки; значения чуть ниже, чем «разность», у продуктов с крахмалом.
- **Клетчатка.** USDA — общая пищевая клетчатка; CoFID — два показателя: NSP (метод Энглиста, ниже) и AOAC (сопоставимо с USDA); для сравнения взят AOAC.
- **Энергия.** Приложение: Fineli даёт кДж, пересчёт ÷ 4,184. USDA — коэффициенты Атуотера. CoFID — свои коэффициенты (энергия в ккал и кДж отдельными колонками).
- **Витамин A.** USDA — RAE (мкг), CoFID — ретиноловый эквивалент (ретинол + β-каротин/6), Fineli — RAE. Цифры близки, но не тождественны.
- **Фолаты.** USDA — DFE (эквивалент пищевых фолатов); CoFID — общий фолат (мкг) без пересчёта в DFE; у необогащённых продуктов совпадают.
- **Ниацин.** USDA и приложение — преформированный ниацин; в CoFID есть и ниациновый эквивалент (NIACEQU, с триптофаном) — для сравнения взят NIAC.
- **Йод.** В USDA SR27 йода нет вообще, в CoFID он есть (код I), в приложении — из Fineli.
- **Российский справочник.** «Угл» — усвояемые углеводы (МДС + крахмал, без клетчатки ПВ), как в приложении; «МДС» — моно- и дисахариды (сопоставлены с «Сахара»); «РЭ» — ретиноловый эквивалент (сопоставлен с витамином A); «ТЭ» — токоферольный эквивалент (с витамином E); «PP» — ниацин; «ЭЦ» — энергетическая ценность по коэффициентам справочника. Данных по B5, B6, фолатам, B12, D, K, цинку, меди, марганцу, селену, йоду в этих таблицах нет.
- **Состояние продукта.** Названия CoFID включают приготовление («boiled», «fried»); автосопоставление штрафует несовпадение, но возможны ошибки — смотрите «Сходство названия» в `products_match.csv`.
- **Ошибка в самом наборе CoFID 2021:** код `13-669` присвоен двум разным продуктам («Aubergine, flesh and skin» и «Watercress, raw»); чанки хранят оба, с пометкой `dup_code`.""")
L.append("")
L.append("## 6. Что из этого следует и что не проверено\n")
L.append(f"""- Приложение и SR27 совпадают по энергии в пределах 15% у {pct(st['kcal']['sr'])} продуктов (медиана расхождения {med(st['kcal']['sr'])}), по белкам — {pct(st['prot']['sr'])}, по железу — {pct(st['fe']['sr'])}. Расхождения вызваны тремя причинами, которые видны в `tools/nutrition-map.jsonl`: значения Fineli вместо USDA, значения по ГОСТ и маркировке (поле `override`) и «примерные аналоги» (поле `note`: например, нори в приложении — сухие листы, в SR27 по этому коду — сырые).
- С CoFID сравнивается только **{nconf}** продуктов из {len(app)}: автоматическое сопоставление по английскому названию намеренно строгое. Остальные продукты нужно сопоставлять вручную (`products_match.csv`, колонка «Надёжное соответствие» = «нет»). Совпадение названия не гарантирует тот же продукт: например, «Coconut milk» в CoFID — жидкость из ореха (22 ккал), а в приложении — консервированное кокосовое молоко (208 ккал), это видно в разделе 4.
- Низкая согласованность по витаминам A, D, E, K, селену — ожидаемая: эти показатели сильно зависят от сорта, сезона и метода анализа; несовпадение двух баз — не обязательно ошибка приложения.
- **Российский справочник** (Скурихин, Тутельян, 2002): в сравнение попали только строки, прошедшие проверки `tools/parse-russian-tables.py` (ровно 12 + 16 значений, сумма компонентов 100 ± 3 г, энергия сходится с БЖУ); остальные строки таблиц 1–12 и все таблицы жиров, напитков и приложений не разобраны — это пробел, а не отсутствие данных (`russia-himsostav/README.md`). Русские названия приложения («Творог», «Яйца») сопоставляются с названием в книге по началу названия; у одного продукта приложения обычно несколько строк книги (разные жирности, сорта, способы приготовления), поэтому показаны диапазон и медиана, а «в пределах 15%» считается к **медиане** и поэтому лишь ориентир. Яйца или говядина в книге — десятки строк, а у «Лук порей» может не быть ни одной.
- Ни одно значение в приложении (`compositionData.json`) этим сравнением **не изменялось**.
""")
open(os.path.join(OUT, "COMPARISON.md"), "w", encoding="utf-8").write("\n".join(L))
print(f"app {len(app)} | SR27 найдено {nsr} | CoFID найдено {nmatch}, надёжно {nconf} | рос. справочник: продуктов с кандидатами {nru}")
