// Список покупок: добавление, подсказки, минимальные запасы, «купил» → на склад.
import type { MinStock, Recipe, ShopItem, Unit } from "./types";
import { UNITS } from "./types";
import { addProduct, getState, haveQty, setSettings, valueOf } from "./store";
import { compileRules, checkProduct, type Hit } from "./exclusions";
import { findCatalog } from "./catalog";
import { keyOf, recipeStatus } from "./match";
import { norm, toNum, uid } from "./util";
import { qtyText } from "./units";

export const shopList = (): ShopItem[] => getState().settings.shop || [];
const save = (shop: ShopItem[]) => setSettings({ shop });

/** Разбирает «2 шт», «1,5 кг», «500г». Не поняли — null. */
export function parseAmount(text: string): { qty: number; unit: Unit } | null {
  const m = norm(text).match(/^(\d+(?:[.,]\d+)?)\s*([а-я]+)?\.?$/);
  if (!m) return null;
  const qty = toNum(m[1]);
  if (qty === null || qty <= 0) return null;
  const w = (m[2] || "шт").replace(/^упак.*|^пач.*/, "уп").replace(/^штук.*|^шт.*/, "шт").replace(/^грам.*|^гр$/, "г").replace(/^килогр.*/, "кг").replace(/^литр.*/, "л");
  const unit = UNITS.find((u) => u === w);
  return unit ? { qty, unit } : null;
}

/** Добавить в список. Если такой продукт уже есть и не куплен — не дублируем. */
export function addShop(name: string, amount = "", from?: string): boolean {
  const n = name.trim();
  if (!n) return false;
  const list = shopList();
  if (list.some((x) => !x.done && norm(x.name) === norm(n))) return false;
  save([...list, { id: uid(), name: n, amount: amount.trim(), done: false, from, createdAt: Date.now() }]);
  return true;
}

export function addMany(items: { name: string; amount: string }[], from?: string): number {
  const list = [...shopList()];
  let added = 0;
  for (const it of items) {
    if (!it.name.trim() || list.some((x) => !x.done && norm(x.name) === norm(it.name))) continue;
    list.push({ id: uid(), name: it.name.trim(), amount: it.amount.trim(), done: false, from, createdAt: Date.now() });
    added++;
  }
  if (added) save(list);
  return added;
}

export const toggleShop = (id: string) => save(shopList().map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
export const removeShop = (id: string) => save(shopList().filter((x) => x.id !== id));
export const restoreShop = (list: ShopItem[]) => save(list);
export const updateShop = (id: string, patch: Partial<ShopItem>) => save(shopList().map((x) => (x.id === id ? { ...x, ...patch } : x)));

export interface Hints {
  /** Сколько уже есть дома. */
  have: string | null;
  /** Доля пропавшего от купленного, если покупали хотя бы 3 раза. */
  loss: number | null;
  banned: Hit | null;
  /** Последняя цена. */
  price: number | null;
}

/** Подсказки к строке списка: есть дома, часто пропадает, запрещено, последняя цена. */
export function hintsFor(name: string): Hints {
  const st = getState();
  const k = keyOf(name, st.settings.customCatalog);
  const home = st.products.filter((p) => keyOf(p.name, st.settings.customCatalog) === k);
  const have = home.length ? home.map((p) => qtyText(p.qty, p.unit)).join(" + ") : null;
  let bought = 0, lost = 0;
  for (const e of st.log) {
    if (keyOf(e.name, st.settings.customCatalog) !== k) continue;
    if (e.reason === "bought") bought++;
    else if (e.reason === "spoiled" || e.reason === "thrown") lost++;
  }
  const compiled = compileRules(st.settings.rules, st.settings.customCatalog, st.settings.members);
  const banned = checkProduct(name, compiled, st.settings.members.map((m) => m.id));
  const lb = st.settings.lastBuy[norm(name)] || (findCatalog(name, st.settings.customCatalog) ? st.settings.lastBuy[norm(findCatalog(name, st.settings.customCatalog)!.n)] : undefined);
  return { have, loss: bought >= 3 ? lost / bought : null, banned: banned && banned.rule.level === "never" ? banned : null, price: lb ? lb.price : null };
}

/** Примерная сумма непокупленного по последним ценам. */
export function estimate(list: ShopItem[] = shopList()): { sum: number; known: number; total: number } {
  let sum = 0, known = 0;
  const open = list.filter((x) => !x.done);
  for (const x of open) {
    const h = hintsFor(x.name);
    if (h.price !== null) { sum += h.price; known++; }
  }
  return { sum, known, total: open.length };
}

/** Чего не хватает до минимальных запасов. */
export function belowMin(min: MinStock[] = getState().settings.minStock || []): { name: string; amount: string }[] {
  const out: { name: string; amount: string }[] = [];
  for (const m of min) {
    const have = haveQty(m.name, m.unit);
    if (have < m.qty) out.push({ name: m.name, amount: qtyText(m.qty - have, m.unit) });
  }
  return out;
}

/** Недостающее для нескольких рецептов (без базовых, без того, что есть, без запрещённого). */
export function missingFor(recipes: Recipe[]): { name: string; amount: string; for: string[] }[] {
  const st = getState();
  const compiled = compileRules(st.settings.rules, st.settings.customCatalog, st.settings.members);
  const who = st.settings.members.map((m) => m.id);
  const acc = new Map<string, { name: string; amounts: string[]; for: string[] }>();
  for (const r of recipes) {
    const s = recipeStatus(r, st.products, st.settings.basics, st.settings.customCatalog);
    for (const m of s.missing) {
      if (checkProduct(m.name, compiled, who)?.rule.level === "never") continue;
      const k = keyOf(m.name, st.settings.customCatalog);
      const cur = acc.get(k) || { name: m.name, amounts: [], for: [] };
      if (m.amount) cur.amounts.push(m.amount);
      cur.for.push(r.name);
      acc.set(k, cur);
    }
  }
  return Array.from(acc.values()).map((x) => ({ name: x.name, amount: sumAmounts(x.amounts), for: x.for }));
}

/** Складывает «200 г» + «300 г» = «500 г»; разные единицы — через «+». */
export function sumAmounts(list: string[]): string {
  const by = new Map<Unit, number>();
  const rest: string[] = [];
  for (const a of list) {
    const p = parseAmount(a.replace(/\s*·.*$/, ""));
    if (!p) { if (a.trim()) rest.push(a.trim()); continue; }
    const base: Unit = p.unit === "кг" ? "г" : p.unit === "л" ? "мл" : p.unit;
    const v = p.unit === "кг" || p.unit === "л" ? p.qty * 1000 : p.qty;
    by.set(base, (by.get(base) || 0) + v);
  }
  const parts = Array.from(by.entries()).map(([u, v]) => qtyText(v, u));
  return parts.concat(Array.from(new Set(rest))).join(" + ");
}

/** «Купил»: отмеченные строки → на склад с количеством и ценой. */
export interface BuyRow { id: string; name: string; qty: number; unit: Unit; price: number; place: import("./types").Place; until: string | null }
export function buy(rows: BuyRow[]): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    const p = addProduct({ name: r.name, qty: r.qty, unit: r.unit, place: r.place, until: r.until, price: r.price });
    ids.push(p.id);
  }
  const done = new Set(rows.map((r) => r.id));
  save(shopList().filter((x) => !done.has(x.id)));
  return ids;
}

/** Стоимость продуктов дома — для главной. */
export const homeValue = () => getState().products.reduce((s, p) => s + valueOf(p), 0);

/** Список текстом — чтобы отправить в мессенджер. */
export function shopText(list: ShopItem[] = shopList()): string {
  return list.filter((x) => !x.done).map((x) => "• " + x.name + (x.amount ? " — " + x.amount : "")).join("\n");
}
