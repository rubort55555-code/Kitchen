// Собирает public/privacy.html из src/lib/privacy.ts: npm run privacy
import { writeFileSync } from "node:fs";
import { policyHtml } from "../src/lib/privacy";
writeFileSync("public/privacy.html", policyHtml());
console.log("public/privacy.html обновлён");
