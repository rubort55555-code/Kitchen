// Экран не гаснет, пока открыт режим готовки (Screen Wake Lock API; в Safari — с iOS 16.4).
let lock: any = null;
let want = false;

async function acquire() {
  try {
    const nav: any = navigator;
    if (!want || !nav.wakeLock || lock) return;
    lock = await nav.wakeLock.request("screen");
    lock.addEventListener?.("release", () => { lock = null; });
  } catch { lock = null; }
}
const onVisible = () => { if (document.visibilityState === "visible") acquire(); };

export const wakeSupported = () => !!(navigator as any).wakeLock;
export function keepAwake() {
  want = true;
  document.addEventListener("visibilitychange", onVisible);
  acquire();
}
export function allowSleep() {
  want = false;
  document.removeEventListener("visibilitychange", onVisible);
  try { lock?.release?.(); } catch { /* уже отпущен */ }
  lock = null;
}
export const isAwake = () => !!lock;
