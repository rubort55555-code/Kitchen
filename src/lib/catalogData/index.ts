// Расширенный справочник: разновидности продуктов, полуфабрикаты и продукты разных кухонь.
import { DAIRY } from "./dairy";
import { MEAT } from "./meat";
import { FISH } from "./fish";
import { PRODUCE } from "./produce";
import { GRAINS } from "./grains";
import { PANTRY } from "./pantry";
import { SWEETS } from "./sweets";
import { SEMI } from "./semi";
import { DOUGH } from "./dough";
import { WORLD } from "./world";
import { DRINKS } from "./drinks";
import { CONFECT } from "./confect";
import { DELI } from "./deli";
import { WORLD2 } from "./world2";
import { GAPS } from "./gaps";
import type { CatalogItem } from "../types";

export const EXTRA: CatalogItem[] = [...DAIRY, ...MEAT, ...FISH, ...PRODUCE, ...GRAINS, ...PANTRY, ...SWEETS, ...SEMI, ...DOUGH, ...WORLD, ...DRINKS, ...CONFECT, ...DELI, ...WORLD2, ...GAPS];
