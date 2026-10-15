// Проверка расчёта норм питания: node node_modules/.bin/tsx tests/nutrition.test.ts
import { activityGroup, bmiOf, bmr, micros, newProfile, pal, planFor, restHours, waistRisk, type BodyProfile } from "../src/lib/nutrition";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const NOW = new Date(2026, 9, 15);
const P = (o: Partial<BodyProfile>): BodyProfile => ({ ...newProfile("f"), born: 1991, ...o, day: { ...newProfile().day, ...(o.day || {}) } });

// Миффлин — Сан-Жеор: женщина 35 лет, 165 см, 62 кг → 10·62 + 6,25·165 − 5·35 − 161 = 1315,25
ok("ОО женщина", Math.abs(bmr(P({}), NOW) - 1315.25) < 0.01, bmr(P({}), NOW));
// мужчина 30 лет, 180 см, 80 кг → 800 + 1125 − 150 + 5 = 1780
ok("ОО мужчина", bmr(P({ sex: "m", born: 1996, height: 180, weight: 80 }), NOW) === 1780);

// Офисный день: 8 сон, 8 стол, 2 дом, 1 ходьба, 5 отдых → (8 + 12 + 4,6 + 3,2 + 7) / 24 = 1,45
ok("КФА офис", pal(P({})) === 1.45, pal(P({})));
ok("отдых — остаток суток", restHours(P({})) === 5);
ok("группа I", activityGroup(1.47).n === 1);
ok("группа II", activityGroup(1.6).n === 2 && activityGroup(1.9).n === 3 && activityGroup(2.2).n === 4);
// Тренировки: бег 60 мин × 3 раза = 0,43 ч/день по 9 MET
const runner = P({ workouts: [{ kind: "run", minutes: 60, perWeek: 3 }] });
ok("бег повышает КФА", pal(runner) > pal(P({})) + 0.1, pal(runner));
ok("тренировки вычитаются из отдыха", Math.abs(restHours(runner) - (5 - 180 / 7 / 60)) < 1e-9);
// Перебор часов не ломает расчёт
ok("больше 24 часов — делим на фактические", pal(P({ day: { sleep: 10, desk: 12, light: 4, walk: 2, heavy: 0 } })) < 2);

// ИМТ
ok("ИМТ норма", bmiOf(P({})).bmi === 22.8 && bmiOf(P({})).level === "ok", bmiOf(P({})));
ok("ИМТ ожирение", bmiOf(P({ weight: 95 })).level === "obese");
ok("ИМТ недостаток", bmiOf(P({ weight: 48 })).level === "low");

// Талия (ВОЗ)
ok("талия норма", waistRisk(P({ waist: 75 }))?.level === "ok");
ok("талия повышен", waistRisk(P({ waist: 84 }))?.level === "up");
ok("талия высокий", waistRisk(P({ waist: 90 }))?.level === "high");
ok("талия мужчина 96 — повышен", waistRisk(P({ sex: "m", waist: 96, height: 180 }))?.level === "up");
ok("талия/бёдра выше нормы", waistRisk(P({ waist: 78, hips: 90 }))?.level === "up");
ok("талия не указана", waistRisk(P({})) === null);

// План: сохранить вес
const keep = planFor(P({}), NOW)!;
ok("расход = ОО × КФА", Math.abs(keep.tee - Math.round(1315.25 * 1.45)) <= 1, keep.tee);
ok("ккал = расход (округл.)", Math.abs(keep.kcal - keep.tee) <= 5, keep);
ok("белок 14% для группы I", Math.abs(keep.protein - (keep.kcal * 0.14) / 4) <= 1, keep.protein);
ok("жиры 30%", Math.abs(keep.fat - (keep.kcal * 0.3) / 9) <= 1);
ok("углеводы — остаток", Math.abs(keep.protein * 4 + keep.fat * 9 + keep.carbs * 4 - keep.kcal) < 15);
ok("клетчатка ≥ 20 г", keep.fiber >= 20 && keep.fiber === Math.round(Math.max(20, keep.kcal / 100)));
ok("сахар ≤ 10% при ИМТ < 25", Math.abs(keep.sugarMax - (keep.kcal * 0.1) / 4) <= 1);

// Снизить вес
const lose = planFor(P({ weight: 80, goal: "lose" }), NOW)!;
ok("снижение: дефицит ≤ 20% и ≤ 750", lose.tee - lose.kcal <= Math.min(lose.tee * 0.2, 750) + 5 && lose.kcal < lose.tee, lose);
ok("снижение: не ниже 1200 ккал", lose.kcal >= 1200);
ok("снижение: вес уходит", lose.weekly < 0 && lose.weekly > -0.8, lose.weekly);
ok("снижение: белок ≥ 1,2 г/кг", lose.protein >= Math.round(1.2 * 80) - 1, lose.protein);
ok("снижение: сахар ≤ 5% при ИМТ ≥ 25", Math.abs(lose.sugarMax - (lose.kcal * 0.05) / 4) <= 1);
const tiny = planFor(P({ weight: 50, height: 155, born: 1960, goal: "lose", day: { sleep: 9, desk: 10, light: 1, walk: 0, heavy: 0 } }), NOW)!;
ok("снижение: пол 1200 / не ниже ОО", tiny.kcal >= 1200 && tiny.kcal >= tiny.bmr - 10, tiny);
const preg = planFor(P({ goal: "lose", pregnant: true }), NOW)!;
ok("беременность: худеть нельзя", preg.goal === "keep" && preg.warnings.length > 0);
ok("беременность: +15%", Math.abs(preg.tee - Math.round(1315.25 * 1.45 * 1.15)) <= 1, preg.tee);
const thin = planFor(P({ weight: 45, goal: "lose" }), NOW)!;
ok("ИМТ < 18,5: худеть нельзя", thin.goal === "keep");
const lact = planFor(P({ lactating: true }), NOW)!;
ok("кормление: +20%", Math.abs(lact.tee - Math.round(1315.25 * 1.45 * 1.2)) <= 1);

// Набрать / белок
const gain = planFor(P({ goal: "gain" }), NOW)!;
ok("набор: +10%, не больше 400", gain.kcal > gain.tee && gain.kcal - gain.tee <= 405 && gain.weekly > 0);
const sport = planFor(P({ sex: "m", born: 1996, height: 180, weight: 80, goal: "protein", workouts: [{ kind: "gym", minutes: 60, perWeek: 4 }] }), NOW)!;
ok("спорт: белок 1,6 г/кг", sport.protein >= 128, sport.protein);
const big = planFor(P({ sex: "m", height: 175, weight: 130, goal: "protein" }), NOW)!;
ok("ИМТ > 30: белок на вес при ИМТ 25", big.protein <= Math.round(2.0 * 25 * 1.75 ** 2) && big.protein >= Math.round(1.6 * 25 * 1.75 ** 2) - 1, big.protein);

// Пожилые
const old = P({ born: 1955 });
ok("65+: витамин D 20, кальций 1200", micros(old, NOW).find((m) => m.key === "vitD")!.amount === 20 && micros(old, NOW).find((m) => m.key === "ca")!.amount === 1200);
ok("65+: белок 14%", planFor(old, NOW)!.protein >= Math.round((planFor(old, NOW)!.kcal * 0.14) / 4) - 1);
ok("женщина: железо 18, мужчина 10", micros(P({}), NOW).find((m) => m.key === "fe")!.amount === 18 && micros(P({ sex: "m" }), NOW).find((m) => m.key === "fe")!.amount === 10);
ok("селен м/ж 70/55", micros(P({ sex: "m" }), NOW).find((m) => m.key === "se")!.amount === 70 && micros(P({}), NOW).find((m) => m.key === "se")!.amount === 55);

// Дети — пока нет
ok("до 18 лет — не считаем", planFor(P({ born: 2012 }), NOW) === null);

// Сверка с МР 2.3.1.0253-21: ОО «эталонной» женщины 30–44 (61,6 кг, 165 см) — в таблице 1269–1338
const ref = bmr(P({ born: 1989, height: 165, weight: 61.6 }), NOW);
ok("ОО совпадает с таблицей МР", ref >= 1269 && ref <= 1338, ref);
const refM = bmr(P({ sex: "m", born: 1989, height: 176.7, weight: 72.3 }), NOW);
ok("ОО мужчины совпадает с таблицей МР", refM >= 1615 && refM <= 1684, refM);

console.log(`nutrition: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
