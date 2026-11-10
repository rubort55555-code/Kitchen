# Проверка разметки по железу: Canadian Nutrient File 2026

Источник: Health Canada, Canadian Nutrient File 2026, лицензия Open Government Licence — Canada (open.canada.ca). Создано `tools/usda-iron-coverage.ts`; в репозиторий кладутся только счётчики.

Всего продуктов: **5993**; из них содержат железо ≥ 1 мг на 100 г: **3234**; ≥ 2,5 мг: **1537**.

Разметка по группам (`foodIronFromUsdaGroup` в `src/lib/iron.ts`):
- группа с оценкой B или C: продуктов **4882** (81.5%), из них железосодержащих (≥ 1 мг/100 г): **2748** (85% от всех железосодержащих);
- группа без оценки (D): 1111 продуктов, из них железосодержащих 486 — это смешанные группы (готовые блюда, детское питание, снеки, напитки и др.), для них нужна классификация по составу.

| Группа | Продуктов | ≥ 1 мг Fe/100 г | ≥ 2,5 мг | Оценка |
|---|---|---|---|---|
| Baked Products | 573 | 523 | 330 | C |
| Lamb, Veal and Game | 363 | 316 | 147 | B |
| Vegetables and Vegetable Products | 790 | 303 | 83 | C |
| Poultry Products | 419 | 254 | 99 | B |
| Legumes and Legume Products | 223 | 214 | 101 | B |
| Breakfast cereals | 212 | 192 | 176 | C |
| Beef Products | 167 | 164 | 90 | B |
| Mixed Dishes | 215 | 133 | 19 | D |
| Finfish and Shellfish Products | 325 | 132 | 50 | B |
| Nuts and Seeds | 140 | 127 | 97 | C |
| Fast Foods | 137 | 116 | 28 | D |
| Cereals, Grains and Pasta | 152 | 107 | 64 | C |
| Pork Products | 208 | 96 | 14 | B |
| Sweets | 326 | 93 | 29 | C |
| Snacks | 97 | 86 | 27 | D |
| Soups, Sauces and Gravies | 279 | 64 | 26 | D |
| Sausages and Luncheon meats | 151 | 64 | 17 | B |
| Spices and Herbs | 63 | 54 | 51 | C |
| Fruits and fruit juices | 340 | 54 | 15 | C |
| Dairy and Egg Products | 296 | 51 | 10 | C |
| Babyfoods | 99 | 48 | 41 | D |
| Beverages | 284 | 39 | 23 | D |
| Fats and Oils | 134 | 4 | 0 | C |
