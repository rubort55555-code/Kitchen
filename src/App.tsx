// Корень приложения: вкладки внизу, большая кнопка «+», окна поверх.
import { Icon, ToastView } from "./components/ui";
import { useStore } from "./lib/store";
import { goTab, openSheet, useUI, type Sheet, type Tab } from "./lib/ui";
import { Home } from "./screens/Home";
import { Products } from "./screens/Products";
import { Recipes, RecipeView } from "./screens/Recipes";
import { More, HelpSheet } from "./screens/More";
import { AddProduct } from "./screens/AddProduct";
import { ProductSheet } from "./screens/ProductSheet";
import { AskClaude } from "./screens/AskClaude";
import { Shop, BuySheet } from "./screens/Shop";
import { PickSheet } from "./screens/Menu";
import { CookSheet } from "./screens/Cook";
import { CookMode } from "./screens/CookMode";
import { Revision } from "./screens/Revision";
import { Receipt } from "./screens/Receipt";
import { RecipeEdit, RecipeNew } from "./screens/RecipeEdit";
import { Overdue, isExpired } from "./screens/Overdue";
import { useEffect } from "react";
import { ymd } from "./lib/util";

const TABS: { id: Tab; title: string; icon: typeof Icon.home }[] = [
  { id: "home", title: "Главная", icon: Icon.home },
  { id: "products", title: "Продукты", icon: Icon.fridge },
  { id: "recipes", title: "Рецепты", icon: Icon.book },
  { id: "shop", title: "Покупки", icon: Icon.cart },
];

function SheetView({ s }: { s: Sheet }) {
  switch (s.kind) {
    case "add": return <AddProduct />;
    case "product": return <ProductSheet id={s.id} />;
    case "help": return <HelpSheet screen={s.screen} />;
    case "ask": return <AskClaude week={s.week} />;
    case "pick": return <PickSheet date={s.date} slot={s.slot} />;
    case "buy": return <BuySheet />;
    case "recipe": return <RecipeView id={s.id} />;
    case "cook": return <CookSheet id={s.id} entry={s.entry} />;
    case "steps": return <CookMode id={s.id} />;
    case "overdue": return <Overdue />;
    case "revision": return <Revision />;
    case "receipt": return <Receipt mode={s.mode} />;
    case "recipeNew": return <RecipeNew mode={s.mode || "menu"} />;
    case "recipeEdit": return <RecipeEdit id={s.id} draft={s.draft} />;
  }
}

let askedNow = false;

export function App() {
  const ready = useStore((s) => s.ready);
  const tab = useUI((u) => u.tab);
  const sheets = useUI((u) => u.sheets);
  const update = useUI((u) => u.update);
  const asked = useStore((s) => s.settings.overdueAsked);
  const hasOverdue = useStore((s) => s.products.some(isExpired));
  // При открытии приложения (раз в день) спрашиваем о просроченном
  useEffect(() => {
    if (ready && hasOverdue && asked !== ymd() && !sheets.length && !askedNow) { askedNow = true; openSheet({ kind: "overdue" }); }
  }, [ready]);
  if (!ready) return <div className="screen"><p className="muted center" style={{ marginTop: 80 }}>Загрузка…</p></div>;
  return (
    <>
      {update && (
        <div className="update banner" style={{ background: "var(--card)", boxShadow: "0 6px 24px rgba(0,0,0,.18)" }}>
          <span className="txt">Есть новая версия приложения.</span>
          <button className="chip" aria-pressed="true" onClick={update}>Обновить</button>
        </div>
      )}
      <main>
        {tab === "home" && <Home />}
        {tab === "products" && <Products />}
        {tab === "recipes" && <Recipes />}
        {tab === "shop" && <Shop />}
        {tab === "more" && <More />}
      </main>
      <nav className="tabs" aria-label="Разделы">
        {TABS.slice(0, 2).map((t) => <TabButton key={t.id} t={t} active={tab === t.id} />)}
        <button className="plus" aria-label="Добавить продукт" onClick={() => openSheet({ kind: "add" })}><Icon.plus /></button>
        {TABS.slice(2).map((t) => <TabButton key={t.id} t={t} active={tab === t.id} />)}
      </nav>
      {sheets.map((s, i) => <SheetView key={i + s.kind} s={s} />)}
      <ToastView />
    </>
  );
}

function TabButton({ t, active }: { t: (typeof TABS)[number]; active: boolean }) {
  return (
    <button aria-current={active ? "page" : undefined} onClick={() => goTab(t.id)}>
      <t.icon />
      <span>{t.title}</span>
    </button>
  );
}
