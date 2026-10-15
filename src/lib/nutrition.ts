// Питание (пробная функция): личные нормы для каждого члена семьи.
// Всё считается в телефоне по открытым методикам — без интернета и платных сервисов.
//
// Источники:
// - Основной обмен: формула Миффлина — Сан-Жеора (Am J Clin Nutr, 1990).
// - Расход за день: дневник дня по минутам. Каждое занятие — из таблиц 2024 Adult Compendium
//   of Physical Activities (код и MET). Энергия отрезка = MET × основной обмен за минуту × минуты
//   (MET, поправленный на свой основной обмен, а не на «стандартные» 3,5 мл O₂/кг/мин),
//   плюс 10% на переваривание пищи (термический эффект пищи).
//   Старый упрощённый режим (часы по категориям) — факторный метод ФАО/ВОЗ/УООН 2004.
// - Нормы белков, жиров, углеводов, клетчатки, витаминов и минералов —
//   МР 2.3.1.0253-21 «Нормы физиологических потребностей…» (Роспотребнадзор, 2021).
// - ИМТ и окружность талии — пороги ВОЗ.
// Это ориентиры для здоровых взрослых, а не назначение врача.

import { ACTIVITIES, actByKey, actKey, type Activity } from "./activities";

export type Sex = "m" | "f";
export type Goal = "keep" | "lose" | "gain" | "protein";

/** Типичный день: сколько часов на что уходит. Что не распределено — «сидя отдых». */
export interface DayRoutine {
  sleep: number;
  /** Сидячая работа или учёба. */
  desk: number;
  /** Стоя, по дому, готовка, лёгкая работа. */
  light: number;
  /** Ходьба, в том числе до работы и в магазин. */
  walk: number;
  /** Тяжёлая физическая работа. */
  heavy: number;
}

export interface Workout { kind: WorkoutKind; minutes: number; perWeek: number }

/** Отрезок дня: с какой минуты (0–1439) и что делал (ключ занятия из activities.ts). Длится до следующего отрезка. */
export interface DaySeg { start: number; act: string }
/** Типичный день (будний, выходной, день тренировки) и сколько таких дней в неделю. */
export interface DayLog { id: string; title: string; perWeek: number; segs: DaySeg[] }

export interface BodyProfile {
  sex: Sex;
  /** Год рождения. */
  born: number;
  height: number; // см
  weight: number; // кг
  waist?: number; // см
  hips?: number; // см
  /** Дневник: типичные дни по времени. Главный способ расчёта расхода. */
  days?: DayLog[];
  /** Старый упрощённый распорядок (часы по категориям) — используется, только если дневника нет. */
  day?: DayRoutine;
  workouts?: Workout[];
  goal: Goal;
  pregnant?: boolean;
  lactating?: boolean;
  /** Ограничения по здоровью от врача — приложение их не назначает, только напоминает. */
  medical?: string;
  /** Когда обновляли вес. */
  updated?: string;
}

// Коэффициенты занятий (во сколько раз больше основного обмена). ФАО/ВОЗ/УООН 2004, табл. 5.1 и прил. 5.
export const ROUTINE: { key: keyof DayRoutine | "rest"; title: string; hint: string; par: number }[] = [
  { key: "sleep", title: "Сон", hint: "", par: 1.0 },
  { key: "desk", title: "Сидячая работа, учёба", hint: "компьютер, офис, за рулём", par: 1.5 },
  { key: "light", title: "Стоя, дела по дому", hint: "готовка, уборка, работа стоя", par: 2.3 },
  { key: "walk", title: "Ходьба", hint: "дорога пешком, прогулки, магазин", par: 3.2 },
  { key: "heavy", title: "Тяжёлый физический труд", hint: "стройка, грузчик, огород", par: 4.5 },
  { key: "rest", title: "Отдых сидя", hint: "еда, телефон, ТВ — остальное время", par: 1.4 },
];

export type WorkoutKind = "walkFast" | "run" | "bike" | "swim" | "gym" | "fitness" | "yoga" | "team" | "ski" | "dance";
// MET — Compendium of Physical Activities 2024 (средние значения для типичной интенсивности)
export const WORKOUTS: Record<WorkoutKind, { title: string; met: number }> = {
  walkFast: { title: "Быстрая ходьба", met: 4.3 },
  run: { title: "Бег", met: 9.0 },
  bike: { title: "Велосипед", met: 7.0 },
  swim: { title: "Плавание", met: 6.0 },
  gym: { title: "Силовая, тренажёры", met: 5.0 },
  fitness: { title: "Фитнес, аэробика", met: 6.5 },
  yoga: { title: "Йога, пилатес, растяжка", met: 3.0 },
  team: { title: "Футбол, волейбол и др.", met: 7.0 },
  ski: { title: "Лыжи, коньки", met: 7.5 },
  dance: { title: "Танцы", met: 5.0 },
};

export const GOALS: Record<Goal, string> = {
  keep: "Сохранить вес",
  lose: "Снизить вес",
  gain: "Набрать вес",
  protein: "Спорт: больше белка",
};

export function newProfile(sex: Sex = "f"): BodyProfile {
  return {
    sex, born: new Date().getFullYear() - 35, height: sex === "m" ? 177 : 165, weight: sex === "m" ? 75 : 62,
    days: [templateDay()], goal: "keep",
  };
}

export const ageOf = (p: BodyProfile, now = new Date()) => now.getFullYear() - p.born;

/** Основной обмен, ккал/сутки (Миффлин — Сан-Жеор). */
export function bmr(p: BodyProfile, now = new Date()): number {
  return 10 * p.weight + 6.25 * p.height - 5 * ageOf(p, now) + (p.sex === "m" ? 5 : -161);
}

/** Часы «отдыха сидя» — всё, что не распределено по другим занятиям и тренировкам. */
export function restHours(p: BodyProfile): number {
  const d = p.day || NO_DAY;
  return Math.max(0, 24 - d.sleep - d.desk - d.light - d.walk - d.heavy - workoutHours(p));
}
/** Тренировки в среднем за день, часы. */
export function workoutHours(p: BodyProfile): number {
  return (p.workouts || []).reduce((s, w) => s + (w.minutes * w.perWeek) / 7 / 60, 0);
}

/** Коэффициент физической активности (КФА, PAL): средний за сутки. */
export function pal(p: BodyProfile): number {
  if (p.days?.length) return round(diaryTee(p).activity / bmr(p) * 1.1, 2);
  const d = p.day || NO_DAY;
  let sum = d.sleep * 1.0 + d.desk * 1.5 + d.light * 2.3 + d.walk * 3.2 + d.heavy * 4.5;
  for (const w of p.workouts || []) sum += ((w.minutes * w.perWeek) / 7 / 60) * WORKOUTS[w.kind].met;
  sum += restHours(p) * 1.4;
  const hours = Math.max(24, d.sleep + d.desk + d.light + d.walk + d.heavy + workoutHours(p));
  return round(sum / hours, 2);
}

const NO_DAY: DayRoutine = { sleep: 8, desk: 8, light: 2, walk: 1, heavy: 0 };

// ---------- Дневник дня ----------
export const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const parseHm = (s: string): number | null => {
  const m = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return +m[1] < 24 && +m[2] < 60 ? v : null;
};

/** Отрезки по порядку; первый всегда с 00:00, повторы времени убраны. */
export function normSegs(segs: DaySeg[]): DaySeg[] {
  const s = [...segs].filter((x) => x.start >= 0 && x.start < 1440).sort((a, b) => a.start - b.start);
  const out: DaySeg[] = [];
  for (const x of s) { if (out.length && out[out.length - 1].start === x.start) out[out.length - 1] = x; else out.push(x); }
  if (!out.length || out[0].start !== 0) out.unshift({ start: 0, act: out.length ? out[out.length - 1].act : SLEEP });
  return out;
}

export interface DayRow { start: number; end: number; act: Activity; min: number; kcal: number }
export interface DayEnergy { rows: DayRow[]; activity: number; byGroup: Record<string, { min: number; kcal: number }>; moveMin: number }

/** Энергия за день по дневнику: MET × основной обмен за минуту × минуты. */
export function dayEnergy(d: DayLog, bmrKcal: number): DayEnergy {
  const segs = normSegs(d.segs);
  const perMin = bmrKcal / 1440;
  const rows: DayRow[] = [];
  const byGroup: DayEnergy["byGroup"] = {};
  let activity = 0, moveMin = 0;
  segs.forEach((x, i) => {
    const end = i + 1 < segs.length ? segs[i + 1].start : 1440;
    const act = actByKey(x.act) || actByKey(SLEEP)!;
    const min = end - x.start;
    const kcal = act.m * perMin * min;
    rows.push({ start: x.start, end, act, min, kcal });
    activity += kcal;
    if (act.m >= 3) moveMin += min;
    const g = (byGroup[act.g] ||= { min: 0, kcal: 0 });
    g.min += min; g.kcal += kcal;
  });
  return { rows, activity, byGroup, moveMin };
}

/** Средний за неделю расход на занятия (без переваривания пищи), ккал/сутки, и сводка по дням. */
export function diaryTee(p: BodyProfile, now = new Date()): { activity: number; days: { d: DayLog; e: DayEnergy }[]; weekDays: number } {
  const b = bmr(p, now);
  const days = (p.days || []).map((d) => ({ d, e: dayEnergy(d, b) }));
  const w = days.reduce((s, x) => s + Math.max(0, x.d.perWeek), 0);
  if (!w) return { activity: days[0]?.e.activity || b * 1.3, days, weekDays: 0 };
  return { activity: days.reduce((s, x) => s + x.e.activity * Math.max(0, x.d.perWeek), 0) / w, days, weekDays: w };
}

export const SLEEP = "07030:Сон";
const K = (c: string) => { const a = ACTIVITIES.find((x) => x.c === c)!; return actKey(a); };

/** Пример обычного рабочего дня — его удобно поправить под себя. */
export function templateDay(title = "Будний день", perWeek = 5): DayLog {
  const t = (h: string, c: string): DaySeg => ({ start: parseHm(h)!, act: K(c) });
  return {
    id: "d" + Math.random().toString(36).slice(2, 8), title, perWeek,
    segs: [
      t("00:00", "07030"), t("07:00", "13040"), t("07:15", "13050"), t("07:30", "13020"), t("07:40", "13030"),
      t("08:00", "17270"), t("08:15", "16016"), t("08:45", "17270"), t("09:00", "11582"), t("13:00", "13030"),
      t("13:30", "11582"), t("18:00", "17270"), t("18:15", "16016"), t("18:45", "05060"), t("19:15", "05050"),
      t("20:00", "13030"), t("20:30", "05041"), t("20:45", "07020"), t("22:45", "13000"), t("23:00", "07030"),
    ],
  };
}

/** Перевод старого распорядка «часы по категориям» в дневник (последовательные отрезки). */
export function fromHours(d: DayRoutine, workouts: Workout[] = []): DayLog {
  const segs: DaySeg[] = [];
  let t = 0;
  const add = (h: number, c: string) => { if (h > 0 && t < 1440) { segs.push({ start: t, act: K(c) }); t = Math.min(1440, t + Math.round(h * 60)); } };
  add(Math.max(0, d.sleep - 1), "07030");
  add(d.desk, "11582"); add(d.light, "05025"); add(d.walk, "17190"); add(d.heavy, "11476");
  const MAP: Record<WorkoutKind, string> = { walkFast: "17200", run: "12020", bike: "01020", swim: "18310", gym: "02054", fitness: "02061", yoga: "02175", team: "15610", ski: "19090", dance: "03042" };
  for (const w of workouts) add((w.minutes * w.perWeek) / 7 / 60, MAP[w.kind]);
  add(24 - Math.min(24, d.sleep + d.desk + d.light + d.walk + d.heavy) - workoutHours({ workouts } as BodyProfile), "07021");
  if (t < 1440) segs.push({ start: Math.min(1439, 1440 - 60), act: K("07030") });
  return { id: "d" + Math.random().toString(36).slice(2, 8), title: "Обычный день", perWeek: 7, segs: normSegs(segs) };
}

/** Группа активности по МР 2.3.1.0253-21 (I — очень низкая … IV — высокая). */
export function activityGroup(k: number): { n: 1 | 2 | 3 | 4; title: string } {
  if (k < 1.5) return { n: 1, title: "I — очень низкая (умственный труд)" };
  if (k < 1.75) return { n: 2, title: "II — низкая (лёгкий труд)" };
  if (k < 2.05) return { n: 3, title: "III — средняя" };
  return { n: 4, title: "IV — высокая (тяжёлый труд)" };
}

export interface BmiInfo { bmi: number; cat: string; level: "low" | "ok" | "over" | "obese" }
/** Индекс массы тела и категория по ВОЗ. */
export function bmiOf(p: BodyProfile): BmiInfo {
  const b = round(p.weight / (p.height / 100) ** 2, 1);
  if (b < 18.5) return { bmi: b, cat: "недостаток массы", level: "low" };
  if (b < 25) return { bmi: b, cat: "норма", level: "ok" };
  if (b < 30) return { bmi: b, cat: "избыток массы", level: "over" };
  if (b < 35) return { bmi: b, cat: "ожирение I степени", level: "obese" };
  if (b < 40) return { bmi: b, cat: "ожирение II степени", level: "obese" };
  return { bmi: b, cat: "ожирение III степени", level: "obese" };
}

/** Риск по окружности талии (ВОЗ, 2008): мужчины ≥94 / ≥102 см, женщины ≥80 / ≥88 см. */
export function waistRisk(p: BodyProfile): { text: string; level: "ok" | "up" | "high" } | null {
  if (!p.waist) return null;
  const [a, b] = p.sex === "m" ? [94, 102] : [80, 88];
  const whr = p.hips ? round(p.waist / p.hips, 2) : null;
  const whrHigh = whr !== null && whr >= (p.sex === "m" ? 0.9 : 0.85);
  const whtr = round(p.waist / p.height, 2);
  const extra = [whr !== null ? `талия/бёдра ${num(whr)}${whrHigh ? " (выше нормы ВОЗ)" : ""}` : "", `талия/рост ${num(whtr)}${whtr >= 0.5 ? " (больше 0,5)" : ""}`].filter(Boolean).join(", ");
  if (p.waist >= b) return { text: `талия ${p.waist} см — риск для сердца и обмена веществ заметно повышен; ${extra}`, level: "high" };
  if (p.waist >= a || whrHigh) return { text: `талия ${p.waist} см — риск немного повышен; ${extra}`, level: "up" };
  return { text: `талия ${p.waist} см — в норме; ${extra}`, level: "ok" };
}

/** Витамины и минералы в сутки по МР 2.3.1.0253-21. */
export interface Micro { key: string; title: string; amount: number; unit: string; note?: string }
export function micros(p: BodyProfile, now = new Date()): Micro[] {
  const old = ageOf(p, now) >= 65;
  const m = p.sex === "m";
  return [
    { key: "vitC", title: "Витамин C", amount: 100, unit: "мг" },
    { key: "vitB1", title: "Витамин B1", amount: 1.5, unit: "мг" },
    { key: "vitB2", title: "Витамин B2", amount: 1.8, unit: "мг" },
    { key: "vitB6", title: "Витамин B6", amount: 2, unit: "мг" },
    { key: "niacin", title: "Ниацин (PP)", amount: 20, unit: "мг" },
    { key: "vitB12", title: "Витамин B12", amount: 3, unit: "мкг", note: "есть только в продуктах животного происхождения" },
    { key: "folate", title: "Фолаты", amount: 400, unit: "мкг" },
    { key: "pantothenic", title: "Пантотеновая кислота", amount: 5, unit: "мг" },
    { key: "biotin", title: "Биотин", amount: 50, unit: "мкг" },
    { key: "vitA", title: "Витамин A", amount: m ? 900 : 800, unit: "мкг" },
    { key: "vitE", title: "Витамин E", amount: 15, unit: "мг" },
    { key: "vitD", title: "Витамин D", amount: old ? 20 : 15, unit: "мкг" },
    { key: "vitK", title: "Витамин K", amount: 120, unit: "мкг" },
    { key: "ca", title: "Кальций", amount: old ? 1200 : 1000, unit: "мг" },
    { key: "p", title: "Фосфор", amount: 700, unit: "мг" },
    { key: "mg", title: "Магний", amount: 420, unit: "мг" },
    { key: "k", title: "Калий", amount: 3500, unit: "мг" },
    { key: "na", title: "Натрий", amount: 1300, unit: "мг", note: "не больше 2 000 мг — это около 5 г соли" },
    { key: "fe", title: "Железо", amount: m ? 10 : 18, unit: "мг" },
    { key: "zn", title: "Цинк", amount: 12, unit: "мг" },
    { key: "i", title: "Йод", amount: 150, unit: "мкг" },
    { key: "se", title: "Селен", amount: m ? 70 : 55, unit: "мкг" },
    { key: "cu", title: "Медь", amount: 1, unit: "мг" },
    { key: "mn", title: "Марганец", amount: 2, unit: "мг" },
  ];
}

export interface Plan {
  age: number;
  bmr: number;
  pal: number;
  group: ReturnType<typeof activityGroup>;
  /** Расход энергии за сутки, ккал. */
  tee: number;
  /** Цель по калориям в сутки. */
  kcal: number;
  /** Какая цель реально применена (снижение веса может быть недоступно). */
  goal: Goal;
  protein: number; // г
  fat: number; // г
  satFatMax: number; // г
  carbs: number; // г
  sugarMax: number; // г
  fiber: number; // г
  /** Питьевая вода, л/сутки (ориентир). */
  water: number;
  /** Изменение веса в неделю при цели, кг (минус — снижение). */
  weekly: number;
  bmi: BmiInfo;
  waist: ReturnType<typeof waistRisk>;
  notes: string[];
  warnings: string[];
  /** Разбор дневника по дням (если он есть). */
  diary?: { d: DayLog; e: DayEnergy }[];
}

/** Полный расчёт норм для одного человека. null — расчёт для этого возраста пока не поддерживается. */
export function planFor(p: BodyProfile, now = new Date()): Plan | null {
  const age = ageOf(p, now);
  if (age < 18 || age > 110 || p.height < 100 || p.weight < 30) return null;
  const notes: string[] = [];
  const warnings: string[] = [];
  const b = bmr(p, now);
  const diary = p.days?.length ? diaryTee(p, now) : null;
  let tee = diary ? diary.activity * 1.1 : b * pal(p);
  const k = round(tee / b, 2);
  const group = activityGroup(k);
  if (diary && diary.weekDays !== 7) notes.push(`В дневнике расписано ${diary.weekDays} ${diary.weekDays === 1 ? "день" : diary.weekDays < 5 ? "дня" : "дней"} недели — расход посчитан как среднее по ним. Лучше, чтобы вместе получилось 7.`);
  if (p.pregnant) { tee *= 1.15; notes.push("Беременность: энергия +15% (МР 2.3.1.0253-21)."); }
  else if (p.lactating) { tee *= 1.2; notes.push("Кормление грудью: энергия +20% (МР 2.3.1.0253-21)."); }
  const bmi = bmiOf(p);

  let goal = p.goal;
  if (goal === "lose" && (p.pregnant || p.lactating)) { goal = "keep"; warnings.push("Во время беременности и кормления худеть не рекомендуется — расчёт сделан на сохранение веса. Обсудите питание с врачом."); }
  if (goal === "lose" && bmi.level === "low") { goal = "keep"; warnings.push("ИМТ ниже 18,5 — снижать вес не нужно. Расчёт сделан на сохранение веса."); }
  if (goal === "lose" && bmi.bmi < 20 && bmi.level === "ok") warnings.push("Вес уже у нижней границы нормы — худеть дальше обычно не нужно.");
  if (bmi.level === "low") warnings.push("ИМТ ниже нормы. Если вес снижается без причины — покажитесь врачу.");
  if (age >= 65) notes.push("После 65 лет нормы витамина D и кальция выше, доля белка — 14% калорий.");

  let kcal = tee;
  let weekly = 0;
  const floor = p.sex === "m" ? 1500 : 1200;
  if (goal === "lose") {
    const deficit = Math.min(tee * 0.2, 750);
    kcal = Math.max(tee - deficit, floor, b);
    weekly = -((tee - kcal) * 7) / 7700;
    if (kcal <= floor + 1) notes.push(`Калорийность не опускаем ниже ${floor} ккал — меньше трудно получить нужные витамины и минералы.`);
  } else if (goal === "gain") {
    kcal = tee + Math.min(tee * 0.1, 400);
    weekly = ((kcal - tee) * 7) / 7700;
    notes.push("Набирать вес лучше вместе с силовыми тренировками — тогда растут мышцы, а не жир.");
  }

  // Белок: доля калорий по МР (14 / 13 / 12,5 / 12%, после 65 лет — 14%)
  const share = age >= 65 ? 0.14 : [0, 0.14, 0.13, 0.125, 0.12][group.n];
  let protein = (kcal * share) / 4;
  // Вес для расчёта на килограмм: при ИМТ выше 30 — вес при ИМТ 25 (иначе белка выйдет слишком много)
  const kgFor = bmi.bmi > 30 ? 25 * (p.height / 100) ** 2 : p.weight;
  if (goal === "protein") { protein = Math.max(protein, 1.6 * kgFor); notes.push("Белок 1,6 г на кг веса — для тех, кто регулярно тренируется."); }
  if (goal === "lose") { protein = Math.max(protein, 1.2 * kgFor); notes.push("При снижении веса белка больше (1,2 г на кг), чтобы сохранить мышцы."); }
  if (age >= 65) protein = Math.max(protein, 1.0 * kgFor);
  protein = Math.min(protein, 2.0 * kgFor);

  // Жиры — 30% калорий, насыщенные — не больше 10%
  const fat = (kcal * 0.3) / 9;
  const satFatMax = (kcal * 0.1) / 9;
  // Углеводы — остальное; добавленный сахар не больше 10% (5% при ИМТ 25 и выше)
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  const sugarShare = bmi.bmi >= 25 ? 0.05 : 0.1;
  const sugarMax = (kcal * sugarShare) / 4;
  // Клетчатка — 10 г на 1000 ккал, не меньше 20 г
  const fiber = Math.max(20, kcal / 100);
  // Вода: EFSA — всего 2,5 л мужчинам и 2,0 л женщинам, из них ~20% даёт еда; +0,5 л на час тренировки
  const sportH = diary ? diary.days.reduce((s2, x) => s2 + x.e.rows.filter((r) => r.act.m >= 5).reduce((a, r) => a + r.min, 0) * Math.max(0, x.d.perWeek), 0) / Math.max(1, diary.weekDays) / 60 : workoutHours(p);
  const water = (p.sex === "m" ? 2.0 : 1.6) + sportH * 0.5 + (p.lactating ? 0.6 : p.pregnant ? 0.3 : 0);

  if (p.medical?.trim()) warnings.push(`Учтите рекомендации врача: ${p.medical.trim()}. Приложение не заменяет консультацию.`);

  return {
    age, bmr: Math.round(b), pal: k, group, tee: Math.round(tee), kcal: Math.round(kcal / 10) * 10, goal,
    protein: Math.round(protein), fat: Math.round(fat), satFatMax: Math.round(satFatMax), carbs: Math.round(carbs),
    sugarMax: Math.round(sugarMax), fiber: Math.round(fiber), water: round(water, 1), weekly: round(weekly, 2),
    bmi, waist: waistRisk(p), notes, warnings, diary: diary ? diary.days : undefined,
  };
}

/** Короткая строка для запроса Claude: «Аня: ~1900 ккал, белок 75 г, цель — снизить вес». */
export function planLine(name: string, p: Plan): string {
  return `${name}: около ${p.kcal} ккал в день, белок ${p.protein} г, жиры ${p.fat} г, углеводы ${p.carbs} г, клетчатка ${p.fiber} г; цель — ${GOALS[p.goal].toLowerCase()}`;
}

function round(n: number, d: number) { const k = 10 ** d; return Math.round(n * k) / k; }
const num = (n: number) => String(n).replace(".", ",");
