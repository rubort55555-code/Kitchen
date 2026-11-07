// Оформление «по яркости»: пороги и запас у порогов (чтобы тема не мигала).
// Запуск: npx esbuild tests/theme.test.ts --bundle --platform=node | node
import { themeForBrightness as t, DARK_BELOW, SUN_FROM } from "../src/lib/themeRules";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

ok("пороги 30% и 80%", DARK_BELOW === 0.3 && SUN_FROM === 0.8);
ok("темно → тёмное", t(0.1, null) === "dark");
ok("обычно → светлое", t(0.55, null) === "light");
ok("максимум → солнце", t(1, null) === "sun");
ok("солнце выключено → светлое", t(1, null, false) === "light");
ok("тёмное держится чуть выше порога", t(0.32, "dark") === "dark");
ok("тёмное → светлое, когда заметно светлее", t(0.36, "dark") === "light");
ok("светлое держится чуть ниже порога", t(0.28, "light") === "light");
ok("светлое → тёмное, когда заметно темнее", t(0.24, "light") === "dark");
ok("светлое не прыгает в солнце на 81%", t(0.81, "light") === "light");
ok("светлое → солнце на 85%", t(0.85, "light") === "sun");
ok("солнце держится на 78%", t(0.78, "sun") === "sun");
ok("солнце → светлое на 74%", t(0.74, "sun") === "light");
ok("солнце, выключенное в настройках → светлое", t(0.95, "sun", false) === "light");

console.log(`\nОформление: ${pass} из ${pass + fail}`);
if (fail) process.exit(1);
