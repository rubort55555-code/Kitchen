// Проверка сущностей «Продукт» и «Движение продукта»: node node_modules/.bin/tsx tests/domain-product.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { createProduct, costOf, valueOf, takeProduct, editProduct, openProduct, movement, repriceBought, type Product, type LogEntry } from "../src/domain";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

const AT = { id: "p1", now: 1000, today: "2026-11-15" };
const milk = createProduct({ name: "  Молоко ", qty: 1000, unit: "мл", place: "Холодильник", until: "2026-11-25", price: 90 }, AT);

// Создание
ok("название без пробелов по краям", milk.name === "Молоко");
ok("купленное = текущее количество", milk.initialQty === 1000 && milk.qty === 1000);
ok("дата покупки — сегодня, если не указана", milk.bought === "2026-11-15");
ok("id и время — те, что передали", milk.id === "p1" && milk.createdAt === 1000);
ok("отрицательная цена становится нулём", createProduct({ name: "x", qty: 1, unit: "шт", place: "Шкаф", until: null, price: -5 }, AT).price === 0);
ok("штрихкод сохраняется", createProduct({ name: "x", qty: 1, unit: "шт", place: "Шкаф", until: null, price: 1, barcode: "4601" }, AT).barcode === "4601");

// Стоимость
ok("стоимость части", costOf(milk, 200) === 18);
ok("стоимость остатка", valueOf({ ...milk, qty: 500 }) === 45);
ok("без купленного количества стоимость 0", costOf({ ...milk, initialQty: 0 }, 1) === 0);

// Списание
const t1 = takeProduct(milk, 200);
ok("взяли 200 мл — осталось 800", t1.left?.qty === 800 && t1.taken === 200 && t1.rub === 18, t1);
ok("исходная карточка не меняется", milk.qty === 1000);
const t2 = takeProduct(milk, 5000);
ok("больше, чем есть, взять нельзя", t2.taken === 1000 && t2.rub === 90);
ok("закончившийся продукт исчезает", t2.left === null);
ok("отрицательное количество ничего не берёт", takeProduct(milk, -3).taken === 0 && takeProduct(milk, -3).left?.qty === 1000);
const flour: Product = { ...milk, unit: "кг", qty: 0.3, initialQty: 1 };
ok("округление до тысячных: 0,3 − 0,1 = 0,2", takeProduct(flour, 0.1).left?.qty === 0.2);
ok("остаток меньше 0,001 считается закончившимся", takeProduct({ ...flour, qty: 0.1004 }, 0.1).left === null);

// Правка
const e1 = editProduct(milk, { qty: 1500 });
ok("стало больше купленного — купленное растёт", e1.product.initialQty === 1500 && e1.qtyDelta === 500);
const e2 = editProduct(milk, { qty: 400 });
ok("стало меньше — купленное прежнее", e2.product.initialQty === 1000 && e2.qtyDelta === -600);
ok("правка цены не меняет количество", editProduct(milk, { price: 100 }).qtyDelta === 0);

// Вскрытие
const o1 = openProduct(milk, "2026-11-15", 3);
ok("вскрыли: срок 3 дня с сегодня", o1.until === "2026-11-18" && o1.opened === "2026-11-15");
ok("срок только сокращается", openProduct({ ...milk, until: "2026-11-16" }, "2026-11-15", 3).until === "2026-11-16");
ok("без срока — появляется срок после вскрытия", openProduct({ ...milk, until: null }, "2026-11-15", 5).until === "2026-11-20");
ok("справочник не знает срока — срок прежний", openProduct(milk, "2026-11-15").until === "2026-11-25");

// Движение
const m = movement(milk, "eaten", 0.12345, 10.456, { id: "l1", now: 2000 }, "Каша");
ok("запись журнала: округление и поля", m.qty === 0.123 && m.rub === 10.46 && m.unit === "мл" && m.place === "Холодильник" && m.dish === "Каша" && m.t === 2000 && m.productId === "p1", m);
ok("без блюда поля dish нет", !("dish" in movement(milk, "spoiled", 1, 1, { id: "l2", now: 1 })));
const log: LogEntry[] = [
  movement(milk, "bought", 1000, 90, { id: "b", now: 1 }),
  movement(milk, "eaten", 200, 18, { id: "e", now: 2 }),
  movement({ ...milk, id: "other" }, "bought", 1, 50, { id: "o", now: 3 }),
];
const fixed = repriceBought(log, { ...milk, price: 120 });
ok("новая цена — только в записях «Куплено» этого продукта", fixed.length === 1 && fixed[0].id === "b" && fixed[0].rub === 120);

// Сущности ни от чего не зависят: импортируют только друг друга
const DIR = new URL("../src/domain/", import.meta.url);
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".ts"))) {
  const src = readFileSync(new URL(f, DIR), "utf8");
  const bad = [...src.matchAll(/from\s+"([^"]+)"/g)].map((x) => x[1]).filter((x) => !x.startsWith("./"));
  ok(`domain/${f} импортирует только сущности`, bad.length === 0, bad);
  ok(`domain/${f} не смотрит на часы и не придумывает id`, !/Date\.now\(|Math\.random\(/.test(src));
}

console.log(`domain-product: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
