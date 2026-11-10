// Подстройка цели раз в две недели: сравниваем реальный тренд веса с тем, что заложено в плане, и предлагаем небольшую поправку к калорийности.
// Приложение только предлагает: поправка применяется по нажатию. Пороги — эвристика приложения (степень C): в РКИ скорость снижения веса сама по себе
// на последующий набор почти не влияла (Vink 2016, n = 57), в мета-регрессии (Turicchi 2019, 43 исследования, n = 2379) быстрое снижение и потеря
// безжировой массы связаны с набором обратно, поэтому предел скорости оставлен прежним — не больше 20% расхода и 750 ккал в день (см. planFor).
import { ADJUST_MAX, hasHealthFlag, type BodyProfile, type Plan } from "./nutrition";
import { seriesOf, trendPerWeek, type Measure } from "./body";

export const CHECK_DAYS = 14;
const DAY = 86400000;
const t = (d: string) => new Date(d + "T12:00:00Z").getTime();
// Дата по местному времени телефона — как у замеров и даты проверки (иначе ночью «сегодня» отстаёт на день)
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const r50 = (x: number) => Math.round(x / 50) * 50;
const f1 = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");

export type CheckStatus = "skip" | "need-data" | "too-soon" | "on-track" | "stalled" | "too-fast" | "drift";
export interface GoalCheck {
  status: CheckStatus;
  text: string;
  /** Предлагаемое изменение калорийности, ккал в день (0 — менять не нужно). */
  delta: number;
  trend: number | null;
  /** Какая скорость заложена в плане, кг в неделю. */
  planned: number;
}

const res = (status: CheckStatus, text: string, delta = 0, trend: number | null = null, planned = 0): GoalCheck => ({ status, text, delta, trend, planned });

/** Проверка цели. `now` — для тестов. */
export function goalCheck(p: BodyProfile, plan: Plan, measures: Measure[], now = new Date()): GoalCheck {
  if (hasHealthFlag(p.health) || p.pregnant || p.lactating || plan.bmi.level === "low") return res("skip", "Подстройка цели недоступна: при отмеченных состояниях здоровья, беременности, кормлении и низком ИМТ калорийность не меняем — обсудите питание с врачом.");
  const today = ymdOf(now);
  if (p.checkedAt) {
    const left = CHECK_DAYS - Math.floor((t(today) - t(p.checkedAt)) / DAY);
    if (left > 0) return res("too-soon", `Цель проверена ${p.checkedAt.split("-").reverse().join(".")}. Следующая проверка через ${left} дн.: за это время вес успеет показать тренд.`);
  }
  // Берём замеры веса после последней проверки (иначе поправка не успеет проявиться) и не старше 28 дней
  const since = Math.max(p.checkedAt ? t(p.checkedAt) : 0, t(today) - 28 * DAY);
  const pts = seriesOf(measures, "weight").filter((x) => t(x.date) >= since);
  const span = pts.length ? t(pts[pts.length - 1].date) - t(pts[0].date) : 0;
  if (pts.length < 3 || span < CHECK_DAYS * DAY) return res("need-data", "Для проверки цели нужно не меньше трёх замеров веса за две недели и более. Взвешивайтесь утром, в одинаковых условиях.", 0, null, plan.weekly);
  const trend = trendPerWeek(pts, 28);
  if (trend === null) return res("need-data", "Замеров пока мало для тренда.", 0, null, plan.weekly);

  const w = p.weight;
  const floor = p.sex === "m" ? 1500 : 1200;
  const planned = plan.weekly;
  const room = (d: number) => { // насколько можно изменить калорийность с учётом нижнего предела и накопленной поправки
    const adj = p.adjust || 0;
    let nd = Math.max(-ADJUST_MAX - adj, Math.min(ADJUST_MAX - adj, d));
    // Снижать можно только до нижнего предела: если до него меньше, чем просим, — убавляем столько, сколько осталось
    const lim = Math.max(floor, plan.bmr);
    if (plan.kcal + nd < lim) nd = lim - plan.kcal;
    const r = r50(nd);
    return (plan.kcal + r < lim && r < 0 ? Math.ceil(nd / 50) * 50 : r) || 0;
  };
  const need = (planned - trend) * 1100; // ккал в день на каждый кг в неделю расхождения (7700 ккал на кг — грубая оценка)

  if (plan.goal === "lose") {
    if (trend < Math.min(-1, -0.01 * w)) {
      const d = room(Math.min(250, Math.max(100, Math.abs(need))));
      return res("too-fast", `Вес снижается быстрее безопасного: ${f1(trend)} кг в неделю при плане ${f1(planned)}. Быстрая потеря чаще идёт за счёт мышц. Предлагаем прибавить ${d} ккал в день.`, d, trend, planned);
    }
    if (trend >= -0.1) {
      const d = room(-150);
      return d < 0
        ? res("stalled", `Вес за две недели почти не меняется (${f1(trend)} кг в неделю при плане ${f1(planned)}). Сначала проверьте, все ли приёмы пищи и напитки записаны. Если да — можно убавить ${-d} ккал в день.`, d, trend, planned)
        : res("stalled", `Вес за две недели почти не меняется (${f1(trend)} кг в неделю при плане ${f1(planned)}), а калорийность уже у нижнего предела (${floor} ккал). Снижать её дальше нельзя: проверьте записи в дневнике, добавьте ходьбу или обсудите план с врачом.`, 0, trend, planned);
    }
    return res("on-track", `Идёте по плану: ${f1(trend)} кг в неделю (в плане ${f1(planned)}). Менять ничего не нужно.`, 0, trend, planned);
  }
  if (plan.goal === "gain") {
    if (trend > 0.5) {
      const d = room(-150);
      return res("too-fast", `Вес растёт быстрее нужного: +${f1(trend)} кг в неделю. Быстрый набор — это в основном жир. Предлагаем убавить ${-d} ккал в день.`, d, trend, planned);
    }
    if (trend <= 0.05) {
      const d = room(150);
      return res("stalled", `Вес не растёт (${f1(trend)} кг в неделю). Предлагаем прибавить ${d} ккал в день.`, d, trend, planned);
    }
    return res("on-track", `Набор идёт по плану: +${f1(trend)} кг в неделю.`, 0, trend, planned);
  }
  // Сохранение веса и «белок»
  if (Math.abs(trend) <= 0.25) return res("on-track", `Вес стабилен: ${f1(trend)} кг в неделю. Менять ничего не нужно.`, 0, trend, planned);
  const d = room(Math.max(-250, Math.min(250, need)));
  return d === 0
    ? res("drift", `Вес ${trend > 0 ? "растёт" : "снижается"}: ${f1(trend)} кг в неделю, хотя цель — сохранение. Калорийность уже у предела, обсудите питание с врачом.`, 0, trend, planned)
    : res("drift", `Вес ${trend > 0 ? "растёт" : "снижается"}: ${f1(trend)} кг в неделю, хотя цель — сохранение. Предлагаем ${d > 0 ? "прибавить" : "убавить"} ${Math.abs(d)} ккал в день.`, d, trend, planned);
}

/** Применить предложенную поправку (или только отметить проверку, если delta = 0). */
export function applyCheck(p: BodyProfile, delta: number, today: string): BodyProfile {
  const adjust = Math.max(-ADJUST_MAX, Math.min(ADJUST_MAX, (p.adjust || 0) + delta));
  return { ...p, adjust: adjust || undefined, checkedAt: today };
}
