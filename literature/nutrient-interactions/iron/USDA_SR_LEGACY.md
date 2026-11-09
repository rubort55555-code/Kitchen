# Проверка разметки по железу: USDA SR Legacy

Источник: USDA FoodData Central, SR Legacy (апрель 2018), общественное достояние (CC0). Создано `tools/usda-iron-coverage.ts`; в репозиторий кладутся только счётчики.

Всего продуктов: **7793**; из них содержат железо ≥ 1 мг на 100 г: **4462**; ≥ 2,5 мг: **1851**.

Разметка по группам (`foodIronFromUsdaGroup` в `src/lib/iron.ts`):
- группа с оценкой B или C: продуктов **5985** (76.8%), из них железосодержащих (≥ 1 мг/100 г): **3619** (81.1% от всех железосодержащих);
- группа без оценки (D): 1808 продуктов, из них железосодержащих 843 — это смешанные группы (готовые блюда, детское питание, снеки, напитки и др.), для них нужна классификация по составу.

| Группа | Продуктов | ≥ 1 мг Fe/100 г | ≥ 2,5 мг | Оценка |
|---|---|---|---|---|
| Beef Products | 954 | 942 | 387 | B |
| Baked Products | 517 | 441 | 265 | C |
| Lamb, Veal, and Game Products | 464 | 413 | 95 | B |
| Vegetables and Vegetable Products | 814 | 292 | 72 | C |
| Poultry Products | 383 | 261 | 74 | B |
| Legumes and Legume Products | 290 | 235 | 106 | B |
| Fast Foods | 312 | 234 | 47 | D |
| Breakfast Cereals | 195 | 181 | 172 | C |
| Baby Foods | 345 | 155 | 86 | D |
| Snacks | 176 | 154 | 61 | D |
| Cereal Grains and Pasta | 181 | 136 | 81 | C |
| Nut and Seed Products | 137 | 124 | 96 | C |
| Pork Products | 336 | 122 | 14 | B |
| Sausages and Luncheon Meats | 167 | 120 | 21 | B |
| Sweets | 358 | 105 | 35 | C |
| American Indian/Alaska Native Foods | 165 | 105 | 73 | D |
| Finfish and Shellfish Products | 264 | 103 | 30 | B |
| Soups, Sauces, and Gravies | 254 | 59 | 12 | D |
| Meals, Entrees, and Side Dishes | 81 | 56 | 15 | D |
| Spices and Herbs | 63 | 53 | 51 | C |
| Fruits and Fruit Juices | 355 | 51 | 15 | C |
| Restaurant Foods | 109 | 40 | 6 | D |
| Beverages | 366 | 40 | 21 | D |
| Dairy and Egg Products | 291 | 34 | 16 | C |
| Fats and Oils | 216 | 6 | 0 | C |
