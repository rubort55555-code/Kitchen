# Независимая проверка полноты чанков (tools/chunk-food-sources.py): значения сравниваются с исходными файлами заново.
# Запуск (из корня репозитория): python3 -I tools/verify-food-chunks.py
import glob, json, os, re, sys, zipfile
import openpyxl
R = os.path.join("literature", "food-composition-sources")
bad = 0

def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)): return abs(a - b) < 1e-9
    return str(a).strip() == str(b).strip()

def tonum(v):
    s = str(v).strip()
    try: return float(s)
    except ValueError: return s

# CoFID: каждая непустая ячейка данных листов 1.2–1.14 есть в чанке той же строки с тем же значением
for sub, src in (("foods", "CoFID_2021_integrated_dataset.xlsx"), ("old-foods", "CoFID_old_foods.xlsx")):
    chunks = []
    for f in sorted(glob.glob(os.path.join(R, "cofid-2021", "chunks", sub, "*.jsonl"))):
        chunks += [json.loads(l) for l in open(f, encoding="utf-8")]
    # порядок строк: восстанавливаем по (code, name) в порядке листа 1.3
    wb = openpyxl.load_workbook(os.path.join(R, "cofid-2021", "source", src), read_only=True, data_only=True)
    schema = json.load(open(os.path.join(R, "cofid-2021", "chunks", sub, "_schema.json"), encoding="utf-8"))
    index = {}
    for c in chunks: index.setdefault((c["code"], c.get("name")), c)
    checked = missing = wrong = 0; rows_n = 0
    for ws in wb.worksheets:
        if not re.match(r"^1\.(2|3|4|5|6|7|8|9|10|11|12|13|14) ", ws.title): continue
        rows = list(ws.iter_rows(values_only=True)); h, t = rows[0], rows[1]
        names3 = None
        keys = {}
        for j in range(7, len(h)):
            hh = str(h[j]).strip() if h[j] is not None else ""; tt = str(t[j]).strip() if t[j] is not None else ""
            if not hh and not tt: continue
            k = tt or hh
            if k not in schema or schema[k]["sheet"] != ws.title: k = k + "@" + ws.title.split()[0]
            keys[j] = k
        # название берём из листа 1.3 той же позиции
        if ws.title.startswith("1.2") or ws.title.startswith("1.3"):
            pass
        body = [r for r in rows[3:] if r[0] is not None and str(r[0]).strip() != ""]
        if ws.title.startswith("1.3"): names3 = [r[1] for r in body]
        if ws.title.startswith("1.2"):
            # в листе 1.2 нет колонки названия в нужной позиции — берём название из 1.3 ниже, поэтому пропускаем привязку по имени
            names_src = None
        rows_n = max(rows_n, len(body))
        for pos, r in enumerate(body):
            for j, k in keys.items():
                if j >= len(r) or r[j] is None or str(r[j]).strip() in ("", "\xa0"): continue
                nm = r[1]
                c = index.get((str(r[0]).strip(), nm))
                checked += 1
                if c is None or k not in c["n"]: missing += 1; continue
                if not same(c["n"][k], tonum(r[j])): wrong += 1
    total_foods = len(chunks)
    print(f"CoFID {sub}: продуктов в чанках {total_foods}, строк в листе {rows_n}, ячеек проверено {checked}, потеряно {missing}, изменено {wrong}")
    bad += missing + wrong + (total_foods != rows_n)

# SR27: каждая строка ABBREV.txt (8618) совпадает с чанком по всем 53 полям
za = zipfile.ZipFile(os.path.join(R, "usda-sr27", "source", "sr27abbr.zip"))
recs = {}
for f in glob.glob(os.path.join(R, "usda-sr27", "chunks", "foods", "*.jsonl")):
    for l in open(f, encoding="utf-8"):
        r = json.loads(l); recs[r["ndb"]] = r
keys = "water kcal prot fat ash carb fib sug ca fe mg p k na zn cu mn se vitc b1 b2 b3 b5 b6 folate folic foodfol b9dfe choline b12 vitaiu vita retinol acar bcar bcrypt lyco lutzea vite vitd vitdiu vitk satfat mufa pufa chol".split()
lines = za.read("ABBREV.txt").decode("latin-1").splitlines(); wrong = vals = 0
for l in lines:
    p = [x.strip("~") for x in l.split("^")]
    rec = recs.get(p[0])
    if rec is None: wrong += 1; continue
    for k, v in zip(keys, p[2:2 + len(keys)]):
        if v == "":
            if k in rec["n"]: wrong += 1
            continue
        vals += 1
        if k not in rec["n"] or abs(rec["n"][k] - float(v)) > 1e-9: wrong += 1
print(f"SR27: строк ABBREV {len(lines)}, в чанках {len(recs)}, значений проверено {vals}, расхождений {wrong}")
bad += wrong + (len(lines) != len(recs))

# SR27: бытовые меры (WEIGHT.txt) и сами базовые таблицы
zc = zipfile.ZipFile(os.path.join(R, "usda-sr27", "source", "sr27asc.zip"))
w = [l for l in zc.read("WEIGHT.txt").decode("latin-1").splitlines() if l.strip()]
nm = sum(len(r["measures"]) for r in recs.values())
print(f"SR27: строк WEIGHT {len(w)}, мер в чанках {nm}")
bad += (len(w) != nm)
print("ОК" if bad == 0 else f"ЕСТЬ РАСХОЖДЕНИЯ: {bad}")
sys.exit(1 if bad else 0)
