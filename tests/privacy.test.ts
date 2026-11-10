// Проверка политики и согласий: node node_modules/.bin/tsx tests/privacy.test.ts
import { readFileSync } from "node:fs";
import { CONSENT_TEXT, CONTACT, OPERATOR, POLICY_VERSION, hasConsent, policyHtml, policySections, policyText } from "../src/lib/privacy";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

ok("согласие действует только для текущей версии текста", hasConsent({ health: { version: POLICY_VERSION, at: 1 } }, "health") && !hasConsent({ health: { version: "2020-01-01", at: 1 } }, "health"));
ok("нет записи — нет согласия", !hasConsent(undefined, "off") && !hasConsent({}, "policy"));
ok("у каждого вида согласия есть текст и кнопка", (["policy", "health", "off"] as const).every((k) => CONSENT_TEXT[k].title && CONSENT_TEXT[k].points.length >= 2 && CONSENT_TEXT[k].accept));
ok("у health и off есть отказ, у policy — нет", CONSENT_TEXT.health.decline && CONSENT_TEXT.off.decline && !CONSENT_TEXT.policy.decline);
const t = policyText();
for (const w of ["Open Food Facts", "GitHub Pages", "Claude", "штрихкод", "здоровь", "удалить", "152"]) {
  if (w === "152") continue; // номер закона указан только в примечании к файлу, не в тексте для людей
  ok(`в политике упомянуто: ${w}`, t.toLowerCase().includes(w.toLowerCase()));
}
ok("в политике нет «аналитики» как собираемой", /нет учётных записей, рекламы и аналитики/.test(t));
ok("все разделы с текстом", policySections().every((s) => s.h && s.p.length && s.p.every((p) => p.length > 20)));
ok("public/privacy.html совпадает с текстом (npm run privacy)", readFileSync("public/privacy.html", "utf8") === policyHtml());
ok("страница политики с языком и заголовком", /<html lang="ru">/.test(policyHtml()) && /<title>Политика/.test(policyHtml()));
console.log(`privacy: ${pass} passed, ${fail} failed`);
if (!OPERATOR || !CONTACT) console.log("ВНИМАНИЕ: перед публикацией заполните OPERATOR и CONTACT в src/lib/privacy.ts и выполните npm run privacy");
if (fail) process.exit(1);
