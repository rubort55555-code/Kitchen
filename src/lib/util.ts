// Мелкие помощники: даты, деньги, числа, склонения.

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const p2 = (n: number) => String(n).padStart(2, "0");

/** Дата в формате ГГГГ-ММ-ДД по местному времени телефона. */
export function ymd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Сколько дней осталось до даты (0 — сегодня последний день, <0 — просрочено). */
export function daysLeft(until: string | null | undefined, today: string = ymd()): number | null {
  if (!until) return null;
  return Math.round((parseYmd(until).getTime() - parseYmd(today).getTime()) / 86400000);
}

export type Fresh = "ok" | "soon" | "bad" | "none";
/** Цветовая метка свежести: зелёный / жёлтый (истекает за 2 дня) / красный (просрочено). */
export function freshness(until: string | null | undefined): Fresh {
  const n = daysLeft(until);
  if (n === null) return "none";
  if (n < 0) return "bad";
  if (n <= 2) return "soon";
  return "ok";
}

export function untilText(until: string | null | undefined): string {
  const n = daysLeft(until);
  if (n === null) return "без срока";
  if (n < -1) return `просрочено ${-n} ${plural(-n, "день", "дня", "дней")} назад`;
  if (n === -1) return "просрочено вчера";
  if (n === 0) return "годен сегодня";
  if (n === 1) return "до завтра";
  return `ещё ${n} ${plural(n, "день", "дня", "дней")}`;
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export function dateText(s: string | null | undefined): string {
  if (!s) return "—";
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.round(n)) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const NBSP = " ";
/** Число по-русски: 1 250,5 */
export function num(n: number, digits = 2): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const [i, f] = Math.abs(r).toFixed(digits).replace(/\.?0+$/, "").split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (r < 0 ? "−" : "") + int + (f ? "," + f : "");
}

/** Деньги: «1 250 ₽». Копейки показываем только для сумм меньше 100 ₽. */
export function rub(n: number): string {
  const v = Math.abs(n) < 100 ? Math.round(n * 10) / 10 : Math.round(n);
  return num(v, 1) + NBSP + "₽";
}

/** Разбирает число, введённое с запятой или точкой. Пусто/мусор → null. */
export function toNum(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return isFinite(s) ? s : null;
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return isFinite(v) ? v : null;
}

/** Нормализация текста для сравнения: строчные, ё → е, лишние пробелы. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[«»"“”]/g, "").replace(/\s+/g, " ").trim();
}

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
