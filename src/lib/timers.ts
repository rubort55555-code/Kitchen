// Таймеры готовки. Живут, пока приложение открыто: на iPhone звук сработает только на открытом экране.
import { useSyncExternalStore } from "react";

export interface CookTimer { id: number; label: string; end: number; total: number; done: boolean }

let list: CookTimer[] = [];
let seq = 0;
let tick: ReturnType<typeof setInterval> | undefined;
let alarm: ReturnType<typeof setInterval> | undefined;
let ctx: AudioContext | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function useTimers(): CookTimer[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => list);
}

/** Звук можно включить только после нажатия пальцем — поэтому вызываем при запуске таймера. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
  } catch { /* звука нет — останется экран */ }
}

function beep() {
  try {
    if (!ctx) return;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      const t = ctx.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.22);
    }
  } catch { /* ничего */ }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* на iPhone не работает */ }
}

function loop() {
  const now = Date.now();
  let fired = false;
  list = list.map((t) => (!t.done && t.end <= now ? (fired = true, { ...t, done: true }) : t));
  if (fired) { beep(); if (!alarm) alarm = setInterval(() => { if (list.some((t) => t.done)) beep(); else stopAlarm(); }, 3000); }
  emit();
  if (!list.length) { clearInterval(tick); tick = undefined; }
}
function stopAlarm() { clearInterval(alarm); alarm = undefined; }

export function startTimer(label: string, seconds: number) {
  unlockAudio();
  list = [...list, { id: ++seq, label, end: Date.now() + seconds * 1000, total: seconds, done: false }];
  if (!tick) tick = setInterval(loop, 500);
  emit();
}
export function stopTimer(id: number) {
  list = list.filter((t) => t.id !== id);
  if (!list.some((t) => t.done)) stopAlarm();
  emit();
}
export function clearTimers() { list = []; stopAlarm(); emit(); }

/** Находит в тексте шага время: «15 минут», «1 час», «20–25 минут» (берём большее), «30 секунд». */
export function findTimes(step: string): { label: string; seconds: number }[] {
  const out: { label: string; seconds: number }[] = [];
  const re = /(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(секунд[а-я]*|сек\b|минут[а-я]*|мин\b|час[а-я]*|ч\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(step))) {
    const v = Number((m[2] ?? m[1]).replace(",", "."));
    const w = m[3].toLowerCase();
    const mult = w.startsWith("сек") ? 1 : w.startsWith("мин") ? 60 : 3600;
    const seconds = Math.round(v * mult);
    if (seconds >= 10 && seconds <= 12 * 3600) out.push({ label: m[0].trim(), seconds });
  }
  return out;
}

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(r).padStart(2, "0")}`;
};
