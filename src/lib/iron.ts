// Железо: что усиливает и что мешает усвоению в приёме пищи. Этап 1 программы биодоступности
// (literature/nutrient-interactions/COVERAGE.md). Это качественная оценка «лучше / обычно / хуже», а не расчёт процента:
// опубликованные алгоритмы (Hallberg и Hulthén, 2000; Reddy и др., 2000) закрыты, расходятся между собой и
// недооценивают усвоение (Beard и др., 2007; De Carli и др., 2018), поэтому точных коэффициентов в приложении нет.
//
// Степень надёжности разметки (A–D, см. COVERAGE.md):
//   B — направление эффекта подтверждено обзорами и исследованиями на людях (мясо, рыба, яйца, молочное, чай/кофе/какао, бобовые);
//   C — общая категория продукта без точных данных (крупы, хлеб, орехи, овощи, фрукты);
//   D — данных нет: продукт не учитывается.
import type { CatalogItem, Meal, Recipe } from "./types";
import { findCatalog } from "./catalog";
import { gramsOf } from "./recipeNutrition";
import type { Hint } from "./interactions";
import { sumMeals } from "./diary";

/** bakery — очищенные зерновые продукты (мука, тесто, выпечка, лапша, белый рис, манка): фитатов меньше, чем в цельных крупах; данных об эффекте мало. */
export type IronFlag = "bakery" | "alcohol" | "meat" | "fish" | "organ" | "egg" | "dairy" | "legume" | "soy" | "nuts" | "grain" | "polyphenol";
export type Grade = "B" | "C" | "D";
export interface FoodIron { flags: IronFlag[]; grade: Grade; via: "name" | "category" | "none" }

const w = (src: string) => new RegExp("(?<![а-яё])(" + src + ")", "i");
// Слова — начала русских слов; перед словом не должно быть буквы, чтобы «сыр» не находился в «пастернак»
const RULES: { flag: IronFlag; re: RegExp; grade: Grade }[] = [
  { flag: "organ", re: w("печен|почк|сердц|язык|субпродукт|лёгк|легк|рубец"), grade: "B" },
  { flag: "meat", re: w("говя|свин|баран|телят|кролик|кури|кура(?![а-яё])|индейк|утк|утка|гус|мяс|фарш|ветчин|колбас|сосиск|бекон|грудин|окорок|шея|вырезк|стейк|котлет|тефтел|пельмен|голубц|азу(?![а-яё])|донер|манты(?![а-яё])|самс|чебурек|хинкал|беляш|фаршир|тушёнк|тушенк|фрикадел|биточ|шницел|бифштекс|люля|рёбрышк|ребрышк|гуляш|бефстроган|паштет|цыплён|цыплен|медальон|купат|лангет|зраз|шашлык|кебаб|шаурм|гамбургер|сардельк|буженин|карбонад|холодец|тефтел"), grade: "B" },
  { flag: "fish", re: w("рыб|лосос|форел|сёмг|семг|сельд|скумбр|треск|минта|хек(?![а-яё])|тунец|тунц|сардин|кальмар|креветк|мидии|мидий|морепрод|краб|карп|щук|судак|окун|горбуш|кета(?![а-яё])|шпрот|сайр|иваси|анчоус|(красн|чёрн|черн)[а-я]* икр|икра (красн|чёрн|черн|лосос|минтаев|щучь)|кильк|салак|шпроты|селёдк|селедк|форшмак|ух[аи](?![а-яё])|осьминог|гребешк|кани(?![а-яё])|хондаси|дасида|масаго|тобико"), grade: "B" },
  { flag: "egg", re: w("яйц|яичн|омлет|тамаго|безе(?![а-яё])|меренг"), grade: "B" },
  { flag: "dairy", re: w("молок|молоч|сыр(?![а-яё])|сыра(?![а-яё])|сыры(?![а-яё])|сырн|сырок|сырк|творог|творож|кефир|йогурт|ряженк|сливк|сметан|брынз|моцарел|пармезан|рикотт|простокваш|сгущ|тильзит|данаблю|таледжо|мизитра|курт(?![а-яё])|крут(?![а-яё])|айран|раит[аы]|мороженое|пломбир|джелато|дульсе"), grade: "B" },
  { flag: "soy", re: w("со[ея]в|тофу|соя(?![а-яё])|темпе|натто|мисо(?![а-яё])|юба(?![а-яё])|тенджан"), grade: "B" },
  { flag: "legume", re: w("фасол|чечевиц|нут(?![а-яё])|горох|горош|маш(?![а-яё])|бобы|бобов|хумус|лобио|лобиани|дал(?![а-яё])|нутов"), grade: "B" },
  { flag: "polyphenol", re: w("чай|чая(?![а-яё])|кофе|какао|шоколад|матча|мате(?![а-яё])|кэроб|ройбос"), grade: "B" },
  // Алкоголь по обзору Milman (2020) повышает усвоение железа, но в оценке и подсказках не используется: рекомендовать алкоголь нельзя
  { flag: "alcohol", re: w("вино|вина(?![а-яё])|пиво|водк|коньяк|виски|ликёр|ликер|вермут|шампанск|портвейн|херес|саке(?![а-яё])|самогон|абсент|настойк|наливк|асти(?![а-яё])|каберне|игристое|ром(?![а-яё])|джин(?![а-яё])|текил|сидр|шардоне|пино нуар|мадера|марсала|кагор|эль(?![а-яё])|гиннесс|самбука|ракия|глинтвейн|пунш|коктейль алкогольн|брага|бальзам(?![а-яё])"), grade: "B" },
  { flag: "nuts", re: w("орех|миндал|фундук|кешью|фисташ|арахис|семеч|кунжут|тахин|лён|льня|лен(?![а-яё])|чиа|мак(?![а-яё])|подсолнеч[а-я]* семен|семена"), grade: "C" },
  { flag: "grain", re: w("цельнозерн|отруб|овсян|овёс|ржан|гречк|гречнев|пшено|булгур|перловк|ячмен|пшениц|мюсли|гранол|хлопья|кукуруз|пшённ|пшенн|перлов|мамалыг|тостад|такос|клейковин|хлеб(?![а-яё])|хлебц|чумиз|инджер|фонио|(бур[а-я]+|коричнев[а-я]+|дик[а-я]+|нешлифован[а-я]+) рис|рис (бур|коричнев|дик|нешлифован)|тток|мотити|амадзаке|фуфу"), grade: "C" },
  // Изделия из очищенной муки: лапша, тесто, выпечка (степень C)
  { flag: "bakery", re: w("лапш|макарон|вермишел|спагетти|удон|рамен|сомен|тесто|корж|бисквит|кекс|маффин|капкейк|брауни|пряник|пряничн|плюшк|булочк|кулич|штрудел|пончик|эклер|профитрол|тарталет|слойк|круассан|рис(?![а-яё])|рисов|парбоилд|манн[аы]я|рогалик|лепёшк|лепешк|наан|пит[аы](?![а-яё])|брецел|тост|пицц|блин|оладь|вафл|сушки|сухар|панировк|кнедлик|клёцк|клецк|ньокки|вареник|равиоли|тортеллини|каппеллетти|пирожк|пирог|хачапури|фокачч|дораяки|кальцоне|вафельн|сухой торт|торт|паста безглютенов|паста замороженн|савоярди|чак-чак"), grade: "C" },
];

// Категории справочника, где без названия понятно, что это
const CATEGORY: Record<string, { flags: IronFlag[]; grade: Grade }> = {
  "Мясо": { flags: ["meat"], grade: "B" },
  "Птица": { flags: ["meat"], grade: "B" },
  "Рыба": { flags: ["fish"], grade: "B" },
  "Молочное": { flags: ["dairy"], grade: "B" },
  "Яйца": { flags: ["egg"], grade: "B" },
  "Орехи и семечки": { flags: ["nuts"], grade: "C" },
  "Крупы": { flags: ["grain"], grade: "C" },
  "Хлеб": { flags: ["grain"], grade: "C" },
  "Овощи": { flags: [], grade: "C" },
  "Фрукты": { flags: [], grade: "C" },
  "Зелень": { flags: [], grade: "C" },
  // Специи кладут граммами: на железо заметно не влияют (степень C: вывод по количеству, исследований нет)
  "Специи": { flags: [], grade: "C" },
};
// Продукты, не влияющие на усвоение железа заметно: масла, сахар, соль, сладости, соки, специи, соусы (граммы или чистые жиры и сахара).
// Степень C: «не влияет» — вывод по составу (нет ни железа, ни веществ, меняющих его усвоение), отдельных исследований нет.
const NEUTRAL = w("масл|сахар|соль(?![а-яё])|соли(?![а-яё])|уксус|сода(?![а-яё])|крахмал|разрыхл|желатин|мёд(?![а-яё])|мед(?![а-яё])|варень|джем|конфет|мармелад|пастил|сироп|лимонн[а-я]* кислот|сок(?![а-яё])|сока(?![а-яё])|соки(?![а-яё])|нектар|морс|компот|лимонад|квас|вода(?![а-яё])|воды(?![а-яё])|воду(?![а-яё])|лёд(?![а-яё])|специ|перец|лавров|паприк|карри|зира|корица|ванил|гвоздик|кориандр|имбир|куркум|мускат|шафран|орегано|базилик|тимьян|розмарин|укроп|петрушк|кетчуп|майонез|горчиц|хрен(?![а-яё])|соус|оливк|каперс|мука(?![а-яё])|муку(?![а-яё])|муки(?![а-яё])|сухар|панировк|дрожж|кокос|сливочн[а-я]* масл|топлён|жир(?![а-яё])|сало(?![а-яё])|мороженое|пломбир|сорбет|халва|шоколадн[а-я]* паст|зефир|печень[а-я]* песочн");
// Блюда типичного состава: название не называет ингредиенты, но рецепт в принципе включает их. Степень C («типичный состав»):
// в конкретной порции состав может отличаться, поэтому такие признаки слабее прямых.
const TYPICAL: { re: RegExp; flags: IronFlag[] }[] = [
  { re: w("кордон блю"), flags: ["meat", "dairy"] },
  { re: w("гирос|донер|шаурм|бургер|хот-дог|хот дог|долма|колдун|позы(?![а-яё])|гёдза|гедза|дим сам|баодз|вонтон|эмпанадас|кутабы"), flags: ["meat", "bakery"] },
  { re: w("лазанья"), flags: ["meat", "dairy", "bakery"] },
  { re: w("карбонара"), flags: ["meat", "egg", "dairy", "bakery"] },
  { re: w("пицц|пиццетт|кальцоне"), flags: ["dairy", "bakery"] },
  { re: w("хачапури|ватрушк|вареники ленивые|запеканка творожн|чизкейк|тирамису"), flags: ["dairy", "bakery"] },
  { re: w("пудинг"), flags: ["dairy"] },
  { re: w("сейтан"), flags: ["grain"] },
  { re: w("гинкго"), flags: ["nuts"] },
  { re: w("суши|ролл|бенто|поке(?![а-яё])|гункан"), flags: ["fish", "bakery"] },
  { re: w("мимоза"), flags: ["fish", "egg"] },
  { re: w("греческий салат|салат греческий|капрезе|цацики|песто|пармез|ризотто"), flags: ["dairy"] },
  { re: w("солянк|харчо|борщ"), flags: ["meat"] },
  { re: w("айоли|майонез"), flags: ["egg"] },
  { re: w("баба гануш|тахин|халва|козинак|грильяж|нуга|пахлав|шекербур|чурчхел|паста фундуч|булочка с маком|мак(?![а-яё])"), flags: ["nuts"] },
  { re: w("фалафел|папад|анко"), flags: ["legume"] },
  { re: w("онигири|рис отварн|ризотто|каша рисов|каша манн"), flags: ["bakery"] },
  { re: w("каша пшённ|каша перлов|каша готов|каша быстр|каша мультизлак"), flags: ["grain"] },
];
// Растительные продукты и продукты без значимого влияния на железо: овощи, фрукты, зелень, грибы, соусы на овощах, сладости, сахарозаменители.
// Степень C («не влияет»): вывод по составу; исследований по каждому нет.
const PLANT = w("шиповник|кизил|алыч|лонган|помело|рамбутан|джекфрут|дуриан|папайя|манго|финик|айв|годжи|асаи|ананас|гранат|тутов|авокадо|плантайн|хлебное дерево|смузи|кисель|тклапи|пекмез|наршараб|пюре фруктов|пюре овощн|чой сум|гайлан|мизуна|водяной шпинат|редька|редис|дайкон|лотос|лопух|таро(?![а-яё])|юка(?![а-яё])|лемонграсс|лайм|мята|чеснок|бамбук|каштан|баклажан|огурц|капуст|кимчи|зауэркраут|томат|помидор|перц|пепперончини|чили|лечо|овощ|икра кабачков|сальса|аджика|харисса|чимичурри|айвар|тапенад|гуакамоле|чатни|гриб|шиисо|мицуба|мёга|сансё|тогараси|умэбоси|слив|картофел|картошк|пюре картофел|крокет|луков|морков|свёкл|свекл|зелень|укроп|петрушк|базилик|кориандр|кинза|имбир|чёрный чеснок|гхи|фарин|тапиок|приправ|специя|топпинг|посыпк|мастик|драже|тянучк|рахат|повидл|суфле|маршмеллоу|чупа|жевательн|щербет|сладкая вата|эритрит|ксилит|фруктоз|лактоз|стевия|агар|пектин|эссенци|краситель|кислота|панел|меласса|начинк|бальзамическ|изотоник|спрайт|фанта|буратино|порошок для напитка|шиповник|драник|черри|анчо(?![а-яё])|пасилья|ахи амарильо|кочу|лили|узвар|сбитень|компот");
// Причины, по которым данных об усвоении железа нет (для отчёта и подсказок)
export type UnknownWhy = "supplement" | "composite" | "seaweed" | "drink" | "other";
const WHY: { why: UnknownWhy; re: RegExp }[] = [
  { why: "supplement", re: w("протеин|гейнер|креатин|bcaa|предтреник|коллаген|омега|витамин|мультивитамин|заменитель питания|клетчатка|пыльца") },
  { why: "seaweed", re: w("нори|вакамэ|араме|ким(?![а-яё])|водоросл") },
  { why: "drink", re: w("кола(?![а-яё])|энергетическ|напиток|цикорий|коктейль|ключев") },
  { why: "composite", re: w("салат|суп|остатки|бутерброд|заливное|рамен|кофта|чапчхе|кулебяка|запеканка|сейтан|гарнир|плов|смесь|набор|кубик|заправка|крем|глазурь|основа|начинка|концентрат|расстегаи|пюре комбинированное|протеиновые") },
];
/** Почему у продукта нет оценки (D): для отчёта по покрытию. */
export function ironUnknownWhy(name: string): UnknownWhy {
  return WHY.find((x) => x.re.test(name))?.why ?? "other";
}

// Масло сливочное и подобное — молочные жиры без кальция и белка: на железо не влияют
const NOT_DAIRY = w("масл");

/** Железные свойства продукта по названию (без учёта количества). */
export function foodIron(name: string, cat?: CatalogItem | null): FoodIron {
  const flags = new Set<IronFlag>();
  let grade: Grade = "D";
  let via: FoodIron["via"] = "none";
  const bump = (g: Grade) => { if (grade === "D" || (grade === "C" && g === "B")) grade = g; };
  for (const r of RULES) {
    if (r.flag === "dairy" && NOT_DAIRY.test(name)) continue;
    if (r.re.test(name)) { flags.add(r.flag); bump(r.grade); via = "name"; }
  }
  // Цельные зерновые по названию («бурый рис», «овсянка») важнее «очищенных»; очищенные (лапша, белый рис, манка) не становятся «цельными» по категории
  if (flags.has("grain") && flags.has("bakery")) flags.delete("bakery");
  const refined = flags.has("bakery");
  const c = cat === undefined ? findCatalog(name) : cat;
  const cc = c ? CATEGORY[c.c] : undefined;
  if (cc) {
    let applied = false;
    for (const f of cc.flags) {
      if (f === "dairy" && NOT_DAIRY.test(name)) continue;
      if (f === "grain" && refined) continue;
      flags.add(f); applied = true;
    }
    if (via === "none") via = "category";
    // Категория без флагов (овощи, фрукты) или исключение (сливочное масло): влияния на железо нет, но продукт учтён
    bump(applied || cc.flags.length === 0 ? cc.grade : "C");
  }
  if (flags.has("organ")) flags.add("meat");
  // Блюда типичного состава добавляют признаки слабой степени (C); прямые признаки по названию сохраняют свою степень
  for (const t of TYPICAL) if (t.re.test(name)) { t.flags.forEach((f) => flags.add(f)); if (grade === "D") grade = "C"; if (via === "none") via = "name"; }
  // Явно нейтральный продукт без других признаков: влияния на железо нет, но он учтён
  if (!flags.size && (NEUTRAL.test(name) || PLANT.test(name))) { grade = grade === "D" ? "C" : grade; via = via === "none" ? "name" : via; }
  return { flags: [...flags], grade, via };
}

// ---------- Масштабирование: категории баз данных и состав с упаковки ----------
// Названия продуктов перечислить нельзя: в Open Food Facts около 4,9 млн товаров, в USDA SR Legacy 7 793 продукта (4 462 из них
// содержат ≥ 1 мг железа на 100 г), и так в каждой стране. Поэтому классифицируем по категориям, составу и тегам, а не по названию.

/** Слова-признаки в тегах категорий Open Food Facts (en:..., fr:...) и в английских названиях групп. */
const TAG_TOKENS: { flag: IronFlag; tokens: string[]; grade: Grade }[] = [
  { flag: "organ", tokens: ["liver", "offal", "kidney", "giblets", "foie", "tripe"], grade: "B" },
  { flag: "meat", tokens: ["meat", "meats", "beef", "pork", "lamb", "veal", "poultry", "chicken", "turkey", "duck", "sausage", "sausages", "ham", "bacon", "charcuterie", "salami", "game", "mutton", "venison", "viande", "viandes", "pate"], grade: "B" },
  { flag: "fish", tokens: ["fish", "fishes", "seafood", "tuna", "salmon", "sardine", "sardines", "herring", "mackerel", "cod", "shrimp", "shrimps", "mussel", "mussels", "crab", "oysters", "finfish", "shellfish", "poissons"], grade: "B" },
  { flag: "egg", tokens: ["egg", "eggs", "omelette", "omelettes"], grade: "B" },
  { flag: "dairy", tokens: ["dairy", "dairies", "milk", "milks", "cheese", "cheeses", "yogurt", "yogurts", "yoghurt", "yoghurts", "cream", "creams", "kefir", "curd", "quark", "laitiers"], grade: "B" },
  { flag: "soy", tokens: ["soy", "soya", "soybean", "tofu", "tempeh"], grade: "B" },
  { flag: "legume", tokens: ["legume", "legumes", "bean", "beans", "lentil", "lentils", "chickpea", "chickpeas", "pulses", "pulse", "hummus", "peas"], grade: "B" },
  { flag: "polyphenol", tokens: ["tea", "teas", "coffee", "coffees", "cocoa", "chocolate", "chocolates", "matcha"], grade: "B" },
  { flag: "alcohol", tokens: ["wine", "wines", "beer", "beers", "spirits", "liquor", "liqueur", "alcoholic", "vodka", "whisky", "cider"], grade: "B" },
  { flag: "nuts", tokens: ["nut", "nuts", "seed", "seeds", "almond", "almonds", "peanut", "peanuts", "hazelnut", "walnut", "cashew", "sesame", "tahini", "flaxseed", "chia"], grade: "C" },
  { flag: "grain", tokens: ["cereal", "cereals", "grain", "grains", "bread", "breads", "oat", "oats", "oatmeal", "wheat", "rye", "barley", "bran", "muesli", "granola", "pasta", "corn", "buckwheat", "millet", "bulgur", "bakery", "baked"], grade: "C" },
];
// Если в тегах есть слова про масло, жиры, сахар, специи — продукт нейтральный
const NEUTRAL_TOKENS = new Set(["oil", "oils", "fat", "fats", "butter", "sugar", "sugars", "sweeteners", "honey", "spice", "spices", "herbs", "salt", "vinegar", "sauce", "sauces", "condiments", "jam", "jams", "juice", "juices", "water", "waters", "soda", "sodas", "sweets", "candy", "confectionery", "snack"]);
const BUTTER_LIKE = new Set(["butter", "butters", "margarine", "oils", "oil"]);
const TRUE_DAIRY = ["milk", "milks", "cheese", "cheeses", "yogurt", "yogurts", "yoghurt", "yoghurts", "kefir", "curd", "quark"];

const tokensOf = (tags: string[]) => tags.flatMap((t) => t.replace(/^[a-z]{2}:/i, "").toLowerCase().split(/[^a-zа-яё]+/).filter(Boolean));

/** Свойства по тегам категорий (Open Food Facts, группы USDA). */
export function foodIronFromTags(tags: string[]): FoodIron {
  const toks = new Set(tokensOf(tags));
  const flags = new Set<IronFlag>();
  let grade: Grade = "D";
  for (const r of TAG_TOKENS) {
    if (!r.tokens.some((t) => toks.has(t))) continue;
    // Сливочное масло и маргарин лежат в категории «dairies», но кальция и молочного белка почти не дают
    if (r.flag === "dairy" && [...toks].some((t) => BUTTER_LIKE.has(t)) && !TRUE_DAIRY.some((t) => toks.has(t))) continue;
    flags.add(r.flag);
    if (grade === "D" || (grade === "C" && r.grade === "B")) grade = r.grade;
  }
  if (flags.has("organ")) flags.add("meat");
  if (!flags.size && [...toks].some((t) => NEUTRAL_TOKENS.has(t))) grade = "C";
  return { flags: [...flags], grade, via: grade === "D" ? "none" : "category" };
}

/** Группы USDA FoodData Central (SR Legacy, Foundation) → свойства. Группы со смешанным составом остаются без оценки (D). */
const USDA_GROUPS: Record<string, { flags: IronFlag[]; grade: Grade }> = {
  "Beef Products": { flags: ["meat"], grade: "B" },
  "Pork Products": { flags: ["meat"], grade: "B" },
  "Poultry Products": { flags: ["meat"], grade: "B" },
  "Lamb, Veal, and Game Products": { flags: ["meat"], grade: "B" },
  "Sausages and Luncheon Meats": { flags: ["meat"], grade: "B" },
  "Finfish and Shellfish Products": { flags: ["fish"], grade: "B" },
  "Dairy and Egg Products": { flags: ["dairy", "egg"], grade: "C" },
  "Legumes and Legume Products": { flags: ["legume"], grade: "B" },
  "Nut and Seed Products": { flags: ["nuts"], grade: "C" },
  "Cereal Grains and Pasta": { flags: ["grain"], grade: "C" },
  "Breakfast Cereals": { flags: ["grain"], grade: "C" },
  "Baked Products": { flags: ["grain"], grade: "C" },
  "Vegetables and Vegetable Products": { flags: [], grade: "C" },
  "Fruits and Fruit Juices": { flags: [], grade: "C" },
  "Fats and Oils": { flags: [], grade: "C" },
  "Sweets": { flags: [], grade: "C" },
  "Spices and Herbs": { flags: [], grade: "C" },
};
// Группы других баз (Canadian Nutrient File и др.) называются почти так же, но с отличиями в запятых и регистре
const normGroup = (s: string) => s.toLowerCase().replace(/[,]/g, "").replace(/\s+/g, " ").trim();
const GROUPS_NORM = new Map<string, { flags: IronFlag[]; grade: Grade }>(Object.entries(USDA_GROUPS).map(([k, v]) => [normGroup(k), v]));
// Дополнительные названия групп канадской базы CNF
for (const [k, v] of [["nuts and seeds", USDA_GROUPS["Nut and Seed Products"]], ["cereals grains and pasta", USDA_GROUPS["Cereal Grains and Pasta"]], ["fruits and fruit juices", USDA_GROUPS["Fruits and Fruit Juices"]], ["lamb veal and game", USDA_GROUPS["Lamb, Veal, and Game Products"]]] as const) GROUPS_NORM.set(k, v);
export function foodIronFromUsdaGroup(group: string): FoodIron {
  const g = GROUPS_NORM.get(normGroup(group));
  return g ? { flags: [...g.flags], grade: g.grade, via: "category" } : { flags: [], grade: "D", via: "none" };
}

/** Объединение оценок: признаки складываются, степень берётся лучшая из имеющихся (по принципу «есть данные»). */
export function mergeIron(...list: FoodIron[]): FoodIron {
  const flags = new Set<IronFlag>();
  let grade: Grade = "D";
  let via: FoodIron["via"] = "none";
  for (const f of list) {
    f.flags.forEach((x) => flags.add(x));
    if (f.grade === "B" || (f.grade === "C" && grade === "D")) grade = f.grade;
    if (f.via !== "none" && via === "none") via = f.via;
  }
  return { flags: [...flags], grade, via };
}

/** Свойства товара по штрихкоду: название, теги категорий, первые три компонента состава (список идёт по убыванию массы). */
export function foodIronOfProduct(title: string, cats?: string[], ingredients?: string): FoodIron {
  const parts = [foodIron(title), cats?.length ? foodIronFromTags(cats) : null];
  if (ingredients) {
    const head = ingredients.split(/[,;]/).slice(0, 3).join(", ");
    const ing = foodIron(head, null);
    // Из состава берём только то, что в начале списка (много в продукте); категория D из состава не портит
    if (ing.grade !== "D") parts.push({ ...ing, grade: "C" });
  }
  return mergeIron(...(parts.filter(Boolean) as FoodIron[]));
}

export interface IronContext { recipes: Recipe[] }
interface Part { name: string; grams: number; food: FoodIron }

/** Состав приёма пищи по продуктам, насколько он известен: из рецепта, из продукта справочника, из напитка. */
export function mealParts(m: Meal, ctx: IronContext): Part[] {
  if (m.recipeId) {
    const r = ctx.recipes.find((x) => x.id === m.recipeId);
    if (!r) return [];
    const eaten = m.servings ?? 1;
    const frac = eaten / Math.max(1, r.servings || 2);
    return r.ingredients.map((i) => ({ name: i.name, grams: (gramsOf(i) || 0) * frac, food: foodIron(i.name) }));
  }
  const g = m.qty?.match(/^(\d+(?:[.,]\d+)?)\s*(г|мл)/);
  const grams = g ? Number(g[1].replace(",", ".")) : 0;
  // Товар по штрихкоду: категории и состав с упаковки дают больше, чем название
  const food = m.cats || m.ingredients ? foodIronOfProduct(m.name, m.cats, m.ingredients) : foodIron(m.name);
  return [{ name: m.name, grams, food }];
}

export type IronLevel = "better" | "usual" | "worse";
export interface IronMeal {
  slot: string;
  /** Железа в приёме, мг. */
  mg: number;
  level: IronLevel;
  /** Что усиливает усвоение, что мешает — словами. */
  enhancers: string[];
  inhibitors: string[];
  /** Наихудшая степень надёжности среди учтённых факторов (A–D; для железа — не выше B). */
  grade: Grade;
  /** Доля веса приёма, для которой удалось определить продукты (0–1); без неё оценка неполная. */
  known: number;
}

// Пороги — эвристика приложения (степень C). Источник направления эффекта указан в SOURCES (interactions.ts).
export const IRON_MIN_MG = 1.5; // меньше — приём пищи не оцениваем: железа мало, вывод бессмысленен
export const MEAT_ENHANCER_G = 50; // 50 г мяса, рыбы или птицы в приёме заметно усиливают усвоение негемового железа (Piskin и др., 2022)
export const VITC_ENHANCER_MG = 50; // витамин C ≥ 50 мг в приёме; эффект зависит от дозы
export const CALCIUM_INHIBITOR_MG = 300; // кальций ≥ 300 мг в приёме (в исследовании 500 мг снижали усвоение с 10,2% до 4,8%)
export const PHYTATE_INHIBITOR_G = 30; // бобовые, орехи, цельные крупы ≥ 30 г сырого веса в приёме

/** Оценка приёма пищи (одного или нескольких блюд одного слота) по железу. null — железа слишком мало. */
export function analyzeIron(slot: string, meals: Meal[], ctx: IronContext): IronMeal | null {
  const s = sumMeals(meals);
  const mg = s.fe;
  if (mg < IRON_MIN_MG) return null;
  const parts = meals.flatMap((m) => mealParts(m, ctx));
  const totalG = parts.reduce((a, p) => a + p.grams, 0);
  const knownG = parts.filter((p) => p.food.grade !== "D").reduce((a, p) => a + p.grams, 0);
  const sum = (flag: IronFlag) => parts.filter((p) => p.food.flags.includes(flag)).reduce((a, p) => a + p.grams, 0);
  const has = (flag: IronFlag) => parts.some((p) => p.food.flags.includes(flag));
  const meatG = sum("meat") + sum("fish");
  const enh: string[] = [], inh: string[] = [];
  let grade: Grade = "B";
  if (meatG >= MEAT_ENHANCER_G) enh.push("мясо или рыба");
  if (s.vitC >= VITC_ENHANCER_MG) enh.push("витамин C");
  // Напитки с кофеином и полифенолами в том же приёме
  const poly = has("polyphenol") || meals.some((m) => (m.caffeine || 0) > 0 && /чай|кофе|эспрессо|какао/i.test(m.name));
  if (poly) inh.push("чай, кофе или какао");
  if (s.ca >= CALCIUM_INHIBITOR_MG) { inh.push("кальций (молочное)"); grade = "C"; }
  if (sum("legume") + sum("soy") + sum("nuts") + sum("grain") >= PHYTATE_INHIBITOR_G) { inh.push("фитаты (бобовые, орехи, цельные крупы)"); grade = "C"; }
  // Яйца и молочный белок тоже мешают (Hallberg и Hulthén, 2000; Milman, 2020), но слабо и без порога — в итоговый уровень не входят
  // Усилители и помехи не сокращают друг друга: чай рядом с мясом всё равно снижает усвоение — поэтому «смешанный» приём = «обычное»
  const level: IronLevel = enh.length && !inh.length ? "better" : inh.length && !enh.length ? "worse" : "usual";
  return {
    slot, mg, level, enhancers: enh, inhibitors: inh, grade,
    known: totalG ? Math.min(1, knownG / totalG) : parts.length ? 1 : 0,
  };
}

const fmt = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
export const LEVEL_TEXT: Record<IronLevel, string> = { better: "усвоится лучше обычного", usual: "усвоение обычное", worse: "усвоится хуже обычного" };

/** Подсказки по железу на день: только там, где есть что улучшить или о чём предупредить. */
export function ironHints(meals: Meal[], ctx: IronContext): Hint[] {
  const bySlot = new Map<string, Meal[]>();
  for (const m of meals) bySlot.set(m.slot, [...(bySlot.get(m.slot) || []), m]);
  const out: Hint[] = [];
  for (const [slot, list] of bySlot) {
    const r = analyzeIron(slot, list, ctx);
    if (!r) continue;
    const head = `Приём «${slot}»: железа ${fmt(r.mg)} мг`;
    if (r.inhibitors.some((x) => x.startsWith("чай"))) out.push({ id: `iron-tea:${slot}`, text: `${head}. Чай, кофе или какао в этом же приёме снижают усвоение железа (полифенолы, дубильные вещества) — даже если есть мясо. Лучше пить между приёмами пищи.`, src: ["milman2020", "piskin2022"] });
    if (r.inhibitors.some((x) => x.startsWith("кальций"))) out.push({ id: `iron-ca:${slot}`, text: `${head}. Много кальция (молочное) в одном приёме с железом слегка снижает его усвоение в этот приём (в среднем на 5–6 п.п.). Если запасов железа мало, молочное лучше отдельно от мяса, печени и бобовых; на гемоглобин при обычном питании эффект в испытаниях не виден.`, src: ["abioye2020", "grinder2004", "hennigar2015", "ali2026", "milman2020", "piskin2022"] });
    if (r.inhibitors.some((x) => x.startsWith("фитаты"))) out.push({ id: `iron-phytate:${slot}`, text: `${head}. Бобовые, орехи и цельные крупы содержат фитаты, которые связывают железо, цинк, кальций и магний и снижают их усвоение. Помогают замачивание, проращивание, ферментация (закваска) и витамин C рядом.`, src: ["chondrou2024", "dahdouh2019"] });
    if (!r.enhancers.length && !r.inhibitors.length) out.push({ id: `iron-c:${slot}`, text: `${head}, но без витамина C и мяса. Свежий перец, цитрусовые, квашеная капуста или зелень рядом повышают всасывание растительного железа в приём пищи; на гемоглобин и запасы за месяцы эффект в крупных испытаниях небольшой.`, src: ["heffernan2017", "deng2024", "nyakundi2026", "piskin2022"] });
  }
  return out;
}

/** Оценки по всем приёмам дня — для отдельной строки «Железо» в дневнике. */
export function ironDay(meals: Meal[], ctx: IronContext): IronMeal[] {
  const bySlot = new Map<string, Meal[]>();
  for (const m of meals) bySlot.set(m.slot, [...(bySlot.get(m.slot) || []), m]);
  return [...bySlot].map(([slot, list]) => analyzeIron(slot, list, ctx)).filter((x): x is IronMeal => !!x);
}
