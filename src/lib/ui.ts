// Состояние интерфейса: вкладка, открытые окна, всплывающее сообщение.
import { useSyncExternalStore } from "react";
import type { Screen } from "./help";

export type Tab = "home" | "products" | "recipes" | "shop" | "more";
export type Page = null | "family" | "rules" | "catalog" | "data" | "help" | "bug" | "about";
export type Sheet =
  | { kind: "add" }
  | { kind: "product"; id: string }
  | { kind: "help"; screen: Screen; section?: string }
  | { kind: "ask"; week?: string }
  | { kind: "pick"; date: string; slot: import("./types").Slot }
  | { kind: "buy" }
  | { kind: "recipe"; id: string }
  | { kind: "cook"; id: string; entry?: string }
  | { kind: "steps"; id: string };

export interface Toast { id: number; text: string; undo?: () => void }
interface UI { tab: Tab; page: Page; sheets: Sheet[]; toast: Toast | null; update: (() => void) | null; recipesView: "list" | "menu" }

let ui: UI = { tab: "home", page: null, sheets: [], toast: null, update: null, recipesView: "list" };
const subs = new Set<() => void>();
function set(p: Partial<UI>) { ui = { ...ui, ...p }; subs.forEach((f) => f()); }
export function useUI<T>(sel: (u: UI) => T): T {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => sel(ui));
}

// Повторное нажатие на «Ещё» возвращает в меню (как в приложениях iOS)
export const goTab = (tab: Tab) => { set({ tab, page: tab === "more" && ui.tab !== "more" ? ui.page : null }); window.scrollTo(0, 0); };
export const setRecipesView = (v: "list" | "menu") => set({ recipesView: v });
export const goMenu = () => { set({ tab: "recipes", page: null, recipesView: "menu", sheets: [] }); window.scrollTo(0, 0); };
export const goPage = (page: Page) => { set({ tab: "more", page }); window.scrollTo(0, 0); };
export const openSheet = (s: Sheet) => set({ sheets: [...ui.sheets, s] });
export const closeSheet = () => set({ sheets: ui.sheets.slice(0, -1) });
export const closeAll = () => set({ sheets: [] });
export const setUpdate = (fn: (() => void) | null) => set({ update: fn });

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
/** Сообщение внизу экрана; с undo — кнопка «Отменить» (7 секунд). */
export function toast(text: string, undo?: () => void) {
  clearTimeout(timer);
  const t = { id: ++seq, text, undo };
  set({ toast: t });
  timer = setTimeout(() => { if (ui.toast?.id === t.id) set({ toast: null }); }, undo ? 7000 : 3500);
}
export const hideToast = () => { clearTimeout(timer); set({ toast: null }); };

/** Текущий экран — для значка «?». */
export function currentScreen(u: UI = ui): Screen {
  if (u.tab === "more" && u.page) return u.page === "bug" || u.page === "about" ? "more" : u.page;
  if (u.tab === "recipes" && u.recipesView === "menu") return "menu";
  return u.tab;
}
