// Оформление: светлое, тёмное и «солнце» (контрастное для яркого света).
// Режимы: как в телефоне, по яркости экрана (только в приложении для Android/iPhone), всегда светлое, всегда тёмное.
import { registerPlugin } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import { isNative } from "./native";
import { getState, subscribe } from "./store";
import type { Appearance } from "./types";

import { themeForBrightness, type Theme } from "./themeRules";
export { DARK_BELOW, SUN_FROM, themeForBrightness, type Theme } from "./themeRules";

/** Яркость экрана из приложения (Android/iPhone). В браузере её узнать нельзя. */
const Brightness = registerPlugin<{ get(): Promise<{ value: number }> }>("Brightness");
export const brightnessSupported = isNative;

const THEME_COLOR: Record<Theme, string> = { light: "#F7F3EC", dark: "#141A16", sun: "#FFFFFF" };
const KEY = "kitchen-theme";

let current: Theme | null = null;
let brightness: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function apply(t: Theme) {
  if (t === current) return;
  current = t;
  const root = document.documentElement;
  root.dataset.theme = t;
  root.style.colorScheme = t === "dark" ? "dark" : "light";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[t]));
  try { localStorage.setItem(KEY, t); } catch { /* приватный режим */ }
  emit();
}

const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
const systemTheme = (): Theme => (media?.matches ? "dark" : "light");

function mode(): Appearance {
  const a = getState().settings.appearance || "system";
  return a === "brightness" && !brightnessSupported ? "system" : a;
}

let timer: ReturnType<typeof setInterval> | null = null;
let pending: Theme | null = null;

async function readBrightness() {
  try {
    const { value } = await Brightness.get();
    if (typeof value !== "number" || !isFinite(value)) return;
    brightness = Math.min(1, Math.max(0, value));
    emit();
    if (mode() !== "brightness") return;
    const want = themeForBrightness(brightness, current, getState().settings.sunContrast !== false);
    // Меняем оформление, только если новая яркость продержалась две проверки подряд (~4 секунды)
    if (want === current) pending = null;
    else if (pending === want || current === null) { pending = null; apply(want); }
    else pending = want;
  } catch {
    /* старая версия приложения без модуля яркости — оставляем как есть */
  }
}

function refresh() {
  const m = mode();
  if (m === "light" || m === "dark") apply(m);
  else if (m === "system") apply(systemTheme());
  const poll = m === "brightness" && document.visibilityState === "visible";
  if (poll && !timer) { readBrightness(); timer = setInterval(readBrightness, 2000); }
  if (!poll && timer) { clearInterval(timer); timer = null; pending = null; }
}

/** Включить оформление: вызывается один раз при запуске. */
export function startTheme() {
  let last = "";
  subscribe(() => {
    const s = getState().settings;
    const key = (s.appearance || "system") + (s.sunContrast === false ? "-" : "+");
    if (key !== last) { last = key; pending = null; if (timer) readBrightness(); refresh(); }
  });
  media?.addEventListener?.("change", refresh);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && mode() === "brightness") readBrightness(); refresh(); });
  refresh();
}

/** Текущее оформление и яркость (для экрана «Оформление»). */
export function useTheme(): { theme: Theme | null; brightness: number | null } {
  const theme = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => current);
  const b = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => brightness);
  return { theme, brightness: b };
}
