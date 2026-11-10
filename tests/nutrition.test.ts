// Проверка расчёта норм питания: node node_modules/.bin/tsx tests/nutrition.test.ts
import { ACTIVITIES, ACT_GROUPS, actByKey, actKey, searchActs } from "../src/lib/activities";
import { dayEnergy, diaryTee, fromHours, hm, normSegs, parseHm, templateDay, SLEEP, activityGroup, bmiOf, bmr, micros, newProfile, pal, planFor, mrNorm, waterMR, stageOf, restHours, waistRisk, basicsError, needsBasics, type BodyProfile } from "../src/lib/nutrition";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const NOW = new Date(2026, 9, 15);
// Старый режим «часы по категориям» (дневника нет)
const P = (o: Partial<BodyProfile>): BodyProfile => { const b: BodyProfile = { ...newProfile("f"), born: 1991, workouts: [], ...o, day: { sleep: 8, desk: 8, light: 2, walk: 1, heavy: 0, ...(o.day || {}) } }; if (!o.days) delete b.days; return b; };

// Миффлин — Сан-Жеор по МР 2.3.1.0253-21: 9,99·62 + 6,25·165 − 4,92·35 − 161 = 1317,43
ok("ОО женщина", Math.abs(bmr(P({}), NOW) - 1317.43) < 0.01, bmr(P({}), NOW));
// мужчина 30 лет, 180 см, 80 кг → 800 + 1125 − 150 + 5 = 1780
ok("ОО мужчина", Math.abs(bmr(P({ sex: "m", born: 1996, height: 180, weight: 80 }), NOW) - 1781.6) < 0.01);

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
ok("расход = ОО × КФА", Math.abs(keep.tee - Math.round(1317.43 * 1.45)) <= 1, keep.tee);
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
ok("беременность (2 триместр по умолчанию): +250 ккал", Math.abs(preg.tee - (Math.round(1317.43 * 1.45) + 250)) <= 1 && preg.stage === "t2", preg.tee);
const p3 = planFor(P({ pregnant: true, stage: "t3" }), NOW)!;
ok("3 триместр: +350 ккал", Math.abs(p3.tee - planFor(P({}), NOW)!.tee - 350) <= 1);
ok("1 триместр: без добавки", Math.abs(planFor(P({ pregnant: true, stage: "t1" }), NOW)!.tee - planFor(P({}), NOW)!.tee) <= 1);
const thin = planFor(P({ weight: 45, goal: "lose" }), NOW)!;
ok("ИМТ < 18,5: худеть нельзя", thin.goal === "keep");
const lact = planFor(P({ lactating: true }), NOW)!;
ok("кормление 1–6 мес.: +500 ккал, 7–12: +450", Math.abs(lact.tee - planFor(P({}), NOW)!.tee - 500) <= 1 && Math.abs(planFor(P({ lactating: true, stage: "l2" }), NOW)!.tee - planFor(P({}), NOW)!.tee - 450) <= 1);
ok("стадия: беременность без этапа → t2, кормление → l1", stageOf(P({ pregnant: true })) === "t2" && stageOf(P({ lactating: true })) === "l1" && stageOf(P({})) === null);
ok("таблица 20: железо 33 мг во 2 триместре, йод 290 при кормлении", micros(P({ pregnant: true, stage: "t2" }), NOW).find((m) => m.key === "fe")!.amount === 33 && micros(P({ lactating: true }), NOW).find((m) => m.key === "i")!.amount === 290);
ok("таблица 20: фолаты 600 при беременности, хром 50", micros(P({ pregnant: true }), NOW).find((m) => m.key === "folate")!.amount === 600 && micros(P({ pregnant: true }), NOW).find((m) => m.key === "cr")!.amount === 50);

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

// ---------- Дневник дня ----------
ok("время: parse/format", parseHm("07:30") === 450 && hm(450) === "07:30" && parseHm("24:00") === null && parseHm("7.05") === 425);
ok("отрезки: первый с 00:00", normSegs([{ start: 420, act: "13040:Умываюсь, чищу зубы, бреюсь, макияж" }])[0].start === 0);
ok("отрезки: сортировка и повтор времени", (() => { const s = normSegs([{ start: 600, act: "a" }, { start: 0, act: SLEEP }, { start: 600, act: "b" }]); return s.length === 2 && s[1].act === "b"; })());
const bm = 1440; // 1 ккал в минуту — так проще проверять
const sleepAll = dayEnergy({ id: "x", title: "", perWeek: 7, segs: [{ start: 0, act: SLEEP }] }, bm);
ok("сутки сна = основной обмен", Math.abs(sleepAll.activity - 1440) < 1e-6 && sleepAll.moveMin === 0);
const mix = dayEnergy({ id: "x", title: "", perWeek: 7, segs: [
  { start: 0, act: SLEEP }, { start: 480, act: "11582:Работа за компьютером сидя" }, { start: 960, act: "12050:Бег 10 км/ч" }, { start: 1020, act: "07020:Сидя, смотрю телевизор" },
] }, bm);
// 480×1,0 + 480×1,3 + 60×9,3 + 420×1,0 = 480 + 624 + 558 + 420 = 2082
ok("энергия = MET × ОО/мин × минуты", Math.abs(mix.activity - 2082) < 1e-6, mix.activity);
ok("движение (MET ≥ 3) — 60 мин", mix.moveMin === 60);
ok("строки с концом отрезка", mix.rows[3].end === 1440 && mix.rows[1].min === 480);
ok("сводка по разделам", Math.round(mix.byGroup.run.kcal) === 558 && mix.byGroup.rest.min === 900);
// Неделя: 5 будних + 2 выходных
const wk = { ...P({}), days: [
  { id: "a", title: "Будни", perWeek: 5, segs: [{ start: 0, act: SLEEP }, { start: 480, act: "11582:Работа за компьютером сидя" }] },
  { id: "b", title: "Выходной", perWeek: 2, segs: [{ start: 0, act: SLEEP }, { start: 600, act: "17190:Иду в обычном темпе (4,5–5,5 км/ч)" }, { start: 720, act: "07020:Сидя, смотрю телевизор" }] },
] } as BodyProfile;
const b0 = bmr(wk, NOW);
const exp = ((480 + 960 * 1.3) * 5 + (600 + 120 * 3.8 + 720) * 2) / 7 * b0 / 1440;
ok("неделя: среднее с весами дней", Math.abs(diaryTee(wk, NOW).activity - exp) < 1e-6);
const pw = planFor(wk, NOW)!;
ok("расход = занятия + 10% на пищу", Math.abs(pw.tee - Math.round(exp * 1.1)) <= 1, [pw.tee, exp * 1.1]);
ok("КФА = расход / ОО", Math.abs(pw.pal - Math.round((exp * 1.1 / b0) * 100) / 100) < 0.011);
ok("разбор дневника в плане", pw.diary?.length === 2);
const wk6 = { ...wk, days: [{ ...wk.days![0], perWeek: 6 }] } as BodyProfile;
ok("дней не 7 — подсказка", planFor(wk6, NOW)!.notes.some((n) => n.includes("7")));
// Пример дня: правдоподобный офисный КФА 1,4–1,6
const tpl = { ...P({}), days: [templateDay()] } as BodyProfile;
ok("пример дня: КФА офиса 1,4–1,6", planFor(tpl, NOW)!.pal >= 1.4 && planFor(tpl, NOW)!.pal <= 1.6, planFor(tpl, NOW)!.pal);
ok("пример дня: все занятия есть в таблице", templateDay().segs.every((s) => dayEnergy({ id: "", title: "", perWeek: 1, segs: [s] }, 1440).rows[0].act.n !== "Сон" || s.act === SLEEP));
// Перевод старого профиля
const conv = fromHours({ sleep: 8, desk: 8, light: 2, walk: 1, heavy: 0 }, [{ kind: "run", minutes: 60, perWeek: 3 }]);
const convE = dayEnergy(conv, 1440);
ok("перевод часов в дневник: сутки целиком", convE.rows[convE.rows.length - 1].end === 1440 && convE.rows.reduce((s, r) => s + r.min, 0) === 1440);
ok("перевод часов: КФА близок к старому", Math.abs(convE.activity * 1.1 / 1440 - pal(P({ workouts: [{ kind: "run", minutes: 60, perWeek: 3 }] }))) < 0.15, [convE.activity * 1.1 / 1440, pal(P({ workouts: [{ kind: "run", minutes: 60, perWeek: 3 }] }))]);

// Таблица занятий
ok("занятия: ключи уникальны, коды 5 цифр, MET > 0", (() => { const keys = new Set(ACTIVITIES.map(actKey)); return keys.size === ACTIVITIES.length && ACTIVITIES.every((a) => /^\d{5}$/.test(a.c) && a.m > 0 && a.m < 25); })());
ok("занятия: сон = 1,0, компьютер = 1,3, бег 10 км/ч = 9,3", actByKey(SLEEP)!.m === 1 && ACTIVITIES.find((a) => a.c === "11582")!.m === 1.3 && ACTIVITIES.find((a) => a.c === "12050")!.m === 9.3);
ok("поиск: «душ»", searchActs("душ").some((a) => a.c === "13050"));
ok("поиск: «бег 10»", searchActs("бег 10").some((a) => a.c === "12050"), searchActs("бег 10").map((a) => a.n));
ok("поиск: «компьютер»", searchActs("компьютер").length >= 2);
ok("у каждого раздела есть занятия", ACT_GROUPS.every((g) => ACTIVITIES.some((a) => a.g === g.id)));

// Обязательные данные человека (экран «Семья»): пол, год рождения, рост, вес
ok("данные: всё заполнено", basicsError({ sex: "f", born: 1990, height: 165, weight: 60 }, 2026) === "");
ok("данные: нет профиля — укажите пол", basicsError(undefined, 2026) === "Укажите пол." && needsBasics(undefined));
ok("данные: без пола", /пол/.test(basicsError({ born: 1990, height: 165, weight: 60 }, 2026)));
ok("данные: год рождения в будущем", /год рождения/.test(basicsError({ sex: "m", born: 2030, height: 180, weight: 80 }, 2026)));
ok("данные: рост в метрах", /Рост/.test(basicsError({ sex: "m", born: 1990, height: 1.8, weight: 80 }, 2026)));
ok("данные: нет веса", /Вес/.test(basicsError({ sex: "m", born: 1990, height: 180 } as any, 2026)));
ok("данные: ребёнок 3 года проходит", basicsError({ sex: "f", born: 2023, height: 95, weight: 14 }, 2026) === "");
ok("профиль без дневника считается по умолчанию", !!planFor({ sex: "f", born: 1990, height: 165, weight: 60, goal: "keep" }, NOW));

// Безопасность: фильтр-вопросы, пределы «не больше»
const sick = planFor(P({ weight: 90, goal: "lose", health: { diabetes: true } }), NOW)!;
ok("диабет: без дефицита калорий", sick.goal === "keep" && Math.abs(sick.kcal - sick.tee) <= 5 && sick.warnings.length > 0, sick);
ok("расстройство питания: цель набора тоже отключена", planFor(P({ goal: "gain", health: { eating: true } }), NOW)!.goal === "keep");
ok("без отметок цель сохраняется", planFor(P({ weight: 90, goal: "lose", health: {} }), NOW)!.goal === "lose");
ok("пределы: холестерин 300, натрий 2000, соль 5", keep.cholMax === 300 && keep.naMax === 2000 && keep.saltMax === 5);
ok("пределы: транс-жиры 1% ккал", Math.abs(keep.transMax - keep.kcal * 0.01 / 9) < 0.06, keep.transMax);
ok("дефицит не больше 20% для всех", [60, 70, 85, 100].every((w) => { const q = planFor(P({ weight: w, goal: "lose" }), NOW)!; return q.tee - q.kcal <= q.tee * 0.2 + 6; }));
ok("пол калорий для мужчин 1500", planFor(P({ sex: "m", weight: 55, height: 170, born: 1960, goal: "lose", day: { sleep: 9, desk: 10, light: 1, walk: 0, heavy: 0 } }), NOW)!.kcal >= 1500);
ok("хром, молибден, хлориды в нормах", ["cr", "mo", "cl"].every((k) => micros(P({}), NOW).some((m) => m.key === k)));

// Нормы МР: табл. 9 и 14, вода — табл. 7
ok("МР женщина 18–29, группа I: 1900 ккал, белок 67, жир 63, углеводы 266", JSON.stringify(mrNorm("f", 25, 1)) && mrNorm("f", 25, 1)!.kcal === 1900 && mrNorm("f", 25, 1)!.protein === 67 && mrNorm("f", 25, 1)!.fat === 63 && mrNorm("f", 25, 1)!.carbs === 266);
ok("МР мужчина 30–44, группа III: 3150 ккал, животный белок 49", mrNorm("m", 35, 3)!.kcal === 3150 && mrNorm("m", 35, 3)!.animal === 49);
ok("МР 45–64, группа IV: м 3400, ж 2700", mrNorm("m", 50, 4)!.kcal === 3400 && mrNorm("f", 50, 4)!.kcal === 2700);
ok("МР 65–74: м 2400, ж 1900; 75+: м 2300, ж 1800", mrNorm("m", 70, 2)!.kcal === 2400 && mrNorm("f", 70, 2)!.kcal === 1900 && mrNorm("m", 80, 1)!.kcal === 2300 && mrNorm("f", 80, 1)!.kcal === 1800);
ok("МР до 18 лет — нет", mrNorm("f", 17, 1) === null);
ok("вода по табл. 7: ж группа I 1,05 л, м группа IV 2,15 л, 65+ м 1,45 / ж 1,15", waterMR("f", 30, 1) === 1.05 && waterMR("m", 30, 4) === 2.15 && waterMR("m", 70, 1) === 1.45 && waterMR("f", 70, 1) === 1.15);
ok("вода в плане: беременность +0,3 л, кормление +0,7 л", Math.abs(planFor(P({ pregnant: true }), NOW)!.water - planFor(P({}), NOW)!.water - 0.3) < 0.06 && Math.abs(planFor(P({ lactating: true }), NOW)!.water - planFor(P({}), NOW)!.water - 0.7) < 0.06);
ok("животный белок — половина", Math.abs(keep.animalProtein - keep.protein / 2) <= 1);
ok("качество жиров: омега-3 1–2% ккал", (() => { const f = keep.fats.find((x) => x.key === "omega3")!; return f.from === Math.round(keep.kcal * 0.01 / 9) && f.to === Math.round(keep.kcal * 0.02 / 9); })());
ok("план содержит норму МР для группы", keep.mr !== null && keep.mr.kcal === 1800, keep.mr);
ok("справочные микроэлементы: кобальт, фтор, кремний, ванадий, бета-каротин", ["co", "f", "si", "v", "betaCarotene"].every((k) => micros(P({}), NOW).some((m) => m.key === k)));
// Талия/бёдра по МР: норма до 0,85; у мужчин выше 1,0 — абдоминальное ожирение
ok("ОТ/ОБ мужчина 0,88 — выше нормы, не высокий риск", (() => { const r = waistRisk(P({ sex: "m", height: 180, waist: 88, hips: 100 })); return r?.level === "up" && /выше нормы/.test(r.text); })());
ok("ОТ/ОБ мужчина 1,02 — высокий", waistRisk(P({ sex: "m", height: 180, waist: 92, hips: 90 }))?.level === "high");

// Талия по МР (разд. 4.1): «не должен превышать 94 см у мужчин и 80 см у женщин», ожирение — «более 102 и 88 см»
{
  const w = (sex: "m" | "f", waist: number) => planFor(P({ sex, waist }), NOW)!.waist!.level;
  ok("талия: ровно 94 / 80 см — ещё норма", w("m", 94) === "ok" && w("f", 80) === "ok", [w("m", 94), w("f", 80)]);
  ok("талия: 95 / 81 см — риск повышен; 102 / 88 — ещё не «высокий»", w("m", 95) === "up" && w("f", 81) === "up" && w("m", 102) === "up" && w("f", 88) === "up");
  ok("талия: 103 / 89 см — высокий риск", w("m", 103) === "high" && w("f", 89) === "high");
}
// Цель «снизить вес», а расход ниже нижнего предела калорийности: дефицита нет, но и выше расхода не поднимаем
{
  const small = P({ born: 1950, height: 150, weight: 46, goal: "lose", days: undefined, day: { sleep: 10, desk: 6, light: 1, walk: 0, heavy: 0 } });
  const pl = planFor(small, NOW)!;
  ok("малый расход: проверяем именно случай «расход ниже 1200»", pl.tee < 1200 && pl.goal === "lose", [pl.tee, pl.goal, pl.bmi]);
  ok("малый расход: калорийность не выше расхода, набора нет", pl.kcal <= Math.round(pl.tee / 10) * 10 && pl.weekly === 0, [pl.kcal, pl.tee, pl.weekly]);
  ok("малый расход: есть предупреждение", pl.warnings.some((x) => /дефицит не закладываем/.test(x)), pl.warnings);
  const adj = planFor({ ...small, goal: "keep", adjust: -100 }, NOW)!;
  ok("малый расход: поправка вниз не поднимает калорийность", adj.kcal <= Math.round(adj.tee / 10) * 10, [adj.kcal, adj.tee]);
}
console.log(`nutrition: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
