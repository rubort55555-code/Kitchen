# Разбор таблиц «Химический состав российских пищевых продуктов» (под ред. Скурихина и Тутельяна, 2002) из распознанного слоя PDF.
# Книга — скан; колонки сдвигаются от страницы к странице, поэтому значения читаются по порядку в строке, а не по фиксированным позициям.
# Строка принимается ТОЛЬКО если: слева 12 чисел (порция + 11 колонок), справа 16 чисел (схема таблиц 1–12 без жиров и напитков),
# вода+белки+жиры+углеводы+клетчатка+кислоты+зола = 100 ± 3 г на 100 г порции и энергия (ЭЦ) сходится с БЖУ (± 12% или ± 10 ккал).
# Остальное записывается в rejected.jsonl с причиной, ничего не исправляется и не угадывается.
# Запуск (из корня репозитория): python3 -I tools/parse-russian-tables.py
import json, os, re, subprocess, sys
from collections import Counter

SRC = os.path.join("literature", "food-composition-sources", "russia-himsostav", "source", "Skurikhin_Tutelyan_2002_Khimicheskiy_sostav_rossiyskikh_pishchevykh_produktov.pdf")
OUT = os.path.join("literature", "food-composition-sources", "russia-himsostav", "chunks", "tables")
MACRO = ["water", "prot", "fat", "sfa", "chol", "mds", "starch", "carb", "fib", "org", "ash"]
MICRO = ["na", "k", "ca", "mg", "p", "fe", "vita", "carot", "re", "te", "b1", "b2", "pp", "ne", "vitc", "kcal"]
CODE = re.compile(r"^\d{1,2}(?:\.\d{1,3}){1,5}$")

def words(p):
    t = subprocess.run(["pdftotext", "-bbox", "-f", str(p), "-l", str(p), SRC, "-"], capture_output=True, text=True, check=True).stdout
    out = []
    for a, b, c, d, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', t):
        w = w.replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        out.append({"x0": float(a), "y": float(b), "x1": float(c), "y1": float(d), "xc": (float(a) + float(c)) / 2, "w": w})
    return out

def num(w):
    """Число из токена распознавания; None, если токен — не число. Запятая = точка; хвостовые знаки ' ! | отбрасываются; цифры не угадываются."""
    s = w.strip().strip("'!|`").replace(",", ".")
    if re.fullmatch(r"\d+(\.\d+)?", s): return float(s)
    return None

def noise(w):
    """Шум скана: знаки линий таблицы (нет ни цифр, ни букв) и одиночные символы на самом краю страницы (вкладка раздела на полях распознаётся как «1»)."""
    t = w["w"]
    if not re.search(r"[0-9A-Za-zА-Яа-я]", t): return True
    return len(t) == 1 and (w["x0"] > 527 or w["x1"] < 31)

def page_kind(ws):
    txt = " ".join(w["w"] for w in ws if w["y"] < 80)
    if "Вода" in txt and "Бел" in txt: return "macro"
    if re.search(r"\bNa\b", txt) and "Код" in txt: return "micro"
    if "Код" in txt and "Na" in txt: return "micro"
    return None

def lines_of(ws, tol=5):
    ws = sorted(ws, key=lambda w: (w["y"], w["x0"])); res = []
    for w in ws:
        if res and abs(res[-1][0] - w["y"]) <= tol: res[-1][1].append(w)
        else: res.append([w["y"], [w]])
    return [(y, sorted(l, key=lambda w: w["x0"])) for y, l in res]

def parse_macro(ws):
    """Возвращает [(code, name, [12 чисел] | None, y, причина)] для кодов-блюд (у заголовков разделов чисел нет)."""
    body = [w for w in ws if w["y"] > 70 and not noise(w)]
    codes = sorted([w for w in body if w["xc"] < 130 and CODE.match(w["w"])], key=lambda w: w["y"])
    rows = []
    for i, c in enumerate(codes):
        ln = [w for w in body if abs(w["y"] - c["y"]) <= 5 and w["x0"] > c["x1"]]
        nums = [(w, num(w["w"])) for w in sorted(ln, key=lambda w: w["x0"]) if num(w["w"]) is not None]
        if not nums: continue                       # заголовок раздела
        port = next((w for w, v in nums if v == 100), None)
        if port is None: rows.append((c["w"], "", None, c["y"], "нет порции 100 в строке кода")); continue
        vals = [v for w, v in nums if w["x0"] >= port["x0"] - 1]
        y_end = codes[i + 1]["y"] if i + 1 < len(codes) else 10 ** 6
        # заголовок раздела без чисел заканчивает блок (в нём нет цифр порции, но он не в списке «еда»); берём ближайший следующий код
        name_w = [w for w in body if c["y"] - 5 <= w["y"] < y_end - 5 and w["x1"] < port["x0"] - 6 and w["x0"] > c["x1"] and w["xc"] > 95]
        name = " ".join(w["w"] for w in sorted(name_w, key=lambda w: (round(w["y"] / 6), w["x0"])))
        rows.append((c["w"], re.sub(r"\s+", " ", name).strip(), vals, c["y"], None))
    return rows

def parse_micro(ws):
    body = [w for w in ws if w["y"] > 70 and not noise(w)]
    codes = [w for w in body if w["xc"] > 400 and CODE.match(w["w"])]
    res = {}
    for c in codes:
        ln = [w for w in body if abs(w["y"] - c["y"]) <= 5 and w["x1"] < c["x0"] - 2]
        toks = [w for w in sorted(ln, key=lambda w: w["x0"]) if num(w["w"]) is not None or len(w["w"].strip("'!|`")) > 2]   # одиночные буквы между числами — шум скана
        vals = [num(w["w"]) for w in toks]
        res[c["w"]] = (vals, [w["w"] for w in toks])
    return res

def main():
    os.makedirs(OUT, exist_ok=True)
    npages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", SRC], capture_output=True, text=True).stdout).group(1))
    cache = {}
    def W(p):
        if p not in cache: cache[p] = words(p)
        return cache[p]
    ok, bad, reasons = [], [], Counter()
    p = 1
    pairs = 0
    while p < npages:
        k = page_kind(W(p))
        if k == "macro" and p + 1 <= npages and page_kind(W(p + 1)) == "micro":
            pairs += 1
            macro = parse_macro(W(p)); micro = parse_micro(W(p + 1))
            for code, name, vals, y, why in macro:
                rec = {"code": code, "name": name, "page": p}
                if why: bad.append({**rec, "reason": why}); reasons[why] += 1; continue
                if len(vals) != 12 or vals[0] != 100:
                    r = f"слева {len(vals)} чисел вместо 12"; bad.append({**rec, "reason": r, "cells": vals}); reasons["слева не 12 чисел"] += 1; continue
                m = dict(zip(MACRO, vals[1:]))
                if code not in micro: bad.append({**rec, "reason": "нет строки справа"}); reasons["нет строки справа"] += 1; continue
                mv, raw = micro[code]
                if len(mv) != 16 or any(v is None for v in mv):
                    bad.append({**rec, "reason": f"справа {len(mv)} значений, из них нечисловых {sum(1 for v in mv if v is None)} (нужно 16 чисел)", "cells": raw}); reasons["справа не 16 чисел"] += 1; continue
                n = {**m, **dict(zip(MICRO, mv))}
                s = n["water"] + n["prot"] + n["fat"] + n["carb"] + n["fib"] + n["org"] + n["ash"]
                if abs(s - 100) > 3:
                    bad.append({**rec, "reason": f"сумма компонентов {s:.1f} вместо 100", "n": n}); reasons["сумма ≠ 100"] += 1; continue
                est = 4 * n["prot"] + 9 * n["fat"] + 4 * n["carb"] + 2 * n["fib"] + 3 * n["org"]
                if abs(est - n["kcal"]) > max(10, 0.12 * n["kcal"]) :
                    bad.append({**rec, "reason": f"энергия {n['kcal']} против {est:.0f} по БЖУ", "n": n}); reasons["энергия не сходится"] += 1; continue
                ok.append({**rec, "n": n})
            p += 2
        else:
            p += 1
    # коды-дубли среди принятых — не затираем
    cnt = Counter(r["code"] for r in ok)
    for r in ok:
        if cnt[r["code"]] > 1: r["dup_code"] = True
    with open(os.path.join(OUT, "foods_parsed.jsonl"), "w", encoding="utf-8") as f:
        for r in ok: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(os.path.join(OUT, "rejected.jsonl"), "w", encoding="utf-8") as f:
        for r in bad: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    json.dump({"macro_columns": MACRO, "micro_columns": MICRO, "units": "на 100 г; вода…зола, г; chol, na…fe, te, b1, b2, pp, ne, vitc — мг; vita, carot, re — мкг; kcal — ккал", "pairs": pairs, "accepted": len(ok), "rejected": len(bad), "reasons": dict(reasons)},
              open(os.path.join(OUT, "_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"пар страниц {pairs}; принято {len(ok)}; отброшено {len(bad)}; причины: {dict(reasons)}")

if __name__ == "__main__":
    main()
