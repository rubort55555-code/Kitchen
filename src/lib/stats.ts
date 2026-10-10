// Подсчёты для главной: съедено / пропало за месяц (полная статистика — на этапе 3).
import type { LogEntry } from "./types";

export interface Summary { bought: number; eaten: number; lost: number; lostPct: number; lostCount: number }

export function monthStart(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function summary(log: LogEntry[], from: number, to = Infinity): Summary {
  let bought = 0, eaten = 0, lost = 0, lostCount = 0;
  for (const e of log) {
    if (e.t < from || e.t >= to) continue;
    if (e.reason === "bought") bought += e.rub;
    else if (e.reason === "eaten" || e.reason === "cooked") eaten += e.rub;
    else if (e.reason === "spoiled" || e.reason === "thrown") { lost += e.rub; lostCount++; }
  }
  const used = eaten + lost;
  return { bought, eaten, lost, lostCount, lostPct: used > 0 ? Math.round((lost / used) * 100) : 0 };
}
