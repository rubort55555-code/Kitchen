// Правила оформления «по яркости» — отдельно, чтобы их можно было проверить без телефона (tests/theme.test.ts).

export type Theme = "light" | "dark" | "sun";

/** Пороги яркости (положение ползунка яркости, 0…1): ниже — тёмное, выше — «солнце». */
export const DARK_BELOW = 0.3;
export const SUN_FROM = 0.8;
/** Запас у порога, чтобы оформление не мигало, когда яркость колеблется около границы. */
const GAP = 0.04;

/** Какое оформление нужно при такой яркости. prev — текущее (для запаса у порогов). */
export function themeForBrightness(v: number, prev: Theme | null, sun = true): Theme {
  const top: Theme = sun ? "sun" : "light";
  let lo = DARK_BELOW, hi = SUN_FROM;
  if (prev === "dark") lo += GAP; // тёмное держится, пока не станет заметно светлее
  else if (prev === "sun") hi -= GAP; // «солнце» держится, пока не станет заметно темнее
  else if (prev === "light") { lo -= GAP; hi += GAP; }
  if (v < lo) return "dark";
  if (v >= hi) return top;
  return "light";
}
