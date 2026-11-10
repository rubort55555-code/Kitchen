// Состояние приложения и все действия с данными. Каждое действие сразу сохраняется в телефон.
import { POLICY_VERSION, type ConsentKind } from "./privacy";
import { removeMeasure, upsertMeasure, type Measure } from "./body";
import { useSyncExternalStore } from "react";
import * as db from "./db";
import type { CatalogItem, LogEntry, Meal, PlanEntry, Place, Product, Reason, Recipe, Settings, Unit } from "./types";
import { copyMeal, mealFromRecipe } from "./diary";
import { planFor } from "./nutrition";
import { DEFAULT_RULES } from "./exclusions";
import { norm, uid, ymd, addDays, daysLeft } from "./util";
import { findCatalog, setCatalog } from "./catalog";
import { mergeBase, staleBase } from "./baseSync";
import { fetchSite, isNative, SITE } from "./native";
import { convert } from "./units";

export interface State {
  ready: boolean;
  products: Product[];
  log: LogEntry[];
  recipes: Recipe[];
  /** Дневник питания: записи о съеденном. */
  meals: Meal[];
  settings: Settings;
  saveError: string | null;
  /** Идёт загрузка встроенной базы рецептов по частям. */
  baseLoading?: { done: number; total: number } | null;
  /** Когда собраны база рецептов и справочник, которые сейчас в телефоне (для «О приложении»). */
  contentAt?: { recipes?: number; catalog?: number };
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

let state: State = { ready: false, products: [], log: [], recipes: [], meals: [], settings: defaultSettings(), saveError: null };
const subs = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export const getState = () => state;
/** Подписка на любые изменения данных (для оформления и т. п.). */
export function subscribe(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
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
    const [products, log, recipes, meals, saved] = await Promise.all([
      db.getAll<Product>("products"), db.getAll<LogEntry>("log"), db.getAll<Recipe>("recipes"), db.getAll<Meal>("meals"), db.getKv<Partial<Settings>>("settings"),
    ]);
    const settings = { ...defaultSettings(), ...(saved || {}) };
    log.sort((a, b) => a.t - b.t);
    await applySavedCatalog();
    set({ ready: true, products, log, recipes, meals, settings });
    checkContent();
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

// ---------- проба сканера штрихкодов ----------
/** Записывает попытку сканирования (хранятся последние 50). */
export function logScan(e: Omit<import("./types").ScanEvent, "t">) {
  const scanLog = [...(state.settings.scanLog || []), { ...e, t: Date.now() }].slice(-50);
  setSettings({ scanLog });
}
/** Отмечает, что после скана кода продукт добавили. */
function markScanAdded(code: string) {
  const log = state.settings.scanLog || [];
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].code === code && !log[i].added) {
      return [...log.slice(0, i), { ...log[i], added: true }, ...log.slice(i + 1)];
    }
  }
  return log;
}

// ---------- продукты ----------
export interface NewProduct {
  name: string; qty: number; unit: Unit; place: Place; until: string | null; price: number; bought?: string;
  /** Штрихкод и данные о товаре — запоминаются, чтобы в следующий раз узнать товар сразу. */
  barcode?: string; off?: import("./off").OffProduct | null;
}

export function addProduct(p: NewProduct, reason: Reason = "bought"): Product {
  const it: Product = {
    id: uid(), name: p.name.trim(), qty: p.qty, initialQty: p.qty, unit: p.unit, place: p.place,
    bought: p.bought || ymd(), until: p.until, price: Math.max(0, p.price), opened: null, createdAt: Date.now(),
  };
  if (p.barcode) it.barcode = p.barcode;
  const entry = logEntry(it, reason, it.qty, it.price);
  const key = norm(it.name);
  const prev = state.settings.lastBuy[key];
  const lastBuy = { ...state.settings.lastBuy, [key]: { name: it.name, price: it.price, qty: it.qty, unit: it.unit, place: it.place, n: (prev?.n || 0) + 1, t: Date.now() } };
  const settings = { ...state.settings, lastBuy };
  if (p.barcode) {
    const old = state.settings.barcodes?.[p.barcode];
    settings.barcodes = { ...state.settings.barcodes, [p.barcode]: { name: it.name, off: p.off !== undefined ? p.off : old?.off, t: Date.now() } };
    settings.scanLog = markScanAdded(p.barcode);
  }
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
  let log = [...state.log];
  // Исправили цену — исправляем и запись «Куплено», иначе в статистике «съедено» окажется больше, чем «куплено»
  if (patch.price !== undefined && patch.price !== old.price) {
    const fixed = log.filter((e) => e.productId === id && e.reason === "bought").map((e) => ({ ...e, rub: Math.round(it.price * 100) / 100 }));
    if (fixed.length) {
      const byId = new Map(fixed.map((e) => [e.id, e]));
      log = log.map((e) => byId.get(e.id) || e);
      changes.push({ store: "log", put: fixed });
    }
  }
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
    // Продукт может идти в две строки рецепта (масло в тесто и на жарку): для отмены помним его только в исходном виде
    if (!before.some((b) => b.id === it.id)) before.push(it);
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
/** Копирует встроенные рецепты в память телефона. Каждый рецепт добавляется один раз:
 *  удалённые не возвращаются, правки и избранное не затираются. Новые рецепты в обновлениях подтягиваются сами,
 *  исправленные в базе — обновляются, если человек их не менял (см. baseSync.ts).
 *  Приложение из магазина берёт базу с сайта, если она там не старше встроенной: так рецепты обновляются у всех
 *  без выпуска новой версии приложения. Без интернета — встроенная база.
 *  База разбита на части (recipes.json — оглавление): части грузятся по очереди, приложение работает уже после первой;
 *  уже загруженные части (по отпечатку) повторно не читаются. */
let seeding = false, rerun = false, seedGen = 0;
export async function seedBase() {
  if (seeding) { rerun = true; return; }
  seeding = true;
  const gen = seedGen;
  const stale = () => gen !== seedGen; // данные заменили (восстановление из копии) — эту загрузку бросаем
  try {
    const resp = await fetch("./recipes.json");
    let index = resp.ok ? await resp.json() : null;
    let from = "./";
    if (isNative) {
      const site = await fetchSite<{ v?: number; at?: number }>("recipes.json");
      if (site && site.v === 2 && (site.at || 0) >= (index?.at || 0)) { index = site; from = SITE; }
    }
    if (!index) return;
    if (index.at) set({ contentAt: { ...state.contentAt, recipes: index.at } });
    // Старый формат — сразу весь список; новый — оглавление частей
    const parts: { f: string | null; h: string; n: number; data?: Recipe[] }[] = Array.isArray(index)
      ? [{ f: null, h: "", n: index.length, data: index }]
      : index && Array.isArray(index.parts) ? index.parts : [];
    if (!parts.length) return;
    // Рецепты, которых больше нет в базе, убираем (личное и то, что в меню, остаётся)
    if (!Array.isArray(index) && Array.isArray(index.ids) && index.ids.length && index.ids.length === index.total) {
      const sigs0 = (await db.getKv<Record<string, string>>("baseSigs")) || {};
      const keep = new Set(state.settings.plan.flatMap((e) => [e.recipeId, e.garnish?.id, e.side?.id, e.sweet?.id]).filter((x): x is string => !!x));
      const gone = staleBase(state.recipes, new Set<string>(index.ids), sigs0, keep);
      if (gone.length && !stale()) {
        await db.apply([{ store: "recipes", del: gone }]);
        const g = new Set(gone);
        set({ recipes: state.recipes.filter((r) => !g.has(r.id)) });
      }
    }
    const doneParts = new Set((await db.getKv<string[]>("baseParts")) || []);
    const todo = parts.filter((p) => !p.h || !doneParts.has(p.h));
    if (!todo.length) return;
    const seen = new Set((await db.getKv<string[]>("baseSeen")) || []);
    const sigs = (await db.getKv<Record<string, string>>("baseSigs")) || {};
    const total = parts.reduce((s, p) => s + p.n, 0);
    let loaded = parts.filter((p) => p.h && doneParts.has(p.h)).reduce((s, p) => s + p.n, 0);
    for (const p of todo) {
      if (todo.length > 1) set({ baseLoading: { done: loaded, total } });
      const pr = p.data ? null : await fetch(from + p.f, from === "./" ? undefined : { cache: "no-cache" });
      if (pr && !pr.ok) throw new Error("Часть базы не загрузилась: " + p.f);
      const base: Recipe[] = p.data || (await pr!.json());
      if (stale()) break;
      if (!Array.isArray(base)) continue;
      const { add, update } = mergeBase(base, new Map(state.recipes.map((r) => [r.id, r])), seen, sigs);
      if (add.length || update.length) {
        await db.apply([{ store: "recipes", put: [...add, ...update] }]);
        const upd = new Map(update.map((r) => [r.id, r]));
        set({ recipes: [...state.recipes.map((r) => upd.get(r.id) || r), ...add] });
      }
      base.forEach((r) => seen.add(r.id));
      await db.setKv("baseSeen", Array.from(seen));
      await db.setKv("baseSigs", sigs);
      if (p.h) { doneParts.add(p.h); await db.setKv("baseParts", Array.from(doneParts)); }
      loaded += p.n;
      if (stale()) break;
      // Пауза между частями — чтобы экран не подтормаживал
      await new Promise((ok) => setTimeout(ok, 30));
    }
  } catch (e) {
    // нет интернета при первом запуске — попробуем в следующий раз
    console.warn("База рецептов не загрузилась", e);
  } finally {
    seeding = false;
    if (state.baseLoading) set({ baseLoading: null });
    if (rerun) { rerun = false; seedBase(); }
  }
}

// ---------- справочник продуктов с сайта ----------
interface CatalogFile { v: number; at: number; h: string; items: CatalogItem[] }
const BUILT_AT = typeof __BUILT_AT__ !== "undefined" ? __BUILT_AT__ : 0;
const CATALOG_H = typeof __CATALOG_H__ !== "undefined" ? __CATALOG_H__ : "";

/** Справочник, скачанный раньше, — если он новее встроенного (после обновления приложения встроенный может оказаться новее). */
async function applySavedCatalog() {
  if (!isNative) return;
  try {
    const f = await db.getKv<CatalogFile>("catalog");
    if (f && f.at > BUILT_AT && f.h !== CATALOG_H) { setCatalog(f.items); set({ contentAt: { ...state.contentAt, catalog: f.at } }); }
  } catch (e) {
    console.warn("Сохранённый справочник не прочитался", e);
  }
}

/** Скачивает справочник с сайта, если он там новее того, что в телефоне. В браузере справочник и так с сайта. */
async function syncCatalog() {
  if (!isNative) return;
  const f = await fetchSite<CatalogFile>("catalog.json");
  if (!f || f.v !== 1 || !Array.isArray(f.items) || f.at <= Math.max(BUILT_AT, state.contentAt?.catalog || 0)) return;
  if (f.h === CATALOG_H) { await db.setKv("catalog", null); return; }
  await db.setKv("catalog", f);
  setCatalog(f.items);
  set({ contentAt: { ...state.contentAt, catalog: f.at } });
}

let checkedAt = 0;
/** Проверка обновлений рецептов и справочника: при запуске и когда приложение снова открывают (не чаще раза в час). */
export function checkContent() {
  if (Date.now() - checkedAt < 3600_000) return;
  checkedAt = Date.now();
  seedBase();
  syncCatalog().catch((e) => console.warn("Справочник не обновился", e));
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

// ---------- дневник питания ----------
/** Чей дневник открыт: выбранный член семьи, иначе первый, у кого есть расчёт норм. */
export function diaryWho(s: Settings = state.settings): string {
  const ok = (id?: string) => !!id && s.members.some((m) => m.id === id);
  if (ok(s.diaryWho)) return s.diaryWho!;
  const withPlan = s.members.find((m) => m.body && planFor(m.body));
  return (withPlan || s.members[0])?.id || "";
}
export const setDiaryWho = (id: string) => setSettings({ diaryWho: id });

/** Запоминает товар по штрихкоду (найденный в Open Food Facts или введённый вручную), чтобы в следующий раз узнать его сразу и без интернета. */
export function rememberBarcode(code: string, name: string, off: import("./off").OffProduct | null) {
  setSettings({ barcodes: { ...(state.settings.barcodes || {}), [code]: { name, off, t: Date.now() } } });
}

export function addMeals(list: Meal[]) {
  if (!list.length) return;
  set({ meals: [...state.meals, ...list] });
  persist(db.apply([{ store: "meals", put: list }]));
}
export function deleteMeals(ids: string[]) {
  if (!ids.length) return;
  const gone = new Set(ids);
  set({ meals: state.meals.filter((m) => !gone.has(m.id)) });
  persist(db.apply([{ store: "meals", del: ids }]));
}
export function updateMeal(id: string, patch: Partial<Meal>) {
  const old = state.meals.find((m) => m.id === id);
  if (!old) return;
  const m = { ...old, ...patch };
  set({ meals: state.meals.map((x) => (x.id === id ? m : x)) });
  persist(db.apply([{ store: "meals", put: [m] }]));
}
/** «Повторить вчера»: копирует записи одного человека с одного дня на другой. Возвращает, сколько записей добавлено. */
export function repeatDay(from: string, to: string, who?: string): Meal[] {
  const src = state.meals.filter((m) => m.date === from && (!who || !m.who || m.who === who));
  const copies = src.map((m) => copyMeal(m, to));
  addMeals(copies);
  return copies;
}
/** Вода за день одного человека, мл (ключ — «id человека|дата»). */
/** Записать замер члену семьи. Если это самая свежая дата, обновляет и текущие вес, талию, бёдра в профиле — нормы пересчитаются сами. */
export function addMeasure(who: string, m: Measure) {
  const list = upsertMeasure(state.settings.measures?.[who] || [], m);
  const measures = { ...(state.settings.measures || {}), [who]: list };
  const latest = list[list.length - 1];
  const members = state.settings.members.map((x) => {
    if (x.id !== who || !x.body || !latest || latest.date !== m.date) return x;
    return { ...x, body: { ...x.body, ...(latest.weight !== undefined ? { weight: latest.weight } : {}), ...(latest.waist !== undefined ? { waist: latest.waist } : {}), ...(latest.hips !== undefined ? { hips: latest.hips } : {}) } };
  });
  setSettings({ measures, members });
}
export function deleteMeasure(who: string, date: string) {
  setSettings({ measures: { ...(state.settings.measures || {}), [who]: removeMeasure(state.settings.measures?.[who] || [], date) } });
}
/** Человек увидел «Что нового». */
export function markNewsSeen(id: string) {
  if (state.settings.seenNews !== id) setSettings({ seenNews: id });
}
/** Согласие дано. */
export function giveConsent(k: ConsentKind) {
  setSettings({ consent: { ...(state.settings.consent || {}), [k]: { version: POLICY_VERSION, at: Date.now() } } });
}
/** Согласие отозвано. */
export function withdrawConsent(k: ConsentKind) {
  const c = { ...(state.settings.consent || {}) };
  delete c[k];
  setSettings({ consent: c });
}
/** Удалить введённые данные о теле и здоровье: профили, замеры, воду. Дневник питания (записи еды) остаётся. */
export function eraseHealthData() {
  setSettings({
    members: state.settings.members.map((m) => ({ ...m, body: undefined })),
    measures: undefined, water: undefined,
  });
}
const NO_MEASURES: Measure[] = []; // один и тот же пустой массив: иначе подписка на хранилище видит «новое значение» при каждой проверке
export const measuresOf = (who: string, s: Settings = state.settings): Measure[] => s.measures?.[who] || NO_MEASURES;

const waterKey = (who: string, date: string) => `${who}|${date}`;
export const waterOf = (date: string, s: Settings = state.settings, who: string = diaryWho(s)) => s.water?.[waterKey(who, date)] || 0;
export function addWater(date: string, ml: number, who: string = diaryWho()) {
  const next = Math.max(0, waterOf(date, state.settings, who) + ml);
  const water = { ...(state.settings.water || {}), [waterKey(who, date)]: next };
  if (!next) delete water[waterKey(who, date)];
  setSettings({ water });
}
/** Отметка «приготовили/съели» в меню записывает блюдо в дневник (порция человека из меню, по умолчанию 1); снятие отметки — убирает запись. */
export function syncPlanMeal(e: PlanEntry, done: boolean) {
  const mine = state.meals.filter((m) => m.planEntryId === e.id);
  if (!done) { deleteMeals(mine.map((m) => m.id)); return; }
  if (mine.length || !e.recipeId) return;
  const r = state.recipes.find((x) => x.id === e.recipeId);
  if (!r) return;
  const who = diaryWho();
  const servings = e.portions?.[who] ?? 1;
  const m = mealFromRecipe(r, servings, e.date, e.slot, who);
  // Гарнир идёт вместе с блюдом: порция та же
  const gr = e.garnish ? state.recipes.find((x) => x.id === e.garnish!.id) : undefined;
  const g = gr ? mealFromRecipe(gr, servings, e.date, e.slot, who) : null;
  addMeals([...(m ? [{ ...m, planEntryId: e.id }] : []), ...(g ? [{ ...g, planEntryId: e.id }] : [])]);
}

// ---------- копия данных ----------
export const BACKUP_APP = "kitchen-app";
export interface Backup { app: string; v: number; at: string; products: Product[]; log: LogEntry[]; recipes: Recipe[]; meals?: Meal[]; settings: Settings }

export function makeBackup(): Backup {
  return { app: BACKUP_APP, v: 1, at: new Date().toISOString(), products: state.products, log: state.log, meals: state.meals, recipes: state.recipes.filter((r) => r.source !== "base" || r.fav || r.note || r.photo || r.rating || r.history?.length), settings: state.settings };
}

/** Восстановление: replace — заменить всё; merge — добавить недостающее. */
export async function restore(b: Backup, mode: "replace" | "merge") {
  let products = b.products, log = b.log, recipes = b.recipes, meals = b.meals || [], settings = { ...defaultSettings(), ...b.settings };
  if (mode === "merge") {
    const mergeBy = <T extends { id: string }>(a: T[], c: T[]) => { const m = new Map(a.map((x) => [x.id, x])); c.forEach((x) => { if (!m.has(x.id)) m.set(x.id, x); }); return Array.from(m.values()); };
    products = mergeBy(state.products, b.products);
    log = mergeBy(state.log, b.log).sort((x, y) => x.t - y.t);
    recipes = mergeBy(state.recipes, b.recipes);
    meals = mergeBy(state.meals, b.meals || []);
    const byId = <T extends { id: string }>(a: T[] = [], c: T[] = []) => { const m = new Map(a.map((x) => [x.id, x])); c.forEach((x) => { if (!m.has(x.id)) m.set(x.id, x); }); return Array.from(m.values()); };
    settings = {
      ...state.settings,
      lastBuy: { ...b.settings.lastBuy, ...state.settings.lastBuy },
      shop: byId(state.settings.shop, b.settings.shop),
      plan: byId(state.settings.plan, b.settings.plan),
    };
  }
  seedGen++;
  // Служебные записи о базе рецептов: без них рецепты базы, которые человек удалил, вернулись бы после восстановления
  const kv: Record<string, unknown> = { settings };
  try {
    const seen = (await db.getKv<string[]>("baseSeen")) || [];
    if (mode === "merge") {
      // Рецепты остаются на месте — оставляем всё как было
      for (const k of ["baseSeen", "baseSigs", "baseParts", "catalog"]) { const v = await db.getKv<unknown>(k); if (v !== undefined && v !== null) kv[k] = v; }
    } else {
      // Рецепты заменяются копией (в ней только личное), остальная база загрузится заново — кроме удалённых человеком
      const had = new Set(state.recipes.map((r) => r.id));
      const deleted = seen.filter((id) => !had.has(id));
      if (deleted.length) kv.baseSeen = deleted;
      const cat = await db.getKv<unknown>("catalog");
      if (cat !== undefined && cat !== null) kv.catalog = cat;
    }
  } catch (e) {
    console.warn("Служебные записи о базе не прочитались", e);
  }
  await db.replaceAll({ products, log, recipes, meals, kv });
  set({ products, log, recipes, meals, settings });
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
