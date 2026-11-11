# Разбор таблиц «Химический состав российских пищевых продуктов» (под ред. Скурихина и Тутельяна, 2002) из распознанного слоя PDF.
# Книга — скан; колонки сдвигаются от страницы к странице, набор колонок зависит от таблицы (у жиров — 9 слева и 15 справа, у напитков — 17 справа).
# Проход 1 («строго»): число значений в строке равно числу колонок таблицы — значения читаются по порядку.
# Проход 2 («по колонкам»): если значений меньше или больше (в оригинале пустая клетка, лишний знак скана), каждое значение относится к ближайшей колонке
#   по положению на странице; положения колонок берутся из строк этой же страницы, принятых в проходе 1. Пустая клетка остаётся пустой (None), значения не придумываются.
# Принятие строки (оба прохода): вода, белки, жиры, углеводы, зола и энергия на месте; вода+белки+жиры+углеводы+волокна+кислоты+зола = 100 ± 1,5 г.
#   Энергия не сходится с БЖУ (± 12% или ± 10 ккал) — строка принимается с пометкой flags (энергию не использовать). Остальное — в rejected.jsonl с причиной.
# Проверка по второй порции: у многих продуктов вторая строка (200 г и т. п.) = первая × порция/100; не сошедшееся с допуском на округление значение не берётся (клетка пуста, в записи — suspect).
# Ручные поправки по скану: tools/russia-manual-corrections.json (страница + код → значения), подставляются поверх и проходят те же проверки.
# Запуск (из корня репозитория): python3 -I tools/parse-russian-tables.py
import json, os, re, statistics, subprocess
from collections import Counter, defaultdict

SRC = os.path.join("literature", "food-composition-sources", "russia-himsostav", "source", "Skurikhin_Tutelyan_2002_Khimicheskiy_sostav_rossiyskikh_pishchevykh_produktov.pdf")
OUT = os.path.join("literature", "food-composition-sources", "russia-himsostav", "chunks", "tables")
MACRO_STD = ["water", "prot", "fat", "sfa", "chol", "mds", "starch", "carb", "fib", "org", "ash"]
MACRO_FAT = ["water", "prot", "fat", "sfa", "pufa", "chol", "mds", "carb", "ash"]                      # таблица 5: жиры
MICRO_STD = ["na", "k", "ca", "mg", "p", "fe", "vita", "carot", "re", "te", "b1", "b2", "pp", "ne", "vitc", "kcal"]
MICRO_FAT = [c for c in MICRO_STD if c != "vitc"]                                                       # таблица 5: нет витамина C
MICRO_DRINK = MICRO_STD[:-1] + ["alc", "kcal"]                                                           # таблица 11: напитки, колонка «Алк»
CORE_MACRO = ["water", "prot", "fat", "carb", "ash"]
MANUAL_PATH = os.path.join("tools", "russia-manual-corrections.json")
MANUAL = {}
if os.path.exists(MANUAL_PATH):
    for r_ in json.load(open(MANUAL_PATH, encoding="utf-8"))["rows"]: MANUAL[(r_["page"], r_["code"])] = r_["values"]
CODE = re.compile(r"^\d{1,2}(?:\.\d{1,3}){1,5}$")

def words(p):
    t = subprocess.run(["pdftotext", "-bbox", "-f", str(p), "-l", str(p), SRC, "-"], capture_output=True, text=True, check=True).stdout
    out = []
    for a, b, c, d, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', t):
        w = w.replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        out.append({"x0": float(a), "y": float(b), "x1": float(c), "y1": float(d), "xc": (float(a) + float(c)) / 2, "w": w})
    return out

class Val(float):
    """Число со знаком после запятой: нужно для допуска округления при сверке строк порций."""
    dec = 0

def num(w):
    """Число из токена скана или None. Запятая = точка; хвостовые знаки ' ! | отбрасываются; «53,6(49,5–57,8)» → 53,6 (диапазон в скобках — не значение)."""
    s = w.strip().strip("'!|`").replace(",", ".")
    m = re.match(r"^(\d+(?:\.\d+)?)\(", s)
    if m: s = m.group(1)
    if re.fullmatch(r"\d+(\.\d+)?", s):
        v = Val(s); v.dec = len(s.split(".")[1]) if "." in s else 0
        return v
    return None

def noise(w):
    """Знаки линий таблицы, одиночные символы на краю страницы (вкладка раздела), хвосты диапазонов «(49,5–57,8)»."""
    t = w["w"]
    if not re.search(r"[0-9A-Za-zА-Яа-я]", t): return True
    if t.startswith("(") or (t.endswith(")") and "(" not in t): return True
    return len(t) == 1 and (w["x0"] > 527 or w["x1"] < 31)

def page_kind(ws):
    txt = " ".join(w["w"] for w in ws if w["y"] < 80)
    if "Вода" in txt and "Бел" in txt: return "macro"
    if "Код" in txt and "Na" in txt: return "micro"
    return None

def table_no(ws):
    t = " ".join(w["w"] for w in sorted([w for w in ws if w["y"] < 40], key=lambda w: w["x0"]))
    m = re.search(r"ТАБЛИЦА\s*(\d+)", t)
    return int(m.group(1)) if m else None

def raw_macro(ws):
    """[(code, name, [(xc, значение)], y, причина)] для всех кодов с числами в строке; порция должна быть 100 г."""
    body = [w for w in ws if w["y"] > 70 and not noise(w)]
    codes = sorted([w for w in body if w["xc"] < 130 and CODE.match(w["w"])], key=lambda w: w["y"])
    rows = []
    for i, c in enumerate(codes):
        ln = [w for w in body if abs(w["y"] - c["y"]) <= 5 and w["x0"] > c["x1"]]
        nums = [(w, num(w["w"])) for w in sorted(ln, key=lambda w: w["x0"]) if num(w["w"]) is not None]
        if len(nums) < 5: continue                  # заголовок раздела или строка без чисел
        y_end = codes[i + 1]["y"] if i + 1 < len(codes) else 10 ** 6
        # порция — первое допустимое значение, за которым идёт не меньше 8 чисел (цифры в названии, «Говядина 1 кат.», порцией не считаются)
        jp = next((j for j, (w, v) in enumerate(nums) if v in (50, 60, 65, 80, 100, 150, 200) and len(nums) - j - 1 >= 8 and w["xc"] < 260), None)
        port = nums[jp][0] if jp is not None else None
        name_x = (port["x0"] if port else min(w["x0"] for w, v in nums)) - 6
        name_w = [w for w in body if c["y"] - 5 <= w["y"] < y_end - 5 and w["x1"] < name_x and w["x0"] > c["x1"] and w["xc"] > 95]
        name = re.sub(r"\s+", " ", " ".join(w["w"] for w in sorted(name_w, key=lambda w: (round(w["y"] / 6), w["x0"])))).strip()
        if port is None: rows.append((c["w"], name, None, c["y"], "нет порции в строке (не прочиталась)", None)); continue
        if nums[jp][1] != 100: rows.append((c["w"], name, None, c["y"], f"порция {nums[jp][1]:g} г: значения на порцию, не на 100 г", None)); continue
        # вторая строка порции этого же продукта (например, 200 г): те же значения, умноженные на порцию/100 — независимая проверка первой строки
        second = None
        for y2 in sorted({round(w["y"]) for w in body if c["y"] + 8 < w["y"] < y_end - 6}):
            ln2 = sorted([w for w in body if abs(w["y"] - y2) <= 5 and w["x0"] > c["x1"]], key=lambda w: w["x0"])
            if any(w["w"].startswith("%") or "с.п" in w["w"] for w in ln2): continue          # строка «% суточной потребности», а не вторая порция
            n2 = [(w, num(w["w"])) for w in ln2 if num(w["w"]) is not None]
            q = next((j for j, (w, v) in enumerate(n2) if abs(w["xc"] - port["xc"]) <= 14 and v not in (100,) and len(n2) - j - 1 >= 5), None)
            if q is not None: second = (n2[q][1], [(w["xc"], v) for w, v in n2[q + 1:]]); break
        rows.append((c["w"], name, [(w["xc"], v) for w, v in nums[jp + 1:]], c["y"], None, second))
    return rows

LOOSE = re.compile(r"^[\dlIiOoОоЗз|.,]{3,}$")

def raw_micro_rows(ws):
    """Первые строки продуктов на правой странице: [(код как напечатан/распознан, y, [(xc, число | None-если-не-читается)])] в порядке сверху вниз."""
    body = [w for w in ws if w["y"] > 70 and not noise(w)]
    head = [w for w in ws if w["y"] < 80 and w["w"] == "Код"]
    kx = head[0]["xc"] if head else 490
    out = []
    for c in sorted([w for w in body if abs(w["xc"] - kx) <= 24 and re.search(r"\d", w["w"]) and re.search(r"[.,]", w["w"]) and LOOSE.match(w["w"])], key=lambda w: w["y"]):
        ln = [w for w in body if abs(w["y"] - c["y"]) <= 5 and w["x1"] < c["x0"] - 2]
        toks = [w for w in sorted(ln, key=lambda w: w["x0"]) if num(w["w"]) is not None or len(w["w"].strip("'!|`")) > 2]   # одиночные буквы между числами — шум
        if sum(1 for w in toks if num(w["w"]) is not None) < 8: continue            # заголовок раздела
        second = None
        for y2 in sorted({round(w["y"]) for w in body if c["y"] + 8 < w["y"] < c["y"] + 48}):
            ln2 = [w for w in sorted(body, key=lambda w: w["x0"]) if abs(w["y"] - y2) <= 5 and w["x1"] < kx + 40]
            if any(abs(w["xc"] - kx) <= 24 and re.search(r"[.,]", w["w"]) and LOOSE.match(w["w"]) and re.search(r"\d", w["w"]) for w in ln2): break      # уже следующий продукт
            t2 = [(w["xc"], num(w["w"])) for w in ln2 if num(w["w"]) is not None]
            if len(t2) >= 8: second = t2; break
        out.append((c["w"], c["y"], [(w["xc"], num(w["w"])) for w in toks], second))
    return out

def centers(samples):
    """samples: список строк [(xc, ...)] одинаковой длины → медианы по колонкам."""
    return [statistics.median(r[j][0] for r in samples) for j in range(len(samples[0]))]

def assign(cells, cent):
    """Значения → ближайшая колонка. Возвращает (значения по колонкам, число отброшенных знаков). Знак отбрасывается, если он дальше полуширины колонки
    или колонка уже занята более близким знаком. Нечитаемая клетка (None) занимает свою колонку и остаётся None."""
    half = max(min((cent[j + 1] - cent[j]) for j in range(len(cent) - 1)) * 0.5, 6)
    best = {}; dropped = 0
    for x, v in cells:
        j = min(range(len(cent)), key=lambda j: abs(cent[j] - x)); d = abs(cent[j] - x)
        if d > half: dropped += 1; continue
        if j in best:
            dropped += 1
            if d < best[j][0]: best[j] = (d, v)
        else: best[j] = (d, v)
    return [best[j][1] if j in best else None for j in range(len(cent))], dropped

def check(n, allow_sum=False):
    for k in CORE_MACRO + ["kcal"]:
        if n.get(k) is None: return f"нет значения «{k}»"
    g = lambda k: n.get(k) or 0
    s = g("water") + g("prot") + g("fat") + g("carb") + g("fib") + g("org") + g("ash") + g("alc")      # alc — спирт, г на 100 г (таблица 11)
    if not allow_sum and abs(s - 100) > 1.5: return f"сумма компонентов {s:.1f} вместо 100"
    return None

def energy_off(n):
    """True, если энергия справочника расходится с БЖУ (± 12% или ± 10 ккал): либо ошибка скана в энергии, либо собственные коэффициенты справочника. Сумма компонентов при этом верна."""
    g = lambda k: n.get(k) or 0
    est = 4 * g("prot") + 9 * g("fat") + 4 * g("carb") + 2 * g("fib") + 3 * g("org") + 7 * g("alc")
    return abs(est - n["kcal"]) > max(10, 0.12 * n["kcal"])

def main():
    os.makedirs(OUT, exist_ok=True)
    npages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", SRC], capture_output=True, text=True).stdout).group(1))
    cache = {}
    def W(p):
        if p not in cache: cache[p] = words(p)
        return cache[p]
    ok, bad, reasons = [], [], Counter()
    pairs = 0; last_table = None; p = 1
    while p < npages:
        if page_kind(W(p)) == "macro" and page_kind(W(p + 1)) == "micro":
            pairs += 1
            tn = table_no(W(p)) or last_table; last_table = tn
            macro = raw_macro(W(p)); mrows = raw_micro_rows(W(p + 1))
            bycode = {c: (cells, sec) for c, y, cells, sec in mrows}
            # сопоставление левой и правой строк: по коду; если коды испорчены — по порядку (только когда число строк слева и справа одинаково)
            pair = {}
            by_order = len(macro) == len(mrows)
            for i, (code, name, cells, y, why, sec) in enumerate(macro):
                if code in bycode: pair[i] = (bycode[code][0], "код", bycode[code][1])
                elif by_order: pair[i] = (mrows[i][2], "порядок", mrows[i][3])
            def strict_for(mcols, ucols):
                return {i for i, (code, name, cells, y, why, sec) in enumerate(macro) if not why and i in pair and pair[i][1] == "код" and len(cells) == len(mcols) and len(pair[i][0]) == len(ucols)}
            cands = [(MACRO_STD, MICRO_STD), (MACRO_FAT, MICRO_FAT), (MACRO_STD, MICRO_DRINK)]
            scored = [(len(strict_for(a_, b_)), -i) for i, (a_, b_) in enumerate(cands)]
            best = max(scored)
            if best[0] > 0: mcols, ucols = cands[-best[1]]
            else: mcols, ucols = (MACRO_FAT, MICRO_FAT) if tn == 5 else ((MACRO_STD, MICRO_DRINK) if tn == 11 else (MACRO_STD, MICRO_STD))
            strict = strict_for(mcols, ucols)
            cm = centers([macro[i][2] for i in sorted(strict)]) if strict else None
            cu = centers([pair[i][0] for i in sorted(strict)]) if strict else None
            for i, (code, name, cells, y, why, sec) in enumerate(macro):
                rec = {"code": code, "name": name, "page": p, "table": tn}
                mf = MANUAL.get((p, code))
                if mf and mf.get("full"):
                    # строка прочитана вручную целиком (все колонки): автоматический разбор не нужен
                    if mf.get("name"): rec["name"] = mf["name"]
                    port = float(mf.get("portion", 100))
                    n = {k: v for k, v in mf.items() if k not in ("full", "portion", "name", "allow_sum")}
                    if port != 100: n = {k: round(v * 100 / port, 3) for k, v in n.items()}
                    sum_note = mf.get("allow_sum")
                    why2 = check(n, allow_sum=bool(sum_note))
                    if why2: bad.append({**rec, "reason": why2 + " (строка прочитана вручную)", "n": n}); reasons["вручную: " + why2.split(" ")[0]] += 1; continue
                    flags = []
                    if port != 100: flags.append(f"значения книги даны на порцию {port:g} г, пересчитано на 100 г")
                    if sum_note: flags.append(sum_note)
                    if energy_off(n): flags.append("энергия не сходится с БЖУ (ккал не использовать без проверки по скану)")
                    ok.append({**rec, "method": "вручную по скану (строка целиком)", **({"flags": flags} if flags else {}), "manual": ["вся строка"], "n": n})
                    continue
                if why: bad.append({**rec, "reason": why}); reasons[why.split(":")[0].split(" (")[0].replace("порция 50 г", "порция не 100 г")] += 1; continue
                if i not in pair: bad.append({**rec, "reason": "нет строки справа (код не найден, число строк слева и справа разное)"}); reasons["нет строки справа"] += 1; continue
                mc, how, sec_u = pair[i]
                if len(strict) >= 1 and cm is not None:
                    mv, d1 = assign(cells, cm); uv, d2 = assign(mc, cu)
                    same_order = mv == [v for _, v in cells] and uv == [v for _, v in mc]
                    method = "строго" if (i in strict and not d1 and not d2 and same_order) else "по колонкам"
                else:
                    bad.append({**rec, "reason": "на странице нет строк для калибровки колонок", "cells": [v for _, v in cells]}); reasons["нет калибровки"] += 1; continue
                unread = [ucols[j] for j, v in enumerate(uv) if v is None and any(abs(cu[j] - x) <= max(min(cu[k + 1] - cu[k] for k in range(len(cu) - 1)) * 0.5, 6) and vv is None for x, vv in mc)]
                # независимая проверка: вторая строка порции (например, 200 г) = первая × порция/100 с допуском на округление; не сошедшееся значение считается сомнительным и не берётся
                suspect = []; matched = 0; port2 = None
                if sec:
                    port2 = float(sec[0]); r = port2 / 100
                    m2, _ = assign(sec[1], cm)
                    u2 = assign(sec_u, cu)[0] if sec_u else [None] * len(ucols)
                    for col, a1, a2 in list(zip(mcols, mv, m2)) + [(c_, a, b_) for c_, a, b_ in zip(ucols, uv, u2) if c_ != "alc"]:
                        if a1 is None or a2 is None: continue
                        tol = 0.5 * 10 ** -getattr(a1, "dec", 0) * r + 0.5 * 10 ** -getattr(a2, "dec", 0) + 0.02
                        if abs(float(a2) - float(a1) * r) > tol: suspect.append(col)
                        else: matched += 1
                    if suspect:
                        mv = [None if c_ in suspect else v for c_, v in zip(mcols, mv)]; uv = [None if c_ in suspect else v for c_, v in zip(ucols, uv)]
                n = dict(zip(mcols, mv)); n.update(dict(zip(ucols, uv)))
                manual = MANUAL.get((p, code), {})
                if manual:                                   # значения, прочитанные вручную по скану: ставятся поверх, сомнительные по второй порции снимаются
                    n.update(manual); suspect = [c_ for c_ in suspect if c_ not in manual]; unread = [c_ for c_ in unread if c_ not in manual]
                why2 = check(n)
                if why2: bad.append({**rec, "reason": why2 + (f" (сомнительные значения по второй порции: {suspect})" if suspect else ""), "n": n}); reasons[why2.split(" ")[0] + (" ≠ 100" if why2.startswith("сумма") else "")] += 1; continue
                extra = {}
                if energy_off(n): extra["flags"] = ["энергия не сходится с БЖУ (ккал не использовать без проверки по скану)"]
                if how == "порядок": extra["pair"] = "по порядку строк (код справа не распознан)"
                if d1 or d2: extra["dropped_marks"] = d1 + d2
                if unread: extra["unreadable"] = unread
                if manual: extra["manual"] = sorted(manual)
                if port2: extra["check_portion2"] = {"portion": port2, "matched": matched, "suspect": suspect}
                ok.append({**rec, "method": method, **extra, "n": {k: v for k, v in n.items() if v is not None}})
            p += 2
        else:
            p += 1
    cnt = Counter(r["code"] for r in ok)
    for r in ok:
        if cnt[r["code"]] > 1: r["dup_code"] = True
    with open(os.path.join(OUT, "foods_parsed.jsonl"), "w", encoding="utf-8") as f:
        for r in ok: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(os.path.join(OUT, "rejected.jsonl"), "w", encoding="utf-8") as f:
        for r in bad: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    meth = Counter(r["method"] for r in ok)
    json.dump({"macro_columns": {"таблицы 1–4, 6–12": MACRO_STD, "таблица 5": MACRO_FAT}, "micro_columns": {"таблицы 1–4, 6–10, 12": MICRO_STD, "таблица 5": MICRO_FAT, "таблица 11": MICRO_DRINK},
               "units": "на 100 г; вода…зола, г; chol, na…fe, te, b1, b2, pp, ne, vitc — мг; vita, carot, re — мкг; alc — %; kcal — ккал",
               "pairs": pairs, "accepted": len(ok), "accepted_by_method": dict(meth), "rejected": len(bad), "reasons": dict(reasons)},
              open(os.path.join(OUT, "_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"пар страниц {pairs}; принято {len(ok)} {dict(meth)}; отброшено {len(bad)}; причины: {dict(reasons)}")

if __name__ == "__main__":
    main()
