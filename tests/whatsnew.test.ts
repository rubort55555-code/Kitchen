// Проверка «Что нового»: node node_modules/.bin/tsx tests/whatsnew.test.ts
import { LATEST, RELEASES, shouldShowNews } from "../src/lib/whatsnew";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
ok("id выпусков уникальны", new Set(RELEASES.map((r) => r.id)).size === RELEASES.length);
ok("новые выпуски сверху", RELEASES.every((r, i) => i === 0 || RELEASES[i - 1].id > r.id));
ok("в выпуске есть пункты, и они не пустые", LATEST.items.length >= 3 && LATEST.items.every((x) => x.length > 20));
ok("существующему пользователю — показываем, пока не видел", shouldShowNews(undefined, false) && shouldShowNews("2020-01-01", false));
ok("увидел — не показываем", !shouldShowNews(LATEST.id, false));
ok("новичку не показываем", !shouldShowNews(undefined, true));
ok("в заметке сказано, что данные не удалены", /Данные не удалены/.test(LATEST.note || ""));
console.log(`whatsnew: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
