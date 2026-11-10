// Политика конфиденциальности и согласия: окно согласия, страница «Конфиденциальность», экран первого запуска.
import { useEffect, useState } from "react";
import { Header, Sheet } from "../components/ui";
import { eraseHealthData, getState, giveConsent, useStore, withdrawConsent } from "../lib/store";
import { resolveConsent } from "../lib/consent";
import { CONSENT_TEXT, CONTACT, POLICY_VERSION, hasConsent, policySections, type ConsentKind } from "../lib/privacy";
import { closeSheet, goPage, toast } from "../lib/ui";

/** Окно согласия: первый запуск (policy), раздел «Питание» (health), поиск по штрихкоду (off). */
export function ConsentSheet({ which }: { which: ConsentKind }) {
  const t = CONSENT_TEXT[which];
  const [full, setFull] = useState(false);
  // Закрыли окно, не выбрав, — это «нет»
  useEffect(() => () => resolveConsent(which, hasNow(which)), [which]);
  const answer = (ok: boolean) => { if (ok) giveConsent(which); resolveConsent(which, ok); closeSheet(); };
  // «policy» — уведомление: закрытие без кнопки не считается согласием, окно покажем при следующем запуске
  return (
    <Sheet title="Согласие" onClose={() => answer(false)}>
      <div style={{ paddingTop: 12 }}>
        <h2>{t.title}</h2>
        <p style={{ fontSize: 17, lineHeight: 1.45 }}>{t.lead}</p>
        <ul style={{ lineHeight: 1.5 }}>{t.points.map((x) => <li key={x}>{x}</li>)}</ul>
        <button className="link" aria-expanded={full} onClick={() => setFull(!full)}>{full ? "Скрыть политику" : "Прочитать политику целиком"}</button>
        {full && <PolicyText />}
        <button className="btn" onClick={() => answer(true)}>{t.accept}</button>
        {t.decline && <button className="btn ghost" onClick={() => answer(false)}>{t.decline}</button>}
      </div>
    </Sheet>
  );
}
const hasNow = (k: ConsentKind) => hasConsent(getState().settings.consent, k);

export function PolicyText() {
  return (
    <div className="policy">
      {policySections().map((s) => (
        <div key={s.h}><h4 className="nut-h">{s.h}</h4>{s.p.map((p) => <p key={p} className="small">{p}</p>)}</div>
      ))}
    </div>
  );
}

const LABEL: Record<ConsentKind, string> = { policy: "Политика прочитана", health: "Данные о здоровье и теле", off: "Поиск товара по штрихкоду (Open Food Facts)" };

/** Страница «Ещё → Конфиденциальность». */
export function PrivacyPage() {
  const consent = useStore((s) => s.settings.consent);
  const [confirm, setConfirm] = useState(false);
  const back = () => goPage(null);
  return (
    <div className="screen">
      <Header title="Конфиденциальность" screen="privacy" onBack={back} backText="Ещё" />
      <p className="muted mt0">Ваши записи хранятся только в памяти этого телефона. Версия текста: {POLICY_VERSION}.{CONTACT ? ` Контакт: ${CONTACT}.` : ""}</p>
      <div className="card">
        <h3>Согласия</h3>
        {(["policy", "health", "off"] as ConsentKind[]).map((k) => {
          const on = hasConsent(consent, k);
          return (
            <div key={k} className="kv">
              <span>{LABEL[k]}<br /><small className="muted">{on ? "дано " + new Date(consent![k]!.at).toLocaleDateString("ru-RU") : "не дано"}</small></span>
              {on
                ? (k === "policy" ? <span /> : <button className="link" onClick={() => { withdrawConsent(k); toast("Согласие отозвано"); }}>Отозвать</button>)
                : <button className="link" onClick={() => giveConsent(k)}>Дать</button>}
            </div>
          );
        })}
      </div>
      <div className="card">
        <h3>Удалить данные</h3>
        <p className="small mt0">Профили («Питание»: пол, год рождения, рост, вес, цель, состояние здоровья), замеры и записи о воде. Дневник съеденного и продукты останутся.</p>
        {confirm
          ? <div className="row2"><button className="btn danger" onClick={() => { eraseHealthData(); setConfirm(false); toast("Данные о теле и здоровье удалены"); }}>Да, удалить</button><button className="btn sec" onClick={() => setConfirm(false)}>Отмена</button></div>
          : <button className="btn ghost" style={{ color: "var(--bad)" }} onClick={() => setConfirm(true)}>Удалить данные о теле и здоровье</button>}
        <p className="muted small">Всё остальное стирается в «Ещё → Данные → Удалить всё».</p>
      </div>
      <h3>Политика конфиденциальности</h3>
      <PolicyText />
    </div>
  );
}
