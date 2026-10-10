// Общие типы данных приложения.

export type Place = "Холодильник" | "Морозилка" | "Шкаф";
export const PLACES: Place[] = ["Холодильник", "Морозилка", "Шкаф"];

export type Unit = "г" | "кг" | "мл" | "л" | "шт" | "уп";
export const UNITS: Unit[] = ["шт", "г", "кг", "мл", "л", "уп"];

/** Тип рыбы в справочнике — по нему работает правило «белая морская рыба». */
export type FishType = "white_sea" | "red" | "river" | "other_sea";

/** Продукт, который лежит дома. */
export interface Product {
  id: string;
  name: string;
  /** Количество, которое осталось сейчас. */
  qty: number;
  /** Сколько было при покупке — нужно, чтобы считать стоимость остатка. */
  initialQty: number;
  unit: Unit;
  place: Place;
  /** Дата покупки, ГГГГ-ММ-ДД. */
  bought: string;
  /** Годен до, ГГГГ-ММ-ДД; null — срок не важен (соль, крупы). */
  until: string | null;
  /** Цена за всё купленное количество, ₽. */
  price: number;
  /** Дата вскрытия упаковки, если вскрыта. */
  opened?: string | null;
  createdAt: number;
}

/** Причина изменения количества — основа статистики «съедено / пропало / осталось». */
export type Reason = "bought" | "eaten" | "cooked" | "spoiled" | "thrown" | "adjust";

export const REASON_TEXT: Record<Reason, string> = {
  bought: "Куплено",
  eaten: "Съедено",
  cooked: "Приготовлено",
  spoiled: "Пропало",
  thrown: "Выброшено",
  adjust: "Исправлено",
};

export interface LogEntry {
  id: string;
  t: number;
  productId?: string;
  name: string;
  reason: Reason;
  qty: number;
  unit: Unit;
  /** Стоимость этого количества, ₽. */
  rub: number;
  place?: Place;
  dish?: string;
}

export interface Member {
  id: string;
  name: string;
  allergies: string[];
  dislikes: string[];
}

/** Уровень исключения: никогда / только немного / можно. */
export type Level = "never" | "little" | "ok";

export interface Rule {
  id: string;
  title: string;
  level: Level;
  /** Слова и начала слов, по которым узнаём продукт в тексте. */
  words: string[];
  /** Для рыбы: все рыбы этого типа из справочника тоже попадают под правило. */
  fishType?: FishType;
  /** Исключения из правила (их едим). */
  except?: string[];
  /** Для «только немного»: сколько столовых ложек на всё блюдо ещё можно. */
  limitTbsp?: number;
  /** "all" — для всех, иначе id человека. */
  who: string;
  /** Чем заменить. */
  replace?: string;
}

export interface Ingredient {
  name: string;
  amount: string;
}

export interface Recipe {
  id: string;
  name: string;
  minutes?: number;
  servings?: number;
  kind?: string;
  ingredients: Ingredient[];
  steps: string[];
  why?: string;
  source: "claude" | "old" | "manual" | "base";
  tags?: string[];
  fav?: boolean;
  note?: string;
  createdAt: number;
}

export interface CatalogItem {
  /** Название, как показываем. */
  n: string;
  /** Синонимы и начала слов для поиска. */
  s?: string[];
  /** Категория. */
  c: string;
  /** Значок. */
  e: string;
  /** Единица по умолчанию. */
  u: Unit;
  /** Место по умолчанию. */
  p: Place;
  /** Срок хранения в днях: [холодильник, морозилка, шкаф]; null — так не хранят; 0 — срок не важен. */
  d: [number | null, number | null, number | null];
  /** Сколько дней после вскрытия. */
  o?: number;
  /** Тип рыбы. */
  f?: FishType;
  /** Свой продукт, добавленный пользователем. */
  custom?: boolean;
}

/** Строка списка покупок. */
export interface ShopItem {
  id: string;
  name: string;
  /** Сколько купить — текстом, как написали («2 шт», «1 кг», «пачка»). */
  amount: string;
  done: boolean;
  /** Откуда: «Меню», название рецепта, «Запасы» или пусто (вручную). */
  from?: string;
  createdAt: number;
}

/** Минимальный запас: «всегда держать: яйца ≥ 10 шт». */
export interface MinStock { name: string; qty: number; unit: Unit }

export type Slot = "завтрак" | "обед" | "ужин";
export const SLOTS: Slot[] = ["завтрак", "обед", "ужин"];

/** Блюдо в меню на конкретный день. */
export interface PlanEntry {
  id: string;
  /** ГГГГ-ММ-ДД */
  date: string;
  slot: Slot;
  name: string;
  recipeId?: string;
  done?: boolean;
}

export interface Settings {
  shop: ShopItem[];
  minStock: MinStock[];
  plan: PlanEntry[];
  /** Какие приёмы пищи планируем. */
  planSlots: Slot[];
  members: Member[];
  rules: Rule[];
  /** Базовые продукты: не считаются недостающими. */
  basics: string[];
  lastBackup: number;
  tipsSeen: string[];
  customCatalog: CatalogItem[];
  /** Последние цены и количества по названию продукта. */
  lastBuy: Record<string, { name?: string; price: number; qty: number; unit: Unit; place: Place; n: number; t: number }>;
}
