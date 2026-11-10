// Журнал замеров: вес, талия, бёдра по датам; тренд и геометрия графика. Чистая логика, без доступа к хранилищу.
export interface Measure { date: string; weight?: number; waist?: number; hips?: number }
export type MeasureKey = "weight" | "waist" | "hips";

export const LIMITS: Record<MeasureKey, [number, number]> = { weight: [20, 400], waist: [40, 250], hips: [50, 250] };
export const MEASURE_TITLE: Record<MeasureKey, string> = { weight: "Вес, кг", waist: "Талия, см", hips: "Бёдра, см" };

const r1 = (x: number) => Math.round(x * 10) / 10;
const DAY = 86400000;
const t = (d: string) => new Date(d + "T12:00:00Z").getTime();

/** Замер за дату: заменяет существующий той же даты (поля дополняются), пустые и вне допустимых границ значения отбрасываются. null — нечего сохранять. */
export function cleanMeasure(m: Measure): Measure | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return null;
  const out: Measure = { date: m.date };
  for (const k of ["weight", "waist", "hips"] as MeasureKey[]) {
    const v = m[k];
    if (typeof v === "number" && isFinite(v) && v >= LIMITS[k][0] && v <= LIMITS[k][1]) out[k] = r1(v);
  }
  return out.weight === undefined && out.waist === undefined && out.hips === undefined ? null : out;
}

export function upsertMeasure(list: Measure[], m: Measure): Measure[] {
  const c = cleanMeasure(m);
  if (!c) return list;
  const prev = list.find((x) => x.date === c.date);
  const merged = { ...(prev || {}), ...c };
  return [...list.filter((x) => x.date !== c.date), merged].sort((a, b) => a.date.localeCompare(b.date));
}

export const removeMeasure = (list: Measure[], date: string) => list.filter((x) => x.date !== date);

export interface Point { date: string; v: number }
export const seriesOf = (list: Measure[], k: MeasureKey): Point[] =>
  list.filter((x) => typeof x[k] === "number").map((x) => ({ date: x.date, v: x[k] as number }));

/** Изменение в неделю по прямой через замеры последних `days` дней (метод наименьших квадратов). Нужно ≥ 3 замеров за ≥ 7 дней, иначе null — по двум точкам тренд не считаем (вес колеблется на 1–2 кг в течение дня и недели). */
export function trendPerWeek(points: Point[], days = 28): number | null {
  if (!points.length) return null;
  const end = t(points[points.length - 1].date);
  const p = points.filter((x) => end - t(x.date) <= days * DAY);
  if (p.length < 3 || end - t(p[0].date) < 7 * DAY) return null;
  const xs = p.map((x) => (t(x.date) - t(p[0].date)) / DAY);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = p.reduce((s, x) => s + x.v, 0) / p.length;
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (!den) return null;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (p[i].v - my), 0) / den; // за сутки
  return r1(slope * 7);
}

/** Изменение между последним замером и ближайшим не позже чем `days` дней назад (или самым ранним, если история короче). null — одного замера мало. */
export function changeOver(points: Point[], days: number): { from: Point; to: Point; delta: number } | null {
  if (points.length < 2) return null;
  const to = points[points.length - 1];
  const cut = t(to.date) - days * DAY;
  const from = [...points].reverse().find((x, i) => i > 0 && t(x.date) <= cut) || points[0];
  if (from === to) return null;
  return { from, to, delta: r1(to.v - from.v) };
}

export interface Chart { path: string; dots: { x: number; y: number; date: string; v: number }[]; min: number; max: number }
/** Точки и линия графика в области w×h с полями pad. Ось Y подгоняется к данным с запасом, при одинаковых значениях строится плоская линия. */
export function chartOf(points: Point[], w: number, h: number, pad = 8): Chart | null {
  if (!points.length) return null;
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const span = Math.max(hi - lo, 1);
  lo -= span * 0.15; hi += span * 0.15;
  const t0 = t(points[0].date), t1 = t(points[points.length - 1].date);
  const dots = points.map((p) => ({
    x: r1(points.length === 1 || t1 === t0 ? w / 2 : pad + ((t(p.date) - t0) / (t1 - t0)) * (w - 2 * pad)),
    y: r1(h - pad - ((p.v - lo) / (hi - lo)) * (h - 2 * pad)),
    date: p.date, v: p.v,
  }));
  return { path: dots.map((d, i) => `${i ? "L" : "M"}${d.x} ${d.y}`).join(" "), dots, min: Math.min(...vs), max: Math.max(...vs) };
}
