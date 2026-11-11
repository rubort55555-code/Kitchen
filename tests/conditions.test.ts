// Проверка справочника «рекомендации при мочекаменной болезни»: node node_modules/.bin/tsx tests/conditions.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { COND_SOURCES, DISCLAIMER, URGENT_AMBULANCE, URGENT_DOCTOR, URO_RULES, hasHighOxalate, oxalateAvoided, rulesFor, rulesProblems, uroStatus, type Conditions } from "../src/lib/conditions";
import { micros, planFor, type BodyProfile } from "../src/lib/nutrition";
import { assess } from "../src/lib/assess";
import { autoPlan } from "../src/lib/autoplan";
import { evaluateMenu } from "../src/lib/menucheck";
import { uroHints } from "../src/lib/vitamins";
import { mealDrink } from "../src/lib/diary";
import { DRINKS, SOURCES } from "../src/lib/interactions";
import { parseRecipeText } from "../tools/recipes.mjs";
import type { Recipe } from "../src/lib/types";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const NOW = new Date("2026-11-10T12:00:00Z");
const body = (c: Conditions | undefined, o: Partial<BodyProfile> = {}): BodyProfile => ({ sex: "m", born: 1985, height: 180, weight: 80, goal: "keep", conditions: c, ...o });
const uro: Conditions = { uro: true, stone: "calcium-oxalate" };

// Правила
ok("у каждого правила есть источник, уровень и формулировка", rulesProblems().length === 0, rulesProblems());
ok("правило без источника не проходит проверку", rulesProblems([{ ...URO_RULES[0], sources: [] }]).length > 0 && rulesProblems([{ ...URO_RULES[0], sources: ["нет-такого"] }]).length > 0);
ok("слова «лечение» и «гарантия» запрещены в текстах правил", rulesProblems([{ ...URO_RULES[0], why: "лечение камней" }]).length > 0);
ok("в источниках указана редакция", Object.values(COND_SOURCES).every((s) => s.edition && s.cite));
ok("правила: вода, кальций, соль, белок на месте", ["fluid", "calcium", "salt", "protein"].every((id) => URO_RULES.some((r) => r.id === id)));
ok("пурины — только для мочекислых и неизвестного типа, и только текстом", rulesFor("calcium-phosphate").every((r) => r.id !== "purines") && rulesFor("uric-acid").some((r) => r.id === "purines" && r.textOnly));
ok("при ограничении жидкости совет пить больше заменён", rulesFor("unknown", true).find((r) => r.id === "fluid")!.title.includes("врач ограничил") && !rulesFor("unknown", true).find((r) => r.id === "fluid")!.app.includes("не меньше 2,5"));
ok("в текстах нет слов про лечение и растворение камней", [DISCLAIMER, ...URO_RULES.flatMap((r) => [r.title, r.app, r.why])].every((t) => !/лечебн|лечени|растворени|излечи/i.test(t)));
ok("срочные случаи: скорая (103/112) и врач в тот же день — раздельно", /103/.test(URGENT_AMBULANCE) && /112/.test(URGENT_AMBULANCE) && /тот же день/.test(URGENT_DOCTOR) && !/кровь в моче/.test(URGENT_AMBULANCE));
ok("дисклеймер: не лечит, не диагностирует, врач важнее", /не лечит/.test(DISCLAIMER) && /не диагностирует/.test(DISCLAIMER) && /следуйте назначению врача/.test(DISCLAIMER));

// Кому применяем
const st = (c: Conditions | undefined, o: Partial<BodyProfile> = {}, age = 41) => uroStatus(body(c, o), age);
ok("не отмечено — не применяется, причины нет", !st(undefined).active && !st(undefined).reason);
ok("отмечено — применяется", st(uro).active);
ok("дети — нет", !st(uro, {}, 15).active && !!st(uro, {}, 15).reason);
ok("беременность и кормление — нет", !st(uro, { pregnant: true }).active && !st(uro, { lactating: true }).active);
ok("болезнь почек — нет", !st(uro, { health: { kidney: true } }).active);
ok("расстройство пищевого поведения — нет", !st(uro, { health: { eating: true } }).active);
ok("высокий кальций в крови — нет", !st({ ...uro, calciumIssue: true }).active);
ok("операции на кишечнике — нет", !st({ ...uro, gut: true }).active);
ok("струвитные и редкие камни — нет, нужны назначения врача", !st({ uro: true, stone: "struvite" }).active && !st({ uro: true, stone: "other" }).active && /индивидуальных назначений/.test(st({ uro: true, stone: "other" }).reason!));
ok("после 65 лет потолок белка снят и есть предупреждение про воду", (() => { const x = st(uro, {}, 70); return x.active && !x.proteinCap && x.warnings.length >= 2; })());
ok("ИМТ ниже 18,5 — потолок белка снят", !st(uro, { weight: 55, height: 180 }).proteinCap);
ok("мочегонные — предупреждение про натрий", st({ ...uro, diuretics: true }).warnings.some((w) => /натри/.test(w)));
ok("оксалаты избегаем при кальций-оксалатных и неизвестном типе", oxalateAvoided("calcium-oxalate") && oxalateAvoided("unknown") && !oxalateAvoided("uric-acid"));
ok("высокие оксалаты: шпинат, щавель, миндаль", hasHighOxalate(["Шпинат"]) && hasHighOxalate(["Миндаль"]) && hasHighOxalate(["Щавель"]) && !hasHighOxalate(["Картофель", "Укроп"]));

// План
const base = planFor(body(undefined), NOW)!, p = planFor(body(uro), NOW)!;
ok("без режима нормы прежние и uro нет", !base.uro);
ok("вода не меньше 2,5 л", p.uro!.waterMin === 2.5 && p.water >= 2.5 && p.water >= base.water);
ok("белок 0,8–1,0 г на кг (80 кг: 64–80 г)", p.uro!.proteinMin === 64 && p.uro!.proteinMax === 80 && p.protein === 64, [p.uro, p.protein]);
ok("кальций 1000–1200 мг", p.uro!.caMin === 1000 && p.uro!.caMax === 1200 && micros(body(uro), NOW).find((m) => m.key === "ca")!.amount === 1000);
ok("натрий до 2000 мг (5 г соли)", p.naMax === 2000 && p.saltMax === 5);
const prot = planFor(body(uro, { goal: "protein" }), NOW)!;
ok("цель «больше белка» отключена", prot.goal === "keep" && prot.protein <= 80 && prot.warnings.some((w) => /белок/.test(w)));
const lose = planFor(body(uro, { goal: "lose", weight: 95 }), NOW)!;
ok("при похудении белок не выше 1 г на кг", lose.protein <= lose.uro!.proteinMax, [lose.protein, lose.uro]);
const heavy = planFor(body(uro, { weight: 130, height: 175 }), NOW)!;
ok("при ИМТ от 30 белок считается на массу при ИМТ 25 (не на фактическую)", heavy.uro!.proteinMax === Math.round(25 * 1.75 ** 2), heavy.uro);
const chf = planFor(body({ ...uro, fluidLimit: true }), NOW)!;
ok("ограничение жидкости: воду не повышаем", chf.water === base.water && chf.uro!.waterMin === base.water);
const old = planFor(body(uro, { born: 1950 }), NOW)!;
ok("после 65 лет потолок белка не применяется", old.uro!.proteinMax === 9999);
ok("в отказных случаях есть предупреждение с причиной и нет uro", (() => { const x = planFor(body({ ...uro, calciumIssue: true }), NOW)!; return !x.uro && x.warnings.some((w) => /кальци/.test(w)); })());

// Оценка рациона
const recipes: Recipe[] = readdirSync("recipes").filter((f) => f.endsWith(".txt")).flatMap((f) => parseRecipeText(readFileSync("recipes/" + f, "utf8"), f).recipes as Recipe[]);
const days = Array.from({ length: 7 }, (_, i) => `2026-11-${11 + i}`);
const meal = (n: Record<string, number>) => ({ id: "m", date: days[0], t: 1, slot: "обед" as const, name: "Блюдо", n });
const aOk = assess([meal({ kcal: p.kcal, protein: 70, ca: 1100 })] as never, p, body(uro), 0, [])!;
ok("оценка: белок 70 г в диапазоне 64–80 — в норме", aOk.macro.find((r) => r.key === "protein")!.status === "ok");
const aHigh = assess([meal({ kcal: p.kcal, protein: 95, ca: 1500 })] as never, p, body(uro), 0, [])!;
ok("оценка: белок 95 г — выше потолка; кальций 1500 — выше предела", aHigh.macro.find((r) => r.key === "protein")!.status === "over" && aHigh.limits.find((r) => r.key === "caMax")!.status === "over");
ok("без режима строки про кальций-предел нет", !assess([meal({ kcal: base.kcal, ca: 1500 })] as never, base, body(undefined), 0, [])!.limits.some((r) => r.key === "caMax"));

// Автоподбор: белок в диапазоне, кальций не выше 1200 в среднем, блюда с высокими оксалатами не ставим (это в automenu)
const person = { id: "m1", body: body(uro), plan: p };
const res = autoPlan({ recipes, allowed: (r) => !hasHighOxalate(r.ingredients.map((i) => i.name)), days, slots: ["завтрак", "обед", "ужин", "перекус"], fixed: [], people: [person], iterations: 8000 });
const ev = evaluateMenu(res.added.map((e) => ({ ...e, portions: res.portions[e.id] })), days, recipes, { id: "m1", body: body(uro) }, p, [[], [], [{ id: "m1", name: "Миша", allergies: [], dislikes: [] }]]);
ok("меню: белок каждого дня не выше 1 г на кг", ev.dayRes.every((d) => d.protein <= p.uro!.proteinMax + 1), ev.dayRes.map((d) => d.protein));
ok("меню: белок каждого дня не ниже 0,8 г на кг", ev.dayRes.every((d) => d.protein >= p.uro!.proteinMin - 1), ev.dayRes.map((d) => d.protein));
ok("меню: калории в пределах ±5% не менее чем в 5 днях из 7", ev.dayRes.filter((d) => d.kcalOk).length >= 5, ev.dayRes.map((d) => d.pct));
ok("меню: кальций в среднем не ниже 90% от 1000 мг", (ev.micro.find((m) => m.key === "ca")?.pct || 0) >= 90, ev.micro.find((m) => m.key === "ca"));
ok("меню: ни одного блюда с высокими оксалатами", res.added.every((e) => !hasHighOxalate(recipes.find((r) => r.id === e.recipeId)!.ingredients.map((i) => i.name))));

// Подсказки
const cola = mealDrink(DRINKS.find((d) => d.key === "cola")!, 1, days[0], "обед", "m1")!;
const tea = mealDrink(DRINKS.find((d) => d.key === "blackTea")!, 1, days[0], "обед", "m1")!;
ok("подсказка про газировку: на колу есть, на чай нет", uroHints([cola]).length === 1 && uroHints([tea]).length === 0);
ok("источник подсказки известен", uroHints([cola])[0].src.every((id) => id in SOURCES));
console.log(`conditions: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
