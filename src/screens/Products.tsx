// Экран «Продукты»: всё, что есть дома, по местам хранения. Свайп влево — списать.
import { useMemo, useRef, useState } from "react";
import { Header, Tip } from "../components/ui";
import { undoWriteOff, useStore, valueOf, writeOff } from "../lib/store";
import { findCatalog } from "../lib/catalog";
import type { Product, Reason } from "../lib/types";
import { PLACES } from "../lib/types";
import { daysLeft, freshness, norm, plural, rub, untilText } from "../lib/util";
import { qtyText } from "../lib/units";
import { openSheet, toast } from "../lib/ui";

type Filter = "all" | "soon" | "bad";

export function Products() {
  const products = useStore((s) => s.products);
  const custom = useStore((s) => s.settings.customCatalog);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const nq = norm(q);
    return products
      .filter((p) => !nq || norm(p.name).includes(nq))
      .filter((p) => filter === "all" || (filter === "soon" ? freshness(p.until) === "soon" : freshness(p.until) === "bad"))
      .sort((a, b) => (daysLeft(a.until) ?? 99999) - (daysLeft(b.until) ?? 99999) || a.name.localeCompare(b.name, "ru"));
  }, [products, q, filter]);
  const counts = useMemo(() => ({
    soon: products.filter((p) => freshness(p.until) === "soon").length,
    bad: products.filter((p) => freshness(p.until) === "bad").length,
  }), [products]);
  const total = products.reduce((s, p) => s + valueOf(p), 0);

  return (
    <div className="screen">
      <Header title="Продукты" screen="products" sub={products.length ? `${products.length} ${plural(products.length, "продукт", "продукта", "продуктов")} на ${rub(total)}` : undefined} />
      {products.length === 0 ? (
        <div className="empty">
          <div className="big">🧺</div>
          <p>Добавьте продукты из холодильника — и я подскажу, что приготовить.</p>
          <button className="btn" onClick={() => openSheet({ kind: "add" })}>Добавить продукт</button>
        </div>
      ) : (
        <>
          <input className="inp search" type="search" placeholder="Поиск" value={q} onChange={(e: any) => setQ(e.target.value)} aria-label="Поиск продукта" />
          <div className="chips" role="group" aria-label="Свежесть">
            <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Все</button>
            <button className="chip" aria-pressed={filter === "soon"} onClick={() => setFilter("soon")}>Скоро испортится{counts.soon ? ` · ${counts.soon}` : ""}</button>
            <button className="chip" aria-pressed={filter === "bad"} onClick={() => setFilter("bad")}>Просрочено{counts.bad ? ` · ${counts.bad}` : ""}</button>
          </div>
          <Tip id="swipe">Проведите по продукту влево, чтобы списать его: съели, пропало или выбросили.</Tip>
          {PLACES.map((place) => {
            const items = shown.filter((p) => p.place === place);
            if (!items.length) return null;
            return (
              <section key={place} aria-label={place}>
                <div className="group-h"><span>{place}</span><span>{rub(items.reduce((s, p) => s + valueOf(p), 0))}</span></div>
                <div className="list">
                  {items.map((p) => (
                    <SwipeRow key={p.id} p={p} emoji={findCatalog(p.name, custom)?.e || "🛒"} open={openId === p.id} setOpen={(o) => setOpenId(o ? p.id : null)} />
                  ))}
                </div>
              </section>
            );
          })}
          {shown.length === 0 && <p className="empty">Ничего не нашлось.</p>}
        </>
      )}
    </div>
  );
}

const ACT_W = 252;

/** Строка продукта со свайпом. */
export function SwipeRow({ p, emoji, open, setOpen }: { p: Product; emoji: string; open: boolean; setOpen: (o: boolean) => void }) {
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const st = useRef<{ x: number; y: number; base: number; moved: boolean; locked: "h" | "v" | null } | null>(null);
  const pos = drag ? dx : open ? -ACT_W : 0;
  const fr = freshness(p.until);

  function down(e: PointerEvent) {
    st.current = { x: e.clientX, y: e.clientY, base: open ? -ACT_W : 0, moved: false, locked: null };
  }
  function move(e: PointerEvent) {
    const s = st.current;
    if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.locked = Math.abs(mx) > Math.abs(my) ? "h" : "v";
      if (s.locked === "h") { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setDrag(true); }
    }
    if (s.locked !== "h") return;
    s.moved = true;
    setDx(Math.max(-ACT_W - 30, Math.min(0, s.base + mx)));
  }
  function up() {
    const s = st.current;
    st.current = null;
    if (!s) return;
    if (s.locked === "h") {
      setDrag(false);
      setOpen(dx < -70);
      return;
    }
    if (s.locked === null) {
      if (open) setOpen(false);
      else openSheet({ kind: "product", id: p.id });
    }
  }
  function act(reason: Reason) {
    setOpen(false);
    const u = writeOff(p.id, p.qty, reason);
    const word = reason === "eaten" ? "съедено" : reason === "spoiled" ? "пропало" : "выброшено";
    if (u) toast(`${p.name} — ${word}`, () => undoWriteOff(u));
  }
  const dl = daysLeft(p.until);
  return (
    <div className="swipe">
      <div className="acts" aria-hidden={!open}>
        <button className="a-eat" onClick={() => act("eaten")} tabIndex={open ? 0 : -1}>✓<span>Съели</span></button>
        <button className="a-spoil" onClick={() => act("spoiled")} tabIndex={open ? 0 : -1}>⌛<span>Пропало</span></button>
        <button className="a-throw" onClick={() => act("thrown")} tabIndex={open ? 0 : -1}>🗑<span>Выбросили</span></button>
      </div>
      <div
        className={"row li" + (drag ? " drag" : "")}
        style={{ transform: `translateX(${pos}px)` }}
        onPointerDown={down as any} onPointerMove={move as any} onPointerUp={up} onPointerCancel={() => { st.current = null; setDrag(false); }}
        role="button" tabIndex={0} aria-label={`${p.name}, ${qtyText(p.qty, p.unit)}, ${untilText(p.until)}`}
        onKeyDown={(e: any) => { if (e.key === "Enter") openSheet({ kind: "product", id: p.id }); }}
      >
        {fr !== "none" && <span className={"bar " + fr} />}
        <span className="ico">{emoji}</span>
        <div className="main">
          <div className="name">{p.name}</div>
          <div className={"meta" + (fr === "soon" ? " t-soon" : fr === "bad" ? " t-bad" : "")}>{qtyText(p.qty, p.unit)} · {dl === null ? "без срока" : untilText(p.until)}{p.opened ? " · вскрыто" : ""}</div>
        </div>
        <div className="end">{rub(valueOf(p))}</div>
      </div>
    </div>
  );
}
