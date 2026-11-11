# Нарезка источников состава продуктов на чанки (literature/food-composition-sources/<источник>/chunks).
# Для каждого документа свои чанки:
#   * PDF  -> по 10 страниц: partNN_pXX-YY.pdf (фрагмент оригинала) + .txt (текст слоя PDF, раскладка сохранена);
#   * CoFID (xlsx) -> по группам продуктов (первая буква кода группы): все листы 1.3–1.14 слиты по коду продукта, jsonl;
#   * USDA SR27 (ASCII) -> по группам продуктов: сокращённая таблица ABBREV + описание из FOOD_DES + бытовые меры из WEIGHT, jsonl.
# Исходные файлы лежат в <источник>/source/ и не меняются. Чанки без потерь: README.md каждого источника содержит проверку полноты.
# Запуск (из корня репозитория): python3 -I tools/chunk-food-sources.py
import json, os, re, subprocess, sys, zipfile, hashlib
from collections import OrderedDict, defaultdict
import openpyxl
from pypdf import PdfReader, PdfWriter

ROOT = os.path.join("literature", "food-composition-sources")
PAGES = 10

def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:40] or "x"

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()

def chunk_pdf(src, outdir, stem_prefix=""):
    os.makedirs(outdir, exist_ok=True)
    r = PdfReader(src); n = len(r.pages); rows = []; total_text = ""
    for k, a in enumerate(range(0, n, PAGES), 1):
        b = min(a + PAGES, n)
        name = f"{stem_prefix}part{k:02d}_p{a + 1:02d}-{b:02d}"
        w = PdfWriter()
        for i in range(a, b): w.add_page(r.pages[i])
        with open(os.path.join(outdir, name + ".pdf"), "wb") as f: w.write(f)
        txt = subprocess.run(["pdftotext", "-layout", "-f", str(a + 1), "-l", str(b), src, "-"], capture_output=True, text=True, check=True).stdout
        open(os.path.join(outdir, name + ".txt"), "w", encoding="utf-8").write(txt)
        rows.append((name, a + 1, b, len(txt))); total_text += txt
    whole = subprocess.run(["pdftotext", "-layout", src, "-"], capture_output=True, text=True, check=True).stdout
    return n, rows, total_text == whole

def num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return v
    s = str(v).strip()
    if s == "" or s == "\xa0": return None
    try: return float(s) if re.fullmatch(r"-?\d+(\.\d+)?([eE][-+]?\d+)?", s) else s
    except ValueError: return s

def cofid_groups(guide_txt):
    """Верхний уровень Appendix B: 'Cereals and cereal products   A'."""
    i = guide_txt.index("Appendix B: Food sub-group codes", guide_txt.index("Appendix B") + 200)
    top = OrderedDict()
    for line in guide_txt[i:].splitlines():
        m = re.match(r"^(\S.*?)\s{2,}([A-Z])$", line)
        if m: top[m.group(2)] = m.group(1).strip()
    return top

def chunk_cofid(xlsx, outdir, top):
    os.makedirs(outdir, exist_ok=True)
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    foods = OrderedDict(); schema = OrderedDict(); cells = 0; seq = None
    for ws in wb.worksheets:
        if not re.match(r"^1\.(2|3|4|5|6|7|8|9|10|11|12|13|14) ", ws.title): continue
        rows = list(ws.iter_rows(values_only=True))
        hdr, tag = rows[0], rows[1]
        cols = []
        for j in range(7, len(hdr)):
            h = (str(hdr[j]).strip() if hdr[j] is not None else "")
            t = (str(tag[j]).strip() if tag[j] is not None and str(tag[j]).strip() else "")
            if not h and not t: continue
            key = t or h
            m = re.search(r"\(([^()]*)\)\s*$", h)
            unit = m.group(1) if m else ""
            if key in schema and schema[key]["sheet"] != ws.title: key = key + "@" + ws.title.split()[0]
            schema.setdefault(key, {"name": h, "unit": unit, "sheet": ws.title})
            cols.append((j, key))
        body = [r for r in rows[3:] if r[0] is not None and str(r[0]).strip() != ""]
        codes = [str(r[0]).strip() for r in body]
        # строки во всех листах идут в одном порядке; в самом наборе код 13-669 стоит у двух разных продуктов, поэтому слияние по позиции строки, а не по коду
        if seq is None: seq = codes
        elif codes != seq: raise SystemExit(f"порядок кодов в листе {ws.title} не совпадает с первым листом")
        for pos, r in enumerate(body):
            code = codes[pos]
            f = foods.setdefault(pos, {"code": code, "n": OrderedDict()})
            if ws.title.startswith("1.3"):
                f.update({"name": r[1], "desc": r[2], "group": r[3], "prev": r[4], "refs": r[5], "footnote": r[6]})
            for j, key in cols:
                if j < len(r):
                    v = num(r[j])
                    if v is not None: f["n"][key] = v; cells += 1
    by = defaultdict(list)
    cnt = defaultdict(int)
    for f in foods.values(): cnt[f["code"]] += 1
    for f in foods.values():
        if cnt[f["code"]] > 1: f["dup_code"] = True
        by[(f.get("group") or "?")[:1]].append(f)
    index = []
    for g in sorted(by):
        fn = f"{g}_{slug(top.get(g, 'other'))}.jsonl"
        with open(os.path.join(outdir, fn), "w", encoding="utf-8") as fh:
            for f in by[g]: fh.write(json.dumps(f, ensure_ascii=False) + "\n")
        index.append((fn, g, top.get(g, "?"), len(by[g]), os.path.getsize(os.path.join(outdir, fn))))
    json.dump(schema, open(os.path.join(outdir, "_schema.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return len(foods), cells, index

def source_cells(xlsx):
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True); c = 0
    for ws in wb.worksheets:
        if not re.match(r"^1\.(2|3|4|5|6|7|8|9|10|11|12|13|14) ", ws.title): continue
        rows = list(ws.iter_rows(values_only=True))
        for r in rows[3:]:
            if r[0] is None or str(r[0]).strip() == "": continue
            for j in range(7, len(r)):
                hh = (rows[0][j] is not None and str(rows[0][j]).strip()) or (rows[1][j] is not None and str(rows[1][j]).strip())
                if hh and num(r[j]) is not None: c += 1
    return c

ABBR = "id desc water kcal prot fat ash carb fib sug ca fe mg p k na zn cu mn se vitc b1 b2 b3 b5 b6 folate folic foodfol b9dfe choline b12 vitaiu vita retinol acar bcar bcrypt lyco lutzea vite vitd vitdiu vitk satfat mufa pufa chol gw1 gd1 gw2 gd2 refuse".split()
ABBR_UNITS = dict(water="g", kcal="kcal", prot="g", fat="g", ash="g", carb="g", fib="g", sug="g", ca="mg", fe="mg", mg="mg", p="mg", k="mg", na="mg", zn="mg", cu="mg", mn="mg", se="µg", vitc="mg", b1="mg", b2="mg", b3="mg", b5="mg", b6="mg", folate="µg", folic="µg", foodfol="µg", b9dfe="µg DFE", choline="mg", b12="µg", vitaiu="IU", vita="µg RAE", retinol="µg", acar="µg", bcar="µg", bcrypt="µg", lyco="µg", lutzea="µg", vite="mg", vitd="µg", vitdiu="IU", vitk="µg", satfat="g", mufa="g", pufa="g", chol="mg", gw1="g", gw2="g", refuse="%")

def rd(zf, name):
    return zf.read(name).decode("latin-1").splitlines()

def fields(line):
    return [p.strip("~") for p in line.split("^")]

def chunk_sr27(zasc, zabbr, outdir):
    os.makedirs(outdir, exist_ok=True)
    za = zipfile.ZipFile(zasc); zb = zipfile.ZipFile(zabbr)
    groups = {f[0]: f[1] for f in map(fields, rd(za, "FD_GROUP.txt"))}
    des = {}
    for l in rd(za, "FOOD_DES.txt"):
        f = fields(l); des[f[0]] = dict(group=f[1], long=f[2], short=f[3], common=f[4], manuf=f[5], sci=f[8 + 2] if len(f) > 10 else "", refuse_desc=f[9] if len(f) > 9 else "", refuse=f[8] if len(f) > 8 else "")
    wts = defaultdict(list)
    for l in rd(za, "WEIGHT.txt"):
        f = fields(l)
        wts[f[0]].append({"seq": int(f[1]), "amount": float(f[2]), "desc": f[3], "gram_weight": float(f[4])})
    nutr_names = {}
    for l in rd(za, "NUTR_DEF.txt"):
        f = fields(l); nutr_names[f[0]] = {"units": f[1], "tag": f[2], "name": f[3]}
    by = defaultdict(list); n = 0
    for l in rd(zb, "ABBREV.txt"):
        parts = l.split("^")
        if len(parts) != len(ABBR): print("строка с неверным числом полей", len(parts)); sys.exit(1)
        r = {}
        for k, p in zip(ABBR, parts):
            v = p.strip("~")
            r[k] = None if v == "" else (float(v) if k not in ("id", "desc", "gd1", "gd2") and re.fullmatch(r"-?\d+(\.\d+)?([eE][-+]?\d+)?", v) else v)
        d = des[r["id"]]
        rec = {"ndb": r["id"], "group": d["group"], "name": r["desc"], "long": d["long"], "common": d["common"], "manuf": d["manuf"],
               "refuse_pct": r["refuse"], "refuse_desc": d["refuse_desc"],
               "n": {k: r[k] for k in ABBR[2:-5] if r[k] is not None},
               "measures": wts.get(r["id"], [])}
        by[d["group"]].append(rec); n += 1
    index = []
    for g in sorted(by):
        fn = f"{g}_{slug(groups[g])}.jsonl"
        with open(os.path.join(outdir, fn), "w", encoding="utf-8") as fh:
            for rec in by[g]: fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        index.append((fn, g, groups[g], len(by[g]), os.path.getsize(os.path.join(outdir, fn))))
    json.dump({"units": ABBR_UNITS, "nutr_def_full_table": nutr_names, "note": "n: ключи как в ABBREV.txt SR27, на 100 г съедобной части"},
              open(os.path.join(outdir, "_schema.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return n, len(des), index

def table(rows, head):
    return "| " + " | ".join(head) + " |\n|" + "---|" * len(head) + "\n" + "\n".join("| " + " | ".join(str(c) for c in r) + " |" for r in rows)

if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "pdf":
        # python3 -I tools/chunk-food-sources.py pdf <файл.pdf> <папка чанков> — нарезка одного PDF по 10 страниц (для книг без таблиц-xlsx, например российского справочника)
        n, rows, same = chunk_pdf(sys.argv[2], sys.argv[3])
        print(f"страниц {n}, чанков {len(rows)}, текст чанков = текст PDF: {same}, символов по чанкам: {[r[3] for r in rows]}")
        sys.exit(0)
    out = {}
    # CoFID
    c = os.path.join(ROOT, "cofid-2021"); s = os.path.join(c, "source")
    n, rows, same = chunk_pdf(os.path.join(s, "CoFID_2021_user_guide.pdf"), os.path.join(c, "chunks", "guide"))
    guide = subprocess.run(["pdftotext", "-layout", os.path.join(s, "CoFID_2021_user_guide.pdf"), "-"], capture_output=True, text=True).stdout
    top = cofid_groups(guide)
    res = {}
    for key, fn in (("main", "CoFID_2021_integrated_dataset.xlsx"), ("old", "CoFID_old_foods.xlsx")):
        d = os.path.join(c, "chunks", "foods" if key == "main" else "old-foods")
        nf, cells, idx = chunk_cofid(os.path.join(s, fn), d, top)
        res[key] = (nf, cells, source_cells(os.path.join(s, fn)), idx)
    out["cofid"] = dict(pdf_pages=n, pdf_rows=rows, pdf_same=same, top=top, res=res, sha={f: sha(os.path.join(s, f)) for f in os.listdir(s)})
    # SR27
    u = os.path.join(ROOT, "usda-sr27"); s = os.path.join(u, "source")
    n2, rows2, same2 = chunk_pdf(os.path.join(s, "sr27_doc.pdf"), os.path.join(u, "chunks", "doc"))
    nf, nd, idx = chunk_sr27(os.path.join(s, "sr27asc.zip"), os.path.join(s, "sr27abbr.zip"), os.path.join(u, "chunks", "foods"))
    out["sr27"] = dict(pdf_pages=n2, pdf_rows=rows2, pdf_same=same2, foods=nf, food_des=nd, idx=idx, sha={f: sha(os.path.join(s, f)) for f in os.listdir(s)})
    json.dump(out, open(os.path.join("/tmp", "chunk_report.json"), "w"), ensure_ascii=False, indent=1, default=str)
    print(json.dumps({"cofid_main": res["main"][:3], "cofid_old": res["old"][:3], "cofid_pdf": [n, same], "sr27": [nf, nd], "sr27_pdf": [n2, same2]}, ensure_ascii=False))
