// Состояние приложения и все действия с данными. Каждое действие сразу сохраняется в телефон.
import { useSyncExternalStore } from "react";
import * as db from "./db";
import type { LogEntry, Place, Product, Reason, Recipe, Settings, Unit } from "./types";
import { DEFAULT_RULES } from "./exclusions";
import { norm, uid, ymd, addDays, daysLeft } from "./util";
import { findCatalog } from "./catalog";
import { convert } from "./units";

export interface State {
  ready: boolean;
  products: Product[];
  log: LogEntry[];
  recipes: Recipe[];
  settings: Settings;
  saveError: string | null;
}

export function defaultSettings(): Settings {
  return {
    members: [
      { id: "m1", name: "Я", allergies: [], dislikes: [] },
      { id: "m2", name: "Второй", allergies: [], dislikes: [] },
    ],
    rules: DEFAULT_RULES.map((r) => ({ ...r, words: [...r.words], except: r.except ? [...r.except] : undefined })),
    basics: ["соль", "перец чёрный", "сахар", "вода", "масло подсолнечное", "масло растительное"],
    lastBackup: 0,
    tipsSeen: [],
    customCatalog: [],
    lastBuy: {},
    shop: [],
    minStock: [{ name: "Яйца", qty: 10, unit: "шт" }],
    plan: [],
    planSlots: ["обед", "ужин"],
  };
}

let state: State = { ready: false, products: [], log: [], recipes: [], settings: defaultSettings(), saveError: null };
const subs = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export const getState = () => state;
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => sel(state));
}

/** Сохранение с понятным сообщением об ошибке. */
async function persist(p: Promise<void>) {
  try {
    await p;
    if (state.saveError) set({ saveError: null });
  } catch (e) {
    reportError(e);
    set({ saveError: "Не удалось сохранить изменения на телефоне. Сделайте копию данных (⚙︎ Ещё → Данные)." });
  }
}

export async function load() {
  try {
    const [products, log, recipes, saved] = await Promise.all([
      db.getAll<Product>("products"), db.getAll<LogEntry>("log"), db.getAll<Recipe>("recipes"), db.getKv<Partial<Settings>>("settings"),
    ]);
    const settings = { ...defaultSettings(), ...(saved || {}) };
    log.sort((a, b) => a.t - b.t);
    set({ ready: true, products, log, recipes, settings });
    seedBase();
  } catch (e) {
    reportError(e);
    set({ ready: true, saveError: "Не получилось открыть данные на телефоне. Попробуйте закрыть и снова открыть приложение." });
  }
  db.askPersist();
}

// ---------- настройки ----------
export function setSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  persist(db.setKv("settings", settings));
}

// ---------- продукты ----------
export interface NewProduct {
  name: string; qty: number; unit: Unit; place: Place; until: string | null; price: number; bought?: string;
}

export function addProduct(p: NewProduct, reason: Reason = "bought"): Product {
  const it: Product = {
    id: uid(), name: p.name.trim(), qty: p.qty, initialQty: p.qty, unit: p.unit, place: p.place,
    bought: p.bought || ymd(), until: p.until, price: Math.max(0, p.price), opened: null, createdAt: Date.now(),
  };
  const entry = logEntry(it, reason, it.qty, it.price);
  const key = norm(it.name);
  const prev = state.settings.lastBuy[key];
  const lastBuy = { ...state.settings.lastBuy, [key]: { name: it.name, price: it.price, qty: it.qty, unit: it.unit, place: it.place, n: (prev?.n || 0) + 1, t: Date.now() } };
  const settings = { ...state.settings, lastBuy };
  set({ products: [...state.products, it], log: [...state.log, entry], settings });
  persist(Promise.all([db.apply([{ store: "products", put: [it] }, { store: "log", put: [entry] }]), db.setKv("settings", settings)]).then(() => {}));
  return it;
}

function logEntry(it: Product, reason: Reason, qty: number, rub: number, dish?: string): LogEntry {
  const e: LogEntry = { id: uid(), t: Date.now(), productId: it.id, name: it.name, reason, qty: round(qty), unit: it.unit, rub: Math.round(rub * 100) / 100, place: it.place };
  if (dish) e.dish = dish;
  return e;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Стоимость остатка продукта. */
export function valueOf(it: Product): number {
  if (!it.initialQty) return 0;
  return (it.price * it.qty) / it.initialQty;
}

export function updateProduct(id: string, patch: Partial<Product>) {
  const old = state.products.find((x) => x.id === id);
  if (!old) return;
  const it = { ...old, ...patch };
  const changes: db.Change[] = [{ store: "products", put: [it] }];
  const log = [...state.log];
  // Исправили количество вручную — записываем в журнал как «Исправлено» (в статистику потерь не идёт).
  if (patch.qty !== undefined && patch.qty !== old.qty) {
    const e = logEntry(it, "adjust", it.qty - old.qty, 0);
    log.push(e); changes.push({ store: "log", put: [e] });
    if (it.qty > it.initialQty) it.initialQty = it.qty;
  }
  set({ products: state.products.map((x) => (x.id === id ? it : x)), log });
  persist(db.apply(changes));
}

export interface Undo { product: Product; logId: string; existed: boolean }

/** Списание: съели / пропало / выбросили. Можно частично. Возвращает данные для отмены. */
export function writeOff(id: string, qty: number, reason: Reason, dish?: string): Undo | null {
  const it = state.products.find((x) => x.id === id);
  if (!it || qty <= 0) return null;
  const take = Math.min(qty, it.qty);
  const rub = it.initialQty ? (it.price * take) / it.initialQty : 0;
  const e = logEntry(it, reason, take, rub, dish);
  const left = round(it.qty - take);
  const changes: db.Change[] = [{ store: "log", put: [e] }];
  let products: Product[];
  if (left <= 0) {
    products = state.products.filter((x) => x.id !== id);
    changes.push({ store: "products", del: [id] });
  } else {
    const upd = { ...it, qty: left };
    products = state.products.map((x) => (x.id === id ? upd : x));
    changes.push({ store: "products", put: [upd] });
  }
  set({ products, log: [...state.log, e] });
  persist(db.apply(changes));
  return { product: it, logId: e.id, existed: true };
}

export function undoWriteOff(u: Undo) {
  const exists = state.products.some((x) => x.id === u.product.id);
  const products = exists ? state.products.map((x) => (x.id === u.product.id ? u.product : x)) : [...state.products, u.product];
  set({ products, log: state.log.filter((x) => x.id !== u.logId) });
  persist(db.apply([{ store: "products", put: [u.product] }, { store: "log", del: [u.logId] }]));
}

export interface CookUndo { before: Product[]; logIds: string[]; leftoverId?: string }

/**
 * «Приготовили»: списывает все продукты одним действием, в журнал — причина «Приготовлено» и название блюда.
 * leftFrac — какая доля блюда осталась на потом: её стоимость пока не считаем «съеденной»,
 * она переходит в продукт «Остатки: …» и попадёт в статистику, когда остатки съедят или выбросят.
 */
export function applyCook(takes: { productId: string; take: number }[], dish: string, leftFrac = 0, leftover?: { qty: number; days: number; price: number }): CookUndo {
  let products = state.products;
  const before: Product[] = [];
  const logs: LogEntry[] = [];
  const changes: db.Change[] = [];
  for (const t of takes) {
    const it = products.find((x) => x.id === t.productId);
    if (!it || !(t.take > 0)) continue;
    const take = Math.min(t.take, it.qty);
    const full = it.initialQty ? (it.price * take) / it.initialQty : 0;
    logs.push(logEntry(it, "cooked", take, full * (1 - leftFrac), dish));
    before.push(it);
    const left = round(it.qty - take);
    if (left <= 0) {
      products = products.filter((x) => x.id !== it.id);
      changes.push({ store: "products", del: [it.id] });
    } else {
      const upd = { ...it, qty: left };
      products = products.map((x) => (x.id === it.id ? upd : x));
      changes.push({ store: "products", put: [upd] });
    }
  }
  let leftoverId: string | undefined;
  if (leftover && leftover.qty > 0) {
    const it: Product = {
      id: uid(), name: `Остатки: ${dish}`, qty: leftover.qty, initialQty: leftover.qty, unit: "шт", place: "Холодильник",
      bought: ymd(), until: addDays(ymd(), leftover.days), price: Math.max(0, Math.round(leftover.price * 100) / 100), opened: null, createdAt: Date.now(),
    };
    // «Исправлено» не считается ни покупкой, ни потерей: деньги уже учтены в приготовленных продуктах
    logs.push(logEntry(it, "adjust", it.qty, it.price, dish));
    products = [...products, it];
    changes.push({ store: "products", put: [it] });
    leftoverId = it.id;
  }
  if (logs.length) changes.push({ store: "log", put: logs });
  set({ products, log: [...state.log, ...logs] });
  persist(db.apply(changes));
  return { before, logIds: logs.map((l) => l.id), leftoverId };
}

export function undoCook(u: CookUndo) {
  const gone = new Set(u.logIds);
  let products = state.products.filter((x) => x.id !== u.leftoverId);
  for (const b of u.before) products = products.some((x) => x.id === b.id) ? products.map((x) => (x.id === b.id ? b : x)) : [...products, b];
  set({ products, log: state.log.filter((x) => !gone.has(x.id)) });
  const changes: db.Change[] = [{ store: "products", put: u.before }, { store: "log", del: u.logIds }];
  if (u.leftoverId) changes.push({ store: "products", del: [u.leftoverId] });
  persist(db.apply(changes));
}

/** Удалить продукт, добавленный по ошибке: убираем и запись «Куплено». */
export function deleteProduct(id: string) {
  const bought = state.log.filter((x) => x.productId === id && x.reason === "bought").map((x) => x.id);
  set({ products: state.products.filter((x) => x.id !== id), log: state.log.filter((x) => !bought.includes(x.id)) });
  persist(db.apply([{ store: "products", del: [id] }, { store: "log", del: bought }]));
}

/** Вскрыли упаковку: срок становится короче (по справочнику). */
export function openPackage(id: string) {
  const it = state.products.find((x) => x.id === id);
  if (!it) return;
  const cat = findCatalog(it.name, state.settings.customCatalog);
  const today = ymd();
  let until = it.until;
  if (cat?.o) {
    const byOpen = addDays(today, cat.o);
    if (!until || (daysLeft(byOpen)! < (daysLeft(until) ?? 99999))) until = byOpen;
  }
  updateProduct(id, { opened: today, until });
}

/** Сколько этого продукта есть дома (с пересчётом единиц). */
export function haveQty(name: string, unit: Unit): number {
  const key = norm(name);
  let sum = 0;
  for (const p of state.products) {
    if (norm(p.name) !== key) continue;
    const c = convert(p.qty, p.unit, unit);
    if (c !== null) sum += c;
  }
  return sum;
}

/** Частые продукты: сначала те, что покупали чаще и недавно. */
// ---------- встроенная база рецептов ----------
/** Копирует рецепты из recipes.json в память телефона. Каждый рецепт добавляется один раз:
 *  удалённые не возвращаются, правки и избранное не затираются. Новые рецепты в обновлениях подтягиваются сами. */
export async function seedBase() {
  try {
    const resp = await fetch("./recipes.json");
    if (!resp.ok) return;
    const base = (await resp.json()) as Recipe[];
    if (!Array.isArray(base) || !base.length) return;
    const seen = new Set((await db.getKv<string[]>("baseSeen")) || []);
    const have = new Set(state.recipes.map((r) => r.id));
    const add = base.filter((r) => !seen.has(r.id) && !have.has(r.id)).map((r) => ({ ...r, createdAt: 0 }));
    const all = Array.from(new Set([...seen, ...base.map((r) => r.id)]));
    if (add.length) {
      await db.apply([{ store: "recipes", put: add }]);
      set({ recipes: [...state.recipes, ...add] });
    }
    if (all.length !== seen.size) await db.setKv("baseSeen", all);
  } catch (e) {
    // нет интернета при первом запуске — попробуем в следующий раз
    console.warn("База рецептов не загрузилась", e);
  }
}

export function frequentNames(s: Settings = state.settings): string[] {
  return Object.entries(s.lastBuy)
    .sort((a, b) => b[1].n - a[1].n || b[1].t - a[1].t)
    .map(([key, v]) => v.name || key)
    .slice(0, 12);
}

// ---------- рецепты ----------
export function saveRecipes(list: Recipe[]) {
  const byId = new Map(state.recipes.map((r) => [r.id, r]));
  list.forEach((r) => byId.set(r.id, r));
  set({ recipes: Array.from(byId.values()) });
  persist(db.apply([{ store: "recipes", put: list }]));
}
export function deleteRecipe(id: string) {
  set({ recipes: state.recipes.filter((r) => r.id !== id) });
  persist(db.apply([{ store: "recipes", del: [id] }]));
}

// ---------- копия данных ----------
export const BACKUP_APP = "kitchen-app";
export interface Backup { app: string; v: number; at: string; products: Product[]; log: LogEntry[]; recipes: Recipe[]; settings: Settings }

export function makeBackup(): Backup {
  return { app: BACKUP_APP, v: 1, at: new Date().toISOString(), products: state.products, log: state.log, recipes: state.recipes.filter((r) => r.source !== "base" || r.fav || r.note), settings: state.settings };
}

/** Восстановление: replace — заменить всё; merge — добавить недостающее. */
export async function restore(b: Backup, mode: "replace" | "merge") {
  let products = b.products, log = b.log, recipes = b.recipes, settings = { ...defaultSettings(), ...b.settings };
  if (mode === "merge") {
    const mergeBy = <T extends { id: string }>(a: T[], c: T[]) => { const m = new Map(a.map((x) => [x.id, x])); c.forEach((x) => { if (!m.has(x.id)) m.set(x.id, x); }); return Array.from(m.values()); };
    products = mergeBy(state.products, b.products);
    log = mergeBy(state.log, b.log).sort((x, y) => x.t - y.t);
    recipes = mergeBy(state.recipes, b.recipes);
    const byId = <T extends { id: string }>(a: T[] = [], c: T[] = []) => { const m = new Map(a.map((x) => [x.id, x])); c.forEach((x) => { if (!m.has(x.id)) m.set(x.id, x); }); return Array.from(m.values()); };
    settings = {
      ...state.settings,
      lastBuy: { ...b.settings.lastBuy, ...state.settings.lastBuy },
      shop: byId(state.settings.shop, b.settings.shop),
      plan: byId(state.settings.plan, b.settings.plan),
    };
  }
  await db.replaceAll({ products, log, recipes, kv: { settings } });
  set({ products, log, recipes, settings });
  seedBase();
}

export function markBackup() {
  setSettings({ lastBackup: Date.now() });
}

export function markTip(id: string) {
  if (state.settings.tipsSeen.includes(id)) return;
  setSettings({ tipsSeen: [...state.settings.tipsSeen, id] });
}

// ---------- ошибки для кнопки «Что-то не работает» ----------
export function reportError(e: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  try { localStorage.setItem("kitchen-last-error", JSON.stringify({ msg, t: new Date().toISOString() })); } catch { /* нет места */ }
  console.error(e);
}
