// Проверка журнала замеров: node node_modules/.bin/tsx tests/body.test.ts
import { cleanMeasure, upsertMeasure, removeMeasure, seriesOf, trendPerWeek, changeOver, chartOf, type Measure } from "../src/lib/body";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

ok("пустой замер отбрасывается", cleanMeasure({ date: "2026-11-01" }) === null);
ok("вес вне границ отбрасывается", cleanMeasure({ date: "2026-11-01", weight: 5 }) === null && cleanMeasure({ date: "2026-11-01", weight: 700 }) === null);
ok("плохая дата отбрасывается", cleanMeasure({ date: "вчера", weight: 70 }) === null);
ok("округление до десятых", cleanMeasure({ date: "2026-11-01", weight: 70.26 })!.weight === 70.3);
let l: Measure[] = [];
l = upsertMeasure(l, { date: "2026-11-08", weight: 71 });
l = upsertMeasure(l, { date: "2026-11-01", weight: 72, waist: 80 });
ok("сортировка по дате", l[0].date === "2026-11-01" && l.length === 2);
l = upsertMeasure(l, { date: "2026-11-08", waist: 79 });
ok("та же дата дополняется, вес сохраняется", l.length === 2 && l[1].weight === 71 && l[1].waist === 79, l);
ok("некорректный замер список не меняет", upsertMeasure(l, { date: "2026-11-09", weight: 1 }) === l);
ok("удаление", removeMeasure(l, "2026-11-01").length === 1);
ok("ряд по показателю", seriesOf(l, "waist").length === 2 && seriesOf(l, "hips").length === 0);

// Тренд: −0,5 кг в неделю
const pts = [0, 7, 14, 21].map((d, i) => ({ date: `2026-11-${String(1 + d).padStart(2, "0")}`, v: 72 - 0.5 * i }));
ok("тренд −0,5 кг в неделю", trendPerWeek(pts) === -0.5, trendPerWeek(pts));
ok("по двум точкам тренд не считаем", trendPerWeek(pts.slice(0, 2)) === null);
ok("за менее чем неделю тренд не считаем", trendPerWeek([{ date: "2026-11-01", v: 70 }, { date: "2026-11-03", v: 70.5 }, { date: "2026-11-05", v: 71 }]) === null);
ok("старые замеры (> 28 дней) не входят", trendPerWeek([{ date: "2026-09-01", v: 90 }, { date: "2026-11-01", v: 70 }, { date: "2026-11-08", v: 70 }, { date: "2026-11-15", v: 70 }]) === 0);
// Изменение
const c = changeOver(pts, 7)!;
ok("за неделю −0,5", c.delta === -0.5 && c.from.date === "2026-11-15" && c.to.date === "2026-11-22", c);
ok("за месяц при короткой истории берёт самый ранний", changeOver(pts, 30)!.delta === -1.5);
ok("один замер — изменения нет", changeOver([pts[0]], 7) === null);
// График
const ch = chartOf(pts, 320, 120)!;
ok("на графике столько же точек", ch.dots.length === 4 && ch.path.startsWith("M"));
ok("первая точка слева, последняя справа", ch.dots[0].x === 8 && ch.dots[3].x === 312);
ok("убывающий ряд: последняя точка ниже первой", ch.dots[3].y > ch.dots[0].y);
ok("плоский ряд не ломается", chartOf([{ date: "2026-11-01", v: 70 }, { date: "2026-11-08", v: 70 }], 320, 120)!.dots.every((d) => isFinite(d.y)));
ok("пустой ряд — нет графика", chartOf([], 320, 120) === null);
console.log(`body: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
