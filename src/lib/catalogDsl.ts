// Помощники для описания справочника продуктов.
// Один продукт — одна строка:  «Название ; синоним ; синоним > Базовый продукт | параметры»
//   «> Базовый продукт» — продукт закрывает в рецепте и базовый («Говяжья вырезка» → «Говядина»).
//   параметры (через пробел): e=значок  u=единица  p=Х|М|Ш (место)  d=холодильник/морозилка/шкаф (дни, «-» нет, 0 не важно)
//                              o=дней после вскрытия  t=тип рыбы (white_sea | red | river | other_sea)
import type { CatalogItem, FishType, Place, Unit } from "./types";

export type D = [number | null, number | null, number | null];
export const F: Place = "Холодильник", Z: Place = "Морозилка", S: Place = "Шкаф";

export function c(n: string, cat: string, e: string, u: Unit, p: Place, d: D, o?: number, s?: string[], f?: FishType): CatalogItem {
  const it: CatalogItem = { n, c: cat, e, u, p, d };
  if (o) it.o = o;
  if (s) it.s = s;
  if (f) it.f = f;
  return it;
}

const PLACE: Record<string, Place> = { "Х": F, "М": Z, "Ш": S };
const days = (s: string): D => {
  const a = s.split("/");
  return [0, 1, 2].map((i) => (a[i] === undefined || a[i] === "-" ? null : Number(a[i]))) as D;
};

/** Группа продуктов с общими значком, единицей, местом и сроками. */
export function block(cat: string, e: string, u: Unit, p: Place, d: D, items: string[], o?: number): CatalogItem[] {
  return items.map((line) => {
    const [head, ...optParts] = line.split("|");
    const opts = optParts.join(" ");
    const [names, group] = head.split(">");
    const [n, ...syn] = names.split(";").map((x) => x.trim()).filter(Boolean);
    let ee = e, uu = u, pp = p, dd = d, oo = o, tt: FishType | undefined;
    for (const tok of opts.trim().split(/\s+/).filter(Boolean)) {
      const i = tok.indexOf("=");
      const k = tok.slice(0, i), v = tok.slice(i + 1);
      if (k === "e") ee = v;
      else if (k === "u") uu = v as Unit;
      else if (k === "p") pp = PLACE[v] || p;
      else if (k === "d") dd = days(v);
      else if (k === "o") oo = Number(v);
      else if (k === "t") tt = v as FishType;
    }
    const it = c(n, cat, ee, uu, pp, dd, oo, syn.length ? syn : undefined, tt);
    if (group && group.trim()) it.g = group.trim();
    return it;
  });
}
