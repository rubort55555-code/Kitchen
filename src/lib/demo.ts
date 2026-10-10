// «Заполнить демо-данными»: продукты с ценами и 3 месяца правдоподобной истории.
import type { Backup } from "./store";
import { BACKUP_APP, defaultSettings } from "./store";
import type { LogEntry, Place, Product, Recipe, Unit } from "./types";
import { addDays, uid, ymd } from "./util";
import { parseAnswer } from "./claude";

type Spec = [name: string, qty: number, unit: Unit, price: number, place: Place, days: number | null, everyDays: number, spoilRate: number];
const SPECS: Spec[] = [
  ["Молоко", 1, "л", 95, "Холодильник", 7, 4, 0.4],
  ["Хлеб", 1, "шт", 65, "Шкаф", 4, 3, 0.35],
  ["Яйца", 10, "шт", 120, "Холодильник", 25, 7, 0.05],
  ["Куриное филе", 600, "г", 330, "Холодильник", 2, 7, 0.15],
  ["Укроп", 1, "уп", 60, "Холодильник", 5, 10, 0.7],
  ["Помидоры", 1, "кг", 260, "Холодильник", 7, 7, 0.2],
  ["Огурцы", 1, "кг", 190, "Холодильник", 7, 7, 0.15],
  ["Творог", 400, "г", 160, "Холодильник", 5, 10, 0.3],
  ["Сыр твёрдый", 300, "г", 290, "Холодильник", 30, 14, 0.05],
  ["Картофель", 2, "кг", 110, "Шкаф", 30, 14, 0.05],
  ["Бананы", 1, "кг", 150, "Шкаф", 5, 7, 0.25],
  ["Минтай", 800, "г", 380, "Морозилка", 90, 21, 0],
  ["Сметана", 300, "г", 110, "Холодильник", 14, 10, 0.2],
  ["Гречка", 900, "г", 120, "Шкаф", null, 30, 0],
];

export function makeDemo(): Backup {
  const now = Date.now(), day = 86400000, log: LogEntry[] = [];
  const products: Product[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lastBuy: Backup["settings"]["lastBuy"] = {};
  for (const [name, qty, unit, price0, place, days, every, spoil] of SPECS) {
    let n = 0;
    for (let t = now - 90 * day + rnd() * every * day; t < now; t += every * day * (0.8 + rnd() * 0.4)) {
      // цена понемногу растёт — чтобы было видно подорожание
      const price = Math.round(price0 * (0.92 + 0.1 * ((t - (now - 90 * day)) / (90 * day))) );
      log.push({ id: uid(), t, name, reason: "bought", qty, unit, rub: price, place });
      const end = t + (days ?? every) * day * 0.9;
      if (end > now) {
        const bought = ymd(new Date(t));
        products.push({ id: uid(), name, qty, initialQty: qty, unit, place, bought, until: days === null ? null : addDays(bought, days), price, opened: null, createdAt: t });
      } else if (rnd() < spoil) {
        const part = rnd() < 0.5 ? 1 : 0.5;
        if (part < 1) log.push({ id: uid(), t: end - day, name, reason: "eaten", qty: qty / 2, unit, rub: price / 2, place });
        log.push({ id: uid(), t: end, name, reason: rnd() < 0.8 ? "spoiled" : "thrown", qty: qty * part, unit, rub: price * part, place });
      } else {
        log.push({ id: uid(), t: end - day * rnd() * 2, name, reason: rnd() < 0.4 ? "cooked" : "eaten", qty, unit, rub: price, place });
      }
      n++;
      lastBuy[name.toLowerCase().replace(/ё/g, "е")] = { name, price, qty, unit, place, n, t };
    }
  }
  log.sort((a, b) => a.t - b.t);
  // В демо один продукт уже просрочен, один — «до завтра»
  const milk = products.find((p) => p.name === "Молоко");
  if (milk) milk.until = addDays(ymd(), -1);
  const dill = products.find((p) => p.name === "Укроп");
  if (dill) dill.until = addDays(ymd(), 1);
  const recipes: Recipe[] = parseAnswer(EXAMPLE_ANSWER).recipes.map((r) => ({ ...r, source: "manual" as const }));
  // Меню и список покупок для примера
  const today = ymd();
  const plan = [
    { id: uid(), date: today, slot: "ужин" as const, name: recipes[3]?.name || "Салат", recipeId: recipes[3]?.id },
    { id: uid(), date: addDays(today, 1), slot: "завтрак" as const, name: recipes[0]?.name || "Омлет", recipeId: recipes[0]?.id },
    { id: uid(), date: addDays(today, 1), slot: "ужин" as const, name: "Пельмени" },
  ];
  const shop = [
    { id: uid(), name: "Хлеб", amount: "1 шт", done: false, createdAt: now },
    { id: uid(), name: "Сметана", amount: "300 г", done: false, from: "Меню", createdAt: now },
    { id: uid(), name: "Бананы", amount: "1 кг", done: false, createdAt: now },
  ];
  return {
    app: BACKUP_APP, v: 1, at: new Date().toISOString(), products, log, recipes,
    settings: { ...defaultSettings(), lastBuy, lastBackup: Date.now(), plan, shop, planSlots: ["завтрак", "ужин"] },
  };
}

/** Пример ответа Claude для проверки исключений: обычное блюдо, треска (замена), холодец (скрыть), много семечек. */
export const EXAMPLE_ANSWER = `Вот что можно приготовить:

\`\`\`json
{"dishes":[
 {"name":"Омлет с сыром и укропом","minutes":15,"servings":2,"kind":"завтрак","why":"Укроп скоро испортится","ingredients":[{"name":"Яйца","amount":"4 шт"},{"name":"Молоко","amount":"100 мл"},{"name":"Сыр твёрдый","amount":"50 г"},{"name":"Укроп","amount":"пучок"},{"name":"Соль","amount":"по вкусу"}],"steps":["Взбейте яйца с молоком и солью","Добавьте тёртый сыр и рубленый укроп","Жарьте под крышкой на среднем огне 7–8 минут"]},
 {"name":"Треска, запечённая с картофелем","minutes":45,"servings":2,"kind":"ужин","ingredients":[{"name":"Филе трески","amount":"500 г"},{"name":"Картофель","amount":"600 г"},{"name":"Сметана","amount":"3 ст. л."}],"steps":["Нарежьте картофель кружками","Выложите треску на картофель, смажьте сметаной","Запекайте 35 минут при 190 °C"]},
 {"name":"Холодец из курицы","minutes":300,"servings":6,"kind":"закуска","ingredients":[{"name":"Курица целая","amount":"1,5 кг"},{"name":"Чеснок","amount":"3 зубчика"}],"steps":["Варите курицу 4 часа","Разберите мясо, залейте бульоном и охладите"]},
 {"name":"Салат с огурцами и семечками","minutes":10,"servings":2,"kind":"перекус","ingredients":[{"name":"Огурцы","amount":"2 шт"},{"name":"Помидоры","amount":"2 шт"},{"name":"Семечки подсолнечные","amount":"1 ст. л."},{"name":"Масло подсолнечное","amount":"1 ст. л."}],"steps":["Нарежьте овощи","Заправьте маслом и посыпьте семечками"]},
 {"name":"Козинаки из семечек","minutes":30,"servings":4,"ingredients":[{"name":"Семечки подсолнечные","amount":"200 г"},{"name":"Мёд","amount":"3 ст. л."}],"steps":["Обжарьте семечки","Смешайте с горячим мёдом и разровняйте"]}
]}
\`\`\``;

