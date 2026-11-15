// Календарная дата «ГГГГ-ММ-ДД» (по местному времени телефона) и действия с ней.

const p2 = (n: number) => String(n).padStart(2, "0");

/** Дата в формате ГГГГ-ММ-ДД. Без аргумента — сегодня (это единственное место, где домен знает про часы; в правилах не используйте). */
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
