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

export interface IngStatus {
  name: string; amount: string; have: boolean; basic: boolean; product?: Product; urgent: boolean;
  /** Нужного нет, но есть замена дома. */
  via?: Product;
  /** Чем можно заменить (если нужного нет дома, а замены тоже нет). */
  alts?: string[];
}

export function recipeStatus(r: Recipe, products: Product[], basics: string[], custom: CatalogItem[]) {
  const stock = new Map<string, Product>();
  for (const p of products) {
    const k = keyOf(p.name, custom);
    const cur = stock.get(k);
    // Если продуктов несколько — берём тот, что испортится раньше
    if (!cur || (daysLeft(p.until) ?? 9999) < (daysLeft(cur.until) ?? 9999)) stock.set(k, p);
  }
  const basicKeys = new Set(basics.map((b) => keyOf(b, custom)));
  const list: IngStatus[] = r.ingredients.map((i) => {
    const k = keyOf(i.name, custom);
    const basic = basicKeys.has(k) || /^вода|^соль|^перец по вкусу/.test(norm(i.name));
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
