// Проверка подстройки цели: node node_modules/.bin/tsx tests/goalcheck.test.ts
import { goalCheck, applyCheck } from "../src/lib/goalcheck";
import { planFor, type BodyProfile } from "../src/lib/nutrition";
import type { Measure } from "../src/lib/body";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const NOW = new Date("2026-11-22T10:00:00Z");
const prof = (o: Partial<BodyProfile> = {}): BodyProfile => ({ sex: "f", born: 1991, height: 165, weight: 80, goal: "lose", ...o });
// замеры: вес каждые 7 дней от 2026-11-01 (4 замера), шаг kg в неделю
const series = (start: number, step: number): Measure[] => [0, 7, 14, 21].map((d, i) => ({ date: `2026-11-${String(1 + d).padStart(2, "0")}`, weight: Math.round((start + step * i) * 10) / 10 }));
const run = (p: BodyProfile, ms: Measure[]) => goalCheck(p, planFor(p, NOW)!, ms, NOW);

const p0 = prof();
const plan0 = planFor(p0, NOW)!;
ok("план на снижение: заложено снижение", plan0.weekly < 0, plan0.weekly);
ok("мало замеров — нужны данные", run(p0, series(80, -0.5).slice(0, 2)).status === "need-data");
ok("замеры за меньше двух недель — нужны данные", run(p0, [{ date: "2026-11-15", weight: 80 }, { date: "2026-11-18", weight: 79.8 }, { date: "2026-11-21", weight: 79.6 }]).status === "need-data");
const planned = plan0.weekly;
ok("идёт по плану", run(p0, series(80, planned)).status === "on-track", run(p0, series(80, planned)));
const stalled = run(p0, series(80, 0));
ok("вес стоит — «не меняется» и убавить немного", stalled.status === "stalled" && stalled.delta < 0 && stalled.delta >= -150, stalled);
ok("в тексте про стоящий вес сначала проверка записей", /проверьте, все ли приёмы пищи/.test(stalled.text));
const fast = run(p0, series(80, -1.3));
ok("слишком быстро — предложить прибавить", fast.status === "too-fast" && fast.delta >= 100 && fast.delta <= 250, fast);
// У нижнего предела калорий снижать нельзя
const low = prof({ weight: 55, height: 165 });
const lowPlan = planFor(low, NOW)!;
ok("у предела 1200: не предлагаем снижать", (() => { const c = goalCheck(low, lowPlan, series(55, 0), NOW); return lowPlan.kcal <= 1201 ? c.delta === 0 && /нижнего предела/.test(c.text) : true; })(), lowPlan.kcal);
// Сохранение
const keep = prof({ goal: "keep" });
ok("сохранение: стабильный вес", run(keep, series(70, 0.1)).status === "on-track");
const up = run(keep, series(70, 0.6));
ok("сохранение: вес растёт — убавить", up.status === "drift" && up.delta < 0 && up.delta >= -250, up);
const down = run(keep, series(70, -0.6));
ok("сохранение: вес падает — прибавить", down.status === "drift" && down.delta > 0, down);
// Набор
const gain = prof({ goal: "gain", weight: 60 });
ok("набор: растёт слишком быстро", run(gain, series(60, 0.8)).status === "too-fast");
ok("набор: вес стоит — прибавить", (() => { const c = run(gain, series(60, 0)); return c.status === "stalled" && c.delta > 0; })());
// Безопасность
ok("отмеченное здоровье — пропуск", run(prof({ health: { diabetes: true } }), series(80, 0)).status === "skip");
ok("беременность — пропуск", run(prof({ pregnant: true }), series(80, 0)).status === "skip");
ok("низкий ИМТ — пропуск", run(prof({ weight: 45 }), series(45, 0)).status === "skip");
// Раз в две недели
ok("проверена недавно — рано", run(prof({ checkedAt: "2026-11-15" }), series(80, 0)).status === "too-soon");
ok("через 14 дней проверка доступна, считаются замеры после прошлой", run(prof({ checkedAt: "2026-11-08" }), series(80, 0)).status === "stalled");
ok("после проверки замеров мало — нужны данные", run(prof({ checkedAt: "2026-11-08" }), series(80, 0).slice(0, 2)).status === "need-data");
// Применение
const ap = applyCheck(prof(), -100, "2026-11-22");
ok("применение: поправка и дата", ap.adjust === -100 && ap.checkedAt === "2026-11-22");
ok("поправка накапливается и ограничена ±300", applyCheck({ ...prof(), adjust: -250 }, -150, "2026-11-22").adjust === -300);
ok("«оставить»: только дата", (() => { const a = applyCheck(prof(), 0, "2026-11-22"); return a.adjust === undefined && a.checkedAt === "2026-11-22"; })());
// Поправка в плане
const base = planFor(prof(), NOW)!, adj = planFor(prof({ adjust: 150 }), NOW)!;
ok("план: +150 ккал", adj.kcal - base.kcal >= 149 && adj.kcal - base.kcal <= 151, [base.kcal, adj.kcal]);
ok("план: темп снижения пересчитан", adj.weekly > base.weekly);
ok("план: макросы пересчитаны от новой калорийности", adj.carbs > base.carbs);
ok("план: ниже предела не уйдёт", planFor(prof({ weight: 55, adjust: -300 }), NOW)!.kcal >= 1200);
ok("план: при беременности поправка не применяется", planFor(prof({ pregnant: true, goal: "keep", adjust: 300 }), NOW)!.kcal === planFor(prof({ pregnant: true, goal: "keep" }), NOW)!.kcal);
ok("план: при состоянии здоровья поправка не применяется", planFor(prof({ health: { kidney: true }, adjust: 300 }), NOW)!.kcal === planFor(prof({ health: { kidney: true } }), NOW)!.kcal);
console.log(`goalcheck: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
