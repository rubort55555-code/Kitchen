// Общие элементы интерфейса: заголовок со значком «?», окно снизу, сообщения, подсказки.
import { useEffect, type ReactNode } from "react";
import { closeSheet, hideToast, openSheet, useUI } from "../lib/ui";
import type { Screen } from "../lib/help";
import { markTip, useStore } from "../lib/store";

export function Header({ title, sub, screen, onBack, backText = "Назад" }: { title: string; sub?: string; screen: Screen; onBack?: () => void; backText?: string }) {
  return (
    <>
      {onBack && (
        <button className="back" onClick={onBack} aria-label={backText}>
          <Chevron left /> {backText}
        </button>
      )}
      <div className="top">
        <h1>{title}</h1>
        <HelpButton screen={screen} />
      </div>
      {sub && <div className="sub">{sub}</div>}
    </>
  );
}

export function HelpButton({ screen }: { screen: Screen }) {
  return (
    <button className="helpbtn" aria-label="Помощь по этому экрану" onClick={() => openSheet({ kind: "help", screen })}>
      ?
    </button>
  );
}

/** Окно, выезжающее снизу. */
export function Sheet({ title, children, onClose, right, left, short }: { title: string; children: ReactNode; onClose?: () => void; right?: ReactNode; left?: ReactNode; short?: boolean }) {
  const close = onClose || closeSheet;
  useEffect(() => {
    // Пока окно открыто, страница под ним не прокручивается
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <>
      <div className="overlay" onClick={close} />
      <div className={"sheet" + (short ? " short" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-h">
          {left || <span style={{ minWidth: 70 }} />}
          <h2>{title}</h2>
          {right || <button className="x" onClick={close}>Готово</button>}
        </div>
        <div className="sheet-b">{children}</div>
      </div>
    </>
  );
}

export function ToastView() {
  const t = useUI((u) => u.toast);
  const sheetOpen = useUI((u) => u.sheets.length > 0);
  if (!t) return null;
  return (
    // Когда открыто окно, сообщение показываем сверху, чтобы оно не закрывало поля
    <div className={"toast" + (sheetOpen ? " top" : "")} role="status">
      <span className="txt">{t.text}</span>
      {t.undo && (
        <button onClick={() => { const f = t.undo!; hideToast(); f(); }}>Отменить</button>
      )}
    </div>
  );
}

/** Подсказка, которая показывается один раз. */
export function Tip({ id, children }: { id: string; children: ReactNode }) {
  const seen = useStore((s) => s.settings.tipsSeen.includes(id));
  const ready = useStore((s) => s.ready);
  if (!ready || seen) return null;
  return (
    <div className="tip">
      <span>💡</span>
      <span>{children}</span>
      <button onClick={() => markTip(id)}>Понятно</button>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; t: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.t}</button>
      ))}
    </div>
  );
}

export function Chevron({ left }: { left?: boolean }) {
  return (
    <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true" style={{ transform: left ? "rotate(180deg)" : undefined }}>
      <path d="M2 2l8 8-8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const P = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  home: () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>),
  fridge: () => (<svg viewBox="0 0 24 24" aria-hidden="true"><rect {...P} x="5" y="2.5" width="14" height="19" rx="2.5" /><path {...P} d="M5 10h14M9 6v2M9 13v3" /></svg>),
  book: () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3" /><path {...P} d="M9 8h7M9 11.5h5" /></svg>),
  more: () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 19V11M10 19V5M16 19v-6M22 19H2" /></svg>),
  plus: () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} strokeWidth={2.6} d="M12 5v14M5 12h14" /></svg>),
};
