// Сопоставление ингредиентов рецепта с продуктами дома.
import type { CatalogItem, Product, Recipe } from "./types";
import { findCatalog } from "./catalog";
import { norm, daysLeft } from "./util";
import { substitutes } from "./subs";

const stem = (w: string) => { const s = norm(w); return s.length > 4 ? s.slice(0, -2) : s; };

/** Ключ продукта: название из справочника или основа первого слова. */
export function keyOf(name: string, custom: CatalogItem[]): string {
  const c = findCatalog(name, custom);
  return c ? "c:" + norm(c.n) : "w:" + stem(norm(name).split(/[ ,(]/)[0]);
}

/** Все ключи, которые «закрывает» продукт: свой и базовый («Говяжья вырезка» закрывает и «Говядину»). */
export function keysFor(name: string, custom: CatalogItem[]): string[] {
  const c = findCatalog(name, custom);
  if (!c) return ["w:" + stem(norm(name).split(/[ ,(]/)[0])];
  const keys = ["c:" + norm(c.n)];
  // Цепочка вверх: «Шампиньоны белые» → «Шампиньоны» → «Грибы»
  let cur: CatalogItem | null = c;
  for (let i = 0; i < 3 && cur && cur.g; i++) {
    keys.push("c:" + norm(cur.g));
    cur = findCatalog(cur.g, custom);
  }
  return keys;
}

/** Подходит ли продукт (по названию) для ингредиента с ключом key. */
export const covers = (productName: string, key: string, custom: CatalogItem[]) => keysFor(productName, custom).includes(key);

export interface IngStatus {
  name: string; amount: string; have: boolean; basic: boolean; product?: Product; urgent: boolean;
  /** Нужного нет, но есть замена дома. */
  via?: Product;
  /** Чем можно заменить (если нужного нет дома, а замены тоже нет). */
  alts?: string[];
}

// Кэши: рецептов может быть больше 11 000, а пересчёт нужен при каждом открытии экрана.
// Склад и «базовые» продукты считаются один раз на набор продуктов; ключи ингредиентов — один раз на рецепт.
let stockMemo: { products: Product[]; custom: CatalogItem[]; stock: Map<string, Product> } | null = null;
let basicMemo: { basics: string[]; custom: CatalogItem[]; keys: Set<string> } | null = null;
const ingKeys = new WeakMap<Recipe, { custom: CatalogItem[]; keys: string[] }>();
const statusMemo = new WeakMap<Recipe, { stock: Map<string, Product>; basics: Set<string>; res: ReturnType<typeof calc> }>();

function stockOf(products: Product[], custom: CatalogItem[]) {
  if (stockMemo && stockMemo.products === products && stockMemo.custom === custom) return stockMemo.stock;
  const stock = new Map<string, Product>();
  for (const p of products) {
    // Продукт закрывает свой ключ и ключ базового продукта
    for (const k of keysFor(p.name, custom)) {
      const cur = stock.get(k);
      // Если продуктов несколько — берём тот, что испортится раньше
      if (!cur || (daysLeft(p.until) ?? 9999) < (daysLeft(cur.until) ?? 9999)) stock.set(k, p);
    }
  }
  stockMemo = { products, custom, stock };
  return stock;
}
function basicsOf(basics: string[], custom: CatalogItem[]) {
  if (basicMemo && basicMemo.basics === basics && basicMemo.custom === custom) return basicMemo.keys;
  const keys = new Set(basics.map((b) => keyOf(b, custom)));
  basicMemo = { basics, custom, keys };
  return keys;
}
function keysOf(r: Recipe, custom: CatalogItem[]) {
  const c = ingKeys.get(r);
  if (c && c.custom === custom) return c.keys;
  const keys = r.ingredients.map((i) => keyOf(i.name, custom));
  ingKeys.set(r, { custom, keys });
  return keys;
}

export function recipeStatus(r: Recipe, products: Product[], basics: string[], custom: CatalogItem[]) {
  const stock = stockOf(products, custom);
  const basicKeys = basicsOf(basics, custom);
  const m = statusMemo.get(r);
  if (m && m.stock === stock && m.basics === basicKeys) return m.res;
  const res = calc(r, stock, basicKeys, custom);
  statusMemo.set(r, { stock, basics: basicKeys, res });
  return res;
}

function calc(r: Recipe, stock: Map<string, Product>, basicKeys: Set<string>, custom: CatalogItem[]) {
  const keys = keysOf(r, custom);
  const list: IngStatus[] = r.ingredients.map((i, n) => {
    const k = keys[n];
    const basic = keysFor(i.name, custom).some((x) => basicKeys.has(x)) || /^вода|^соль|^перец по вкусу/.test(norm(i.name));
    const product = stock.get(k);
    let via: Product | undefined;
    let alts: string[] | undefined;
    if (!product && !basic) {
      const subs = substitutes(i.name, custom);
      for (const s of subs) { const f = stock.get(keyOf(s, custom)); if (f) { via = f; break; } }
      if (!via && subs.length) alts = subs;
    }
    const shown = product || via;
    const dl = shown ? daysLeft(shown.until) : null;
    return { name: i.name, amount: i.amount, have: !!shown || basic, basic, product, via, alts, urgent: dl !== null && dl <= 2 };
  });
  const need = list.filter((x) => !x.basic);
  const have = need.filter((x) => x.have).length;
  const percent = need.length ? Math.round((have / need.length) * 100) : 100;
  return { list, missing: need.filter((x) => !x.have), percent, urgent: list.filter((x) => x.urgent).length };
}
