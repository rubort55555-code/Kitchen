# USDA National Nutrient Database for Standard Reference, Release 27 (SR27)

США, USDA Agricultural Research Service, Nutrient Data Laboratory, август 2014 (документация; данные — 15.08–02.09.2014). Общественное достояние. Страница выпуска: https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/methods-and-application-of-food-composition-laboratory/mafcl-site-pages/sr11-sr28/. Значения даны **на 100 г съедобной части**.

Скачано 11.11.2026 с `www.ars.usda.gov` (для этого хост добавлен в разрешённые окружения). Русский перевод титула и руководства — скриншоты владельца проекта (они остаются в чате; в репозитории — только английский оригинал).

В приложении используется **SR28** (пакет `fda-nutrient-database`), а не SR27: SR27 нужен для сравнения и как документ, который просил владелец проекта.

## Исходники (`source/`)

| Файл | Что это | SHA-256 |
|---|---|---|
| `sr27_doc.pdf` | документация SR27, 154 стр. | `d96972211f131063b0b4425d4463c287e642d3d70dfc52722ac6ec85fc91a192` |
| `sr27asc.zip` | полная база в ASCII (FOOD_DES, NUT_DATA 654 572 строки, NUTR_DEF 150 показателей, WEIGHT, FOOTNOTE, DATA_SRC, LANGUAL …) | `d2794d838b9ba2e9e002633f036cbf5c7ac05814b147ce7fc02a4b1d52c789bd` |
| `sr27abbr.zip` | сокращённая таблица ABBREV.txt (8 618 продуктов × 53 поля) | `203c82bc14d8f6ad2dc1265826f2b11035926259a6951dbb109793f3e5ff2968` |

Не скачивался: `sr27db.zip` (Microsoft Access, 22 МБ) — те же данные.

## Чанки (`chunks/`) — получены `tools/chunk-food-sources.py`

**`chunks/doc/`** — документация по 10 страниц (PDF-фрагмент + текст, раскладка сохранена; таблицы могут разъезжаться по колонкам — цифры сверять с PDF):

| Чанк | Страницы | Символов текста |
|---|---|---|
| part01_p01-10 | 1–10 | 25559 |
| part02_p11-20 | 11–20 | 31585 |
| part03_p21-30 | 21–30 | 32120 |
| part04_p31-40 | 31–40 | 24991 |
| part05_p41-50 | 41–50 | 20650 |
| part06_p51-60 | 51–60 | 23619 |
| part07_p61-70 | 61–70 | 30639 |
| part08_p71-80 | 71–80 | 29531 |
| part09_p81-90 | 81–90 | 25373 |
| part10_p91-100 | 91–100 | 26780 |
| part11_p101-110 | 101–110 | 24050 |
| part12_p111-120 | 111–120 | 27170 |
| part13_p121-130 | 121–130 | 28968 |
| part14_p131-140 | 131–140 | 16301 |
| part15_p141-150 | 141–150 | 14700 |
| part16_p151-154 | 151–154 | 4966 |

**`chunks/foods/`** — продукты по группам USDA (FD_GROUP): `ndb`, названия (`name` — краткое, `long`, `common`, `manuf`), доля отходов, 47 показателей `n` (ключи как в ABBREV.txt; единицы — `_schema.json`) и все бытовые меры из WEIGHT.txt (`measures`).

| Файл | Группа | Продуктов |
|---|---|---|
| `0100_dairy-and-egg-products.jsonl` | Dairy and Egg Products | 264 |
| `0200_spices-and-herbs.jsonl` | Spices and Herbs | 64 |
| `0300_baby-foods.jsonl` | Baby Foods | 362 |
| `0400_fats-and-oils.jsonl` | Fats and Oils | 219 |
| `0500_poultry-products.jsonl` | Poultry Products | 390 |
| `0600_soups-sauces-and-gravies.jsonl` | Soups, Sauces, and Gravies | 452 |
| `0700_sausages-and-luncheon-meats.jsonl` | Sausages and Luncheon Meats | 244 |
| `0800_breakfast-cereals.jsonl` | Breakfast Cereals | 363 |
| `0900_fruits-and-fruit-juices.jsonl` | Fruits and Fruit Juices | 346 |
| `1000_pork-products.jsonl` | Pork Products | 343 |
| `1100_vegetables-and-vegetable-products.jsonl` | Vegetables and Vegetable Products | 828 |
| `1200_nut-and-seed-products.jsonl` | Nut and Seed Products | 133 |
| `1300_beef-products.jsonl` | Beef Products | 946 |
| `1400_beverages.jsonl` | Beverages | 315 |
| `1500_finfish-and-shellfish-products.jsonl` | Finfish and Shellfish Products | 267 |
| `1600_legumes-and-legume-products.jsonl` | Legumes and Legume Products | 389 |
| `1700_lamb-veal-and-game-products.jsonl` | Lamb, Veal, and Game Products | 438 |
| `1800_baked-products.jsonl` | Baked Products | 797 |
| `1900_sweets.jsonl` | Sweets | 347 |
| `2000_cereal-grains-and-pasta.jsonl` | Cereal Grains and Pasta | 183 |
| `2100_fast-foods.jsonl` | Fast Foods | 371 |
| `2200_meals-entrees-and-side-dishes.jsonl` | Meals, Entrees, and Side Dishes | 113 |
| `2500_snacks.jsonl` | Snacks | 171 |
| `3500_american-indian-alaska-native-foods.jsonl` | American Indian/Alaska Native Foods | 165 |
| `3600_restaurant-foods.jsonl` | Restaurant Foods | 108 |

## Проверка полноты (`python3 -I tools/verify-food-chunks.py`, 11.11.2026)

- Продуктов в чанках 8 618 = строк ABBREV.txt = строк FOOD_DES.txt; значений проверено 331 115, расхождений 0.
- Бытовых мер в чанках 15 228 = строк WEIGHT.txt.
- Текст чанков документации = текст всего PDF (154 стр.).
- **Что не вошло в чанки:** показатели, которых нет в ABBREV.txt (аминокислоты, жирные кислоты по видам, фитостерины и др.) — только `source/sr27asc.zip` (NUT_DATA). Для 31 показателя приложения ABBREV достаточно; йода в SR27 нет совсем.
