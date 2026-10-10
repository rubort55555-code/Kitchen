// Упрощённые типы React только для локальной проверки (в сборке на GitHub ставятся настоящие @types/react).
declare module "react" {
  export type ReactNode = any;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: readonly unknown[]): T;
  export interface MutableRefObject<T> { current: T }
  export interface RefObject<T> { current: T }
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, get: () => T): T;
  export function useId(): string;
  export const Fragment: any;
  export const StrictMode: any;
  export interface Context<T> { Provider: any; _t?: T }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export type FormEvent<T = Element> = { preventDefault(): void; target: T; currentTarget: T };
  export type ChangeEvent<T = Element> = { target: T; currentTarget: T };
  export type PointerEvent<T = Element> = globalThis.PointerEvent & { currentTarget: T };
  export type MouseEvent<T = Element> = globalThis.MouseEvent & { currentTarget: T };
  export type KeyboardEvent<T = Element> = globalThis.KeyboardEvent & { currentTarget: T };
  export type CSSProperties = Record<string, string | number | undefined>;
  const React: any; export default React;
}
