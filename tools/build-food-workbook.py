# Сводная книга Excel по трём источникам состава (российский справочник 2002, USDA SR27, CoFID 2021) и таблице приложения.
# Листы: «О таблице», «Сводная (приоритет РФ)» — 260 продуктов приложения, значения по цепочке РФ → SR27 → CoFID с цветом источника;
# «Откуда значения» — источник каждого значения; «Приложение сейчас» — текущие значения compositionData.json; «Неоднозначные РФ» — продукты, для которых в российском справочнике
# несколько разных строк (выбор вручную); «Все продукты» — все строки всех трёх источников в единых колонках (31 показатель приложения, на 100 г).
# Источники берутся из чанков literature/food-composition-sources/*/chunks; сопоставление с CoFID — comparison/products_match.csv (tools/compare-food-sources.py).
# Запуск (из корня репозитория, после chunk/parse/compare): python3 -I tools/build-food-workbook.py
import csv, glob, json, os, re, statistics
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

R = os.path.join("literature", "food-composition-sources")
OUT = os.path.join(R, "comparison", "food_composition_unified.xlsx")
KEYS = "kcal prot fat carb fib sug satfat vitc b1 b2 b3 b5 b6 b9dfe b12 vita vite vitd vitk ca fe mg p k na zn cu mn se chol iod".split()
HEAD = dict(kcal="Энергия, ккал", prot="Белки, г", fat="Жиры, г", carb="Углеводы (без клетчатки), г", fib="Клетчатка, г", sug="Сахара, г", satfat="Насыщенные жиры, г",
            vitc="Витамин C, мг", b1="B1, мг", b2="B2, мг", b3="Ниацин, мг", b5="Пантотеновая к-та, мг", b6="B6, мг", b9dfe="Фолаты, мкг", b12="B12, мкг",
            vita="Витамин A, мкг", vite="Витамин E, мг", vitd="Витамин D, мкг", vitk="Витамин K, мкг", ca="Кальций, мг", fe="Железо, мг", mg="Магний, мг", p="Фосфор, мг",
            k="Калий, мг", na="Натрий, мг", zn="Цинк, мг", cu="Медь, мг", mn="Марганец, мг", se="Селен, мкг", chol="Холестерин, мг", iod="Йод, мкг")
SR27F = dict(kcal="kcal", prot="prot", fat="fat", fib="fib", sug="sug", satfat="satfat", vitc="vitc", b1="b1", b2="b2", b3="b3", b5="b5", b6="b6", b12="b12", vita="vita", vite="vite", vitd="vitd",
             vitk="vitk", ca="ca", fe="fe", mg="mg", p="p", k="k", na="na", zn="zn", cu="cu", mn="mn", se="se", chol="chol")
COFID = dict(kcal="KCALS", prot="PROT", fat="FAT", carb="CHO", fib="AOACFIB", sug="TOTSUG", satfat="SATFOD", vitc="VITC", b1="THIA", b2="RIBO", b3="NIAC", b5="PANTO", b6="VITB6", b9dfe="FOLT",
             b12="VITB12", vita="RETEQU", vite="VITE", vitd="VITD", vitk="VITK1", ca="CA", fe="FE", mg="MG", p="P", k="K", na="NA", zn="ZN", cu="CU", mn="MN", se="SE", chol="CHOL", iod="I")
RUF = dict(kcal="kcal", prot="prot", fat="fat", carb="carb", fib="fib", sug="mds", satfat="sfa", vitc="vitc", b1="b1", b2="b2", b3="pp", vita="re", vite="te", ca="ca", fe="fe", mg="mg", p="p", k="k", na="na", chol="chol")
PRIORITY = ["РФ", "SR27", "CoFID"]            # порядок источников при совпадении продукта; меняется здесь
FILL = {"РФ": "C6EFCE", "SR27": "DDEBF7", "CoFID": "FCE4D6"}

def load(pattern):
    out = []
    for f in sorted(glob.glob(pattern)): out += [json.loads(l) for l in open(f, encoding="utf-8")]
    return out

sr27 = {r["ndb"]: r for r in load(os.path.join(R, "usda-sr27", "chunks", "foods", "*.jsonl"))}
sr_groups = {r["ndb"]: f for f in glob.glob(os.path.join(R, "usda-sr27", "chunks", "foods", "*.jsonl")) for r in [json.loads(open(f, encoding="utf-8").readline())]}
sr_group_name = {}
for f in glob.glob(os.path.join(R, "usda-sr27", "chunks", "foods", "*.jsonl")):
    g = os.path.basename(f).split("_", 1)[1][:-6].replace("-", " "); code = os.path.basename(f).split("_", 1)[0]; sr_group_name[code] = g
cofid = load(os.path.join(R, "cofid-2021", "chunks", "foods", "*.jsonl"))
cofid_top = {}
for f in glob.glob(os.path.join(R, "cofid-2021", "chunks", "foods", "*.jsonl")):
    cofid_top[os.path.basename(f).split("_", 1)[0]] = os.path.basename(f).split("_", 1)[1][:-6].replace("-", " ")
ru_rows = load(os.path.join(R, "russia-himsostav", "chunks", "tables", "foods_parsed.jsonl"))
app = json.load(open(os.path.join("src", "lib", "compositionData.json"), encoding="utf-8"))["items"]
amap = {}
for l in open(os.path.join("tools", "nutrition-map.jsonl"), encoding="utf-8"):
    if l.strip(): r = json.loads(l); amap[r["name"]] = r
match = {r["Продукт приложения"]: r for r in csv.DictReader(open(os.path.join(R, "comparison", "products_match.csv"), encoding="utf-8"))}
cf_by = {(c["code"], c.get("name")): c for c in cofid}

def sr_vals(r):
    n = r["n"]; v = {k: n[f] for k, f in SR27F.items() if f in n}
    if "carb" in n: v["carb"] = max(0, n["carb"] - n.get("fib", 0))
    b9 = n.get("b9dfe", n.get("folate"))
    if b9 is not None: v["b9dfe"] = b9
    return v

def cf_vals(c):
    v = {}
    for k, t in COFID.items():
        x = c["n"].get(t)
        if x == "Tr": x = 0.0
        if isinstance(x, (int, float)): v[k] = float(x)
    return v

def ru_vals(r):
    return {k: r["n"][f] for k, f in RUF.items() if isinstance(r["n"].get(f), (int, float)) and not (k == "kcal" and r.get("flags"))}

# --- русские кандидаты (то же правило, что в tools/compare-food-sources.py) ---
def rstem(w):
    w = w.lower().replace("ё", "е")
    return re.sub(r"(ами|ями|ого|ему|ыми|ими|ой|ый|ий|ая|яя|ое|ее|ые|ие|ов|ев|ей|ам|ям|ах|ях|ом|ем|ы|и|а|я|о|е|у|ю|ь|й)$", "", w) if len(w) > 4 else w
def rtoks(s): return [rstem(w) for w in re.findall(r"[А-Яа-яЁё]+", s)]
RSTATE = re.compile(r"сушен|вялен|жарен|обжарен|отварн|варен|припущ|тушен|запечен|фарширован|маринов|солен|копчен|консерв|пюре|сгущен|топлен|в масле|в томат|в собственном|по \d+-\d+|заморожен|сок\b|компот|варенье|джем|повидло|рубленая|затяжное|сух(?:ое|ой|ие|ая|ого)\b|порошок|квашен|прессован")
def rstate(name): return frozenset(m.group(0) for m in RSTATE.finditer(name.lower().replace("ё", "е")))
for r in ru_rows: r["t"] = rtoks(r["name"]); r["st"] = rstate(r["name"])
def ru_cands(name):
    q = rtoks(name); qs = rstate(name)
    if not q: return []
    return [r for r in ru_rows if r["t"] and r["t"][0] == q[0] and all(w in r["t"] for w in q[1:]) and r["st"] == qs]

# Совпадения по названию, которые проверкой вручную признаны другим продуктом: российские значения не используются
RU_BLOCK = {"Сыр": "в справочнике «сыр домашний» — творожный продукт, а не твёрдый сыр", "Фарш": "в справочнике только фарш для колбас", "Фарш куриный": "в справочнике только колбасный фарш", "Горчица": "в справочнике семена горчицы, а в приложении готовая горчица", "Дрожжи": "в справочнике прессованные дрожжи, а в приложении сухие активные"}

# --- сводные группы (по продуктам приложения) ---
groups = []; member = defaultdict(list)           # member[(источник, код)] -> названия групп
for it in app:
    name = it["n"]; m = amap.get(name); mt = match.get(name)
    if not m: continue
    g = {"name": name, "app": {k: x for k, x in zip(KEYS, it["v"]) if x is not None},
         "app_src": "ГОСТ/маркировка поверх" if m.get("override") else ("Fineli R18 + USDA" if it["id"].startswith("fineli:") else "USDA SR28")}
    g["sr"] = sr27.get(m["ndb"])
    g["cf"] = None
    if mt and mt["Надёжное соответствие"] == "да" and mt["Код CoFID"]:
        g["cf"] = cf_by.get((mt["Код CoFID"], mt["Название в CoFID"]))
    cands = [] if name in RU_BLOCK else ru_cands(name)
    g["ru_note"] = RU_BLOCK.get(name, "")
    kc = [x["n"]["kcal"] for x in cands if "kcal" in x["n"] and not x.get("flags")]
    spread = (max(kc) - min(kc)) / (statistics.median(kc) or 1) if len(kc) >= 2 else 0
    g["ru_all"] = cands
    g["ru_ok"] = bool(cands) and (len(cands) <= 3 or spread <= 0.30) and spread <= 0.5
    g["ru_spread"] = spread
    groups.append(g)
    if g["sr"]: member[("SR27", g["sr"]["ndb"])].append(name)
    if g["cf"]: member[("CoFID", g["cf"]["code"] + "|" + (g["cf"].get("name") or ""))].append(name)
    for x in cands: member[("РФ", x["code"] + "|" + str(x["page"]))].append(name)

def merged(g):
    vals = {}; src = {}
    ru = {}
    if g["ru_ok"]:
        for k in KEYS:
            xs = [v[k] for v in (ru_vals(x) for x in g["ru_all"]) if k in v]
            if xs: ru[k] = round(statistics.median(xs), 3)
    srv = sr_vals(g["sr"]) if g["sr"] else {}
    cfv = cf_vals(g["cf"]) if g["cf"] else {}
    for k in KEYS:
        for s_, d in zip(PRIORITY, (ru, srv, cfv)):
            if k in d: vals[k] = d[k]; src[k] = s_; break
    return vals, src

# --- книга ---
wb = Workbook()
hfont = Font(bold=True); wrap = Alignment(wrap_text=True, vertical="top")
def sheet(title, headers, rows, widths=None):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for c in ws[1]: c.font = hfont; c.alignment = Alignment(wrap_text=True, vertical="center")
    for r in rows: ws.append(r)
    ws.freeze_panes = ws.cell(row=2, column=(widths or {}).get("freeze", 3))
    ws.auto_filter.ref = ws.dimensions
    for i, h in enumerate(headers, 1):
        ws.column_dimensions[get_column_letter(i)].width = (widths or {}).get(i, 12 if i > 3 else 28)
    return ws

wb.remove(wb.active)
about = wb.create_sheet("О таблице")

# Сводная
head_m = ["№", "Продукт приложения", "Значения в приложении (источник)", "РФ: найдено строк (коды)", "РФ: как использовано", "SR27: NDB и название", "CoFID: код и название (надёжное совпадение)", "Источники значений (сколько показателей)"] + [HEAD[k] for k in KEYS]
rows_m = []; rows_s = []; rows_a = []; rows_amb = []
fills = []   # (row, col, source)
cnt_src = defaultdict(int)
for i, g in enumerate(groups, 1):
    vals, src = merged(g)
    c = defaultdict(int)
    for s_ in src.values(): c[s_] += 1
    ru_codes = "; ".join(f"{x['code']} {x['name'][:40]}" for x in g["ru_all"][:6]) + (" …" if len(g["ru_all"]) > 6 else "")
    how = ("используется (медиана по строкам)" if len(g["ru_all"]) > 1 else "используется") if g["ru_ok"] else ("неоднозначно: разные продукты, см. лист «Неоднозначные РФ»; значения взяты из SR27/CoFID" if g["ru_all"] else ("нет совпадения в российском справочнике" + (f" (найденное по названию не подходит: {g['ru_note']})" if g["ru_note"] else "")))
    base = [i, g["name"], g["app_src"], f"{len(g['ru_all'])}: {ru_codes}" if g["ru_all"] else "0", how,
            f"{g['sr']['ndb']} {g['sr']['long']}" if g["sr"] else "нет", f"{g['cf']['code']} {g['cf'].get('name')}" if g["cf"] else "нет надёжного совпадения",
            "; ".join(f"{s_}: {c[s_]}" for s_ in PRIORITY if c[s_])]
    rows_m.append(base + [vals.get(k) for k in KEYS]); rows_s.append(base[:2] + [src.get(k, "") for k in KEYS]); rows_a.append(base[:3] + [g["app"].get(k) for k in KEYS])
    for k_i, k in enumerate(KEYS):
        if k in src: fills.append((i + 1, 9 + k_i, src[k])); cnt_src[src[k]] += 1
    if g["ru_all"] and not g["ru_ok"]:
        for x in g["ru_all"]:
            n = x["n"]; rows_amb.append([g["name"], x["code"], x["name"], x["page"], n.get("kcal"), n.get("prot"), n.get("fat"), n.get("carb"), f"разброс энергии кандидатов {100 * g['ru_spread']:.0f}%"])
ws = sheet("Сводная (приоритет РФ)", head_m, rows_m, {1: 5, 2: 26, 3: 18, 4: 44, 5: 30, 6: 40, 7: 40, 8: 22, "freeze": 3})
for row, col, s_ in fills: ws.cell(row=row, column=col).fill = PatternFill("solid", fgColor=FILL[s_])
for col in range(9, 9 + len(KEYS)): ws.column_dimensions[get_column_letter(col)].width = 11
ws.row_dimensions[1].height = 48
ws2 = sheet("Откуда значения", ["№", "Продукт приложения"] + [HEAD[k] for k in KEYS], [[a, b] + rest for (a, b), rest in zip([(r[0], r[1]) for r in rows_m], [r[2:] for r in rows_s])], {1: 5, 2: 26, "freeze": 3})
for col in range(3, 3 + len(KEYS)): ws2.column_dimensions[get_column_letter(col)].width = 11
ws2.row_dimensions[1].height = 48
ws3 = sheet("Приложение сейчас", ["№", "Продукт приложения", "Источник значений в приложении"] + [HEAD[k] for k in KEYS], [[r[0], r[1], r[2]] + r[3:] for r in rows_a], {1: 5, 2: 26, 3: 22, "freeze": 3})
for col in range(4, 4 + len(KEYS)): ws3.column_dimensions[get_column_letter(col)].width = 11
ws3.row_dimensions[1].height = 48
sheet("Неоднозначные РФ", ["Продукт приложения", "Код в книге", "Название в книге", "Стр. PDF", "Энергия, ккал", "Белки, г", "Жиры, г", "Углеводы, г", "Примечание"], rows_amb, {1: 22, 2: 14, 3: 48, 4: 9, 9: 34, "freeze": 2})

# Все продукты
head_a = ["Источник", "Код", "Название", "Раздел/группа", "Группа приложения (если есть)", "Примечания"] + [HEAD[k] for k in KEYS]
rows_all = []
for r in ru_rows:
    notes = []
    if r.get("flags"): notes.append("энергия не сходится с БЖУ — не использована")
    if r.get("unreadable"): notes.append("не прочитано: " + ", ".join(r["unreadable"]))
    ck = r.get("check_portion2")
    if ck and ck.get("suspect"): notes.append("не взято (не сошлось со второй порцией): " + ", ".join(ck["suspect"]))
    if not ck: notes.append("без сверки по второй порции")
    if r.get("dup_code"): notes.append("повтор кода в OCR")
    v = ru_vals(r)
    rows_all.append(["РФ (Скурихин, Тутельян, 2002)", r["code"], r["name"], f"таблица {r.get('table') or '?'}, стр. PDF {r['page']}", "; ".join(member.get(("РФ", r["code"] + "|" + str(r["page"])), [])), "; ".join(notes)] + [v.get(k) for k in KEYS])
for c in cofid:
    v = cf_vals(c); top = cofid_top.get((c.get("group") or "?")[:1], "")
    rows_all.append(["CoFID 2021", c["code"], c.get("name"), f"{c.get('group')} {top}", "; ".join(member.get(("CoFID", c["code"] + "|" + (c.get("name") or "")), [])), (c.get("desc") or "") + ("; повтор кода в наборе" if c.get("dup_code") else "")] + [v.get(k) for k in KEYS])
for ndb, r in sr27.items():
    v = sr_vals(r)
    rows_all.append(["USDA SR27", ndb, r["long"], sr_group_name.get(r["group"], r["group"]), "; ".join(member.get(("SR27", ndb), [])), r.get("common") or ""] + [v.get(k) for k in KEYS])
wsA = sheet("Все продукты", head_a, rows_all, {1: 24, 2: 12, 3: 46, 4: 28, 5: 24, 6: 30, "freeze": 4})
for col in range(7, 7 + len(KEYS)): wsA.column_dimensions[get_column_letter(col)].width = 11
wsA.row_dimensions[1].height = 48

n_ru = sum(1 for g in groups if g["ru_ok"]); n_amb = sum(1 for g in groups if g["ru_all"] and not g["ru_ok"])
n_sr = sum(1 for g in groups if g["sr"]); n_cf = sum(1 for g in groups if g["cf"])
total = sum(cnt_src.values())
lines = [
    ["Сводная таблица состава продуктов: российский справочник 2002, USDA SR27, CoFID 2021 и приложение «Кухня»"],
    [""],
    ["Все значения — на 100 г съедобной части; показатели и единицы — как в приложении (31 показатель)."],
    ["Листы:"],
    ["• «Сводная (приоритет РФ)» — 260 продуктов приложения. По каждому показателю: российский справочник → SR27 → CoFID (первый источник, где значение есть). Цвет ячейки = источник: зелёный РФ, голубой SR27, оранжевый CoFID. Порядок источников — константа PRIORITY в tools/build-food-workbook.py."],
    ["• «Откуда значения» — источник каждого значения буквами."],
    ["• «Приложение сейчас» — значения compositionData.json (не менялись), для сравнения со сводной."],
    ["• «Неоднозначные РФ» — продукты, у которых в российском справочнике несколько разных строк (разные продукты под одним названием, разброс энергии больше 30% и больше трёх строк): значения РФ не использованы, выбор — вручную."],
    ["• «Все продукты» — все строки всех трёх источников в единых колонках; в колонке «Группа приложения» указано, к какому продукту приложения строка относится."],
    [""],
    ["Что внутри:"],
    [f"• Продуктов приложения: {len(groups)}; российский справочник использован у {n_ru}, неоднозначно у {n_amb}, нет совпадения у {len(groups) - n_ru - n_amb}; SR27 найден у {n_sr}; CoFID (надёжное совпадение по названию) у {n_cf}."],
    [f"• Значений в сводной: {total}; из РФ {cnt_src['РФ']}, из SR27 {cnt_src['SR27']}, из CoFID {cnt_src['CoFID']}."],
    [f"• «Все продукты»: РФ {len(ru_rows)} строк (из 1 074 найденных; 72 отброшены, см. russia-himsostav/README.md), CoFID {len(cofid)}, SR27 {len(sr27)}; всего {len(rows_all)}."],
    [""],
    ["Как сопоставлялись продукты и чего не стоит ждать:"],
    ["• Названия на трёх языках, общего кода нет. Ключ — продукт приложения: к нему SR27 привязан по коду NDB из tools/nutrition-map.jsonl, CoFID — по английскому названию (только надёжные совпадения: то же главное слово и состояние, однозначно), российский справочник — по русскому названию и состоянию (сырой/варёный/сушёный/консервы). Остальные продукты источников между собой не сопоставлялись."],
    ["• Если у продукта приложения в РФ несколько строк с близкой энергией (≤ 30%) или не больше трёх, берётся медиана по строкам."],
    ["• Определения показателей различаются (углеводы, клетчатка, витамин A, фолаты, ниацин) — см. comparison/COMPARISON.md, раздел 5. Значения разных источников в одной строке сводной — разные измерения разных продуктов, а не одна величина."],
    ["• Российский справочник — скан с распознанным текстом: примерно одно неверное значение на 250 в строках без сверки по второй порции (см. russia-himsostav/README.md). Пометки в колонке «Примечания» на листе «Все продукты»."],
    ["• Значения в приложении этой таблицей не изменялись."],
]
for ln in lines: about.append(ln)
about.column_dimensions["A"].width = 170
for row in about.iter_rows():
    for c in row: c.alignment = Alignment(wrap_text=True, vertical="top")
about["A1"].font = Font(bold=True, size=13)
wb.save(OUT)
print(f"сохранено {OUT}; сводных продуктов {len(groups)} (РФ используется {n_ru}, неоднозначно {n_amb}); значений из РФ {cnt_src['РФ']}, SR27 {cnt_src['SR27']}, CoFID {cnt_src['CoFID']}; строк в «Все продукты» {len(rows_all)}")
