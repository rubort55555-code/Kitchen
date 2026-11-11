# McCance and Widdowson's The Composition of Foods Integrated Dataset (CoFID), набор 2021

Великобритания; набор ведёт и обновляет Quadram Institute (по его сайту). Лицензия — Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/); источник: https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid. Значения даны **на 100 г съедобной части**; «Tr» — следы, «N» — значимое количество, но не определено.

Файлы загружены владельцем проекта 11.11.2026 (по названиям и хешам соответствуют набору с gov.uk; не изменялись); сборка 2021 содержит данные по свинине, добавленные в 2021 году.

## Исходники (`source/`)

| Файл | Что это | SHA-256 |
|---|---|---|
| `CoFID_2021_integrated_dataset.xlsx` | 14 листов, 2 887 продуктов | `436e9445ef2adb2a75f3d7edd51302de3adad25385f9795fc94ba58bd030e97d` |
| `CoFID_old_foods.xlsx` | продукты, выведенные из набора ранее (393) | `b3f74af4016e14ebbe41590dc12221ba71c03e316dd0e61d7c96a4c869dc0ca1` |
| `CoFID_2021_user_guide.pdf` | руководство: определения, методы, группы, 37 страниц | `cbac83af403531f1db260a15de058ceca1c1bae6707a8748ee3788fee7f945ec` |

## Чанки (`chunks/`) — получены `tools/chunk-food-sources.py`

**`chunks/guide/`** — руководство по 10 страниц (PDF-фрагмент + текст):

| Чанк | Страницы | Символов текста |
|---|---|---|
| part01_p01-10 | 1–10 | 20278 |
| part02_p11-20 | 11–20 | 20797 |
| part03_p21-30 | 21–30 | 27597 |
| part04_p31-37 | 31–37 | 14393 |

**`chunks/foods/`** — продукты набора 2021 по группам верхнего уровня (приложение B руководства); один продукт — одна строка jsonl со слитыми значениями всех листов 1.2–1.14 (`n`: код показателя → значение; `code`, `name`, `desc`, `group`, `prev`, `refs`, `footnote`). Расшифровка кодов и единиц — `_schema.json`.

| Файл | Группа | Продуктов |
|---|---|---|
| `A_cereals-and-cereal-products.jsonl` | Cereals and cereal products | 378 |
| `B_milk-and-milk-products.jsonl` | Milk and milk products | 186 |
| `C_eggs.jsonl` | Eggs | 33 |
| `D_vegetables.jsonl` | Vegetables | 673 |
| `F_fruit.jsonl` | Fruit | 228 |
| `G_nuts-and-seeds.jsonl` | Nuts and seeds | 50 |
| `H_herbs-and-spices.jsonl` | Herbs and spices | 61 |
| `J_fish-and-fish-products.jsonl` | Fish and fish products | 285 |
| `M_meat-and-meat-products.jsonl` | Meat and meat products | 645 |
| `O_fats-and-oils.jsonl` | Fats and oils | 37 |
| `P_beverages.jsonl` | Beverages | 74 |
| `Q_alcoholic-beverages.jsonl` | Alcoholic beverages | 31 |
| `S_sugars-preserves-and-snacks.jsonl` | Sugars, preserves and snacks | 76 |
| `W_soups-sauces-and-miscellaneous-foods.jsonl` | Soups, sauces and miscellaneous foods | 130 |

**`chunks/old-foods/`** — то же для выведенных продуктов (393).

| Файл | Группа | Продуктов |
|---|---|---|
| `A_cereals-and-cereal-products.jsonl` | Cereals and cereal products | 36 |
| `B_milk-and-milk-products.jsonl` | Milk and milk products | 51 |
| `D_vegetables.jsonl` | Vegetables | 82 |
| `F_fruit.jsonl` | Fruit | 31 |
| `G_nuts-and-seeds.jsonl` | Nuts and seeds | 4 |
| `J_fish-and-fish-products.jsonl` | Fish and fish products | 15 |
| `M_meat-and-meat-products.jsonl` | Meat and meat products | 65 |
| `O_fats-and-oils.jsonl` | Fats and oils | 6 |
| `P_beverages.jsonl` | Beverages | 20 |
| `Q_alcoholic-beverages.jsonl` | Alcoholic beverages | 20 |
| `S_sugars-preserves-and-snacks.jsonl` | Sugars, preserves and snacks | 25 |
| `W_soups-sauces-and-miscellaneous-foods.jsonl` | Soups, sauces and miscellaneous foods | 38 |

## Проверка полноты (`python3 -I tools/verify-food-chunks.py`, 11.11.2026)

- Продуктов в чанках = строк данных в листах: 2 887 и 393.
- Каждая непустая ячейка данных (240 340 в основном файле и 29 141 в старом) сравнена с чанком заново: потерь 0, изменённых значений 0.
- Текст чанков руководства склеивается точно в текст всего PDF (37 стр.).
- **Особенность набора:** код `13-669` в самом xlsx стоит у двух разных продуктов — «Aubergine, flesh and skin» и «Watercress, raw». Поэтому листы слиты по позиции строки (порядок кодов во всех листах совпадает — проверяется), а обе записи помечены `"dup_code": true`.
- Значения хранятся как в файле: числа — числом, «Tr» и «N» — строкой. Пустые ячейки пропущены.
- Лист «1.1 Notes» и «List of tables» в чанки не входят — они есть в `source/` и в руководстве.
