// Запрос согласия «на лету»: askConsent("off") возвращает обещание — да или нет. Окно согласия показывает ConsentSheet (screens/Privacy.tsx).
import { getState } from "./store";
import { hasConsent, type ConsentKind } from "./privacy";
import { openSheet } from "./ui";

let pending: { which: ConsentKind; done: (ok: boolean) => void } | null = null;

export function askConsent(which: ConsentKind): Promise<boolean> {
  if (hasConsent(getState().settings.consent, which)) return Promise.resolve(true);
  return new Promise((done) => {
    pending?.done(false);
    pending = { which, done };
    openSheet({ kind: "consent", which });
  });
}
/** Окно согласия закрыто: ok — человек согласился. */
export function resolveConsent(which: ConsentKind, ok: boolean) {
  if (pending?.which === which) { pending.done(ok); pending = null; }
}
