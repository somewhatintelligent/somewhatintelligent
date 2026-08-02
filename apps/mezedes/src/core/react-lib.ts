const LIB_PREFIX = "__mezedes_lib__/";

export const LIB_FILES: Readonly<Record<string, string>> = {
  [`${LIB_PREFIX}jsx.d.ts`]: `type MezedesNode = any;

declare namespace JSX {
  interface Element extends MezedesNode {}
  interface ElementClass { render?: MezedesNode }
  interface ElementAttributesProperty { props: {} }
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: string | number | null | undefined }
  interface IntrinsicClassAttributes<T> { ref?: MezedesNode }
  interface IntrinsicElements { [name: string]: MezedesNode }
}

declare namespace React {
  type ReactNode = any;
  type ReactElement = any;
  type FC<P = any> = (props: P) => any;
  type FunctionComponent<P = any> = (props: P) => any;
  type ComponentType<P = any> = any;
  type PropsWithChildren<P = any> = P & { children?: any };
  type CSSProperties = any;
  type Key = string | number;
  type Ref<T = any> = any;
  type RefObject<T = any> = { current: T | null };
  type MutableRefObject<T = any> = { current: T };
  type SetStateAction<S = any> = S | ((prev: S) => S);
  type Dispatch<A = any> = (value: A) => void;
  type ChangeEvent<T = any> = any;
  type FormEvent<T = any> = any;
  type MouseEvent<T = any> = any;
  type KeyboardEvent<T = any> = any;
  type Context<T = any> = any;
}

declare module "react/jsx-runtime" {
  export namespace JSX {
    interface Element extends MezedesNode {}
    interface ElementClass { render?: MezedesNode }
    interface ElementAttributesProperty { props: {} }
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicAttributes { key?: string | number | null | undefined }
    interface IntrinsicClassAttributes<T> { ref?: MezedesNode }
    interface IntrinsicElements { [name: string]: MezedesNode }
  }
  export const Fragment: MezedesNode;
  export function jsx(type: MezedesNode, props: MezedesNode, key?: MezedesNode): JSX.Element;
  export function jsxs(type: MezedesNode, props: MezedesNode, key?: MezedesNode): JSX.Element;
}

declare module "react/jsx-dev-runtime" {
  export const Fragment: MezedesNode;
  export function jsxDEV(type: MezedesNode, props: MezedesNode, key?: MezedesNode): MezedesNode;
}

declare module "react" {
  export type ReactNode = React.ReactNode;
  export type ReactElement = React.ReactElement;
  export type FC<P = any> = React.FC<P>;
  export type FunctionComponent<P = any> = React.FunctionComponent<P>;
  export type ComponentType<P = any> = React.ComponentType<P>;
  export type PropsWithChildren<P = any> = React.PropsWithChildren<P>;
  export type CSSProperties = React.CSSProperties;
  export type Key = React.Key;
  export type Ref<T = any> = React.Ref<T>;
  export type RefObject<T = any> = React.RefObject<T>;
  export type MutableRefObject<T = any> = React.MutableRefObject<T>;
  export type SetStateAction<S = any> = React.SetStateAction<S>;
  export type Dispatch<A = any> = React.Dispatch<A>;
  export type ChangeEvent<T = any> = React.ChangeEvent<T>;
  export type FormEvent<T = any> = React.FormEvent<T>;
  export type MouseEvent<T = any> = React.MouseEvent<T>;
  export type KeyboardEvent<T = any> = React.KeyboardEvent<T>;
  export type Context<T = any> = React.Context<T>;

  export function useState<S = undefined>(
    initial?: S | (() => S),
  ): [S, (next: S | ((prev: S) => S)) => void];
  export function useReducer<S = any, A = any>(
    reducer: (state: S, action: A) => S,
    initial?: S,
    init?: MezedesNode,
  ): [S, (action: A) => void];
  export function useRef<T = any>(initial?: T | null): { current: T | null };
  export function useMemo<T>(factory: () => T, deps?: readonly MezedesNode[]): T;
  export function useCallback<T>(fn: T, deps?: readonly MezedesNode[]): T;
  export function useEffect(effect: () => void | (() => void), deps?: readonly MezedesNode[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly MezedesNode[]): void;
  export function useInsertionEffect(effect: () => void | (() => void), deps?: readonly MezedesNode[]): void;
  export function useContext<T>(context: MezedesNode): T;
  export function useId(): string;
  export function useTransition(): [boolean, (callback: () => void) => void];
  export function useDeferredValue<T>(value: T): T;
  export function useImperativeHandle<T>(ref: MezedesNode, init: () => T, deps?: readonly MezedesNode[]): void;
  export function useSyncExternalStore<T>(
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;
  export function useOptimistic<S, A = S>(state: S, reduce?: MezedesNode): [S, (action: A) => void];
  export function useActionState<S>(action: MezedesNode, initial: S): [S, MezedesNode, boolean];

  export function createContext<T>(value: T): MezedesNode;
  export function memo<T>(component: T, compare?: MezedesNode): T;
  export function forwardRef<T = any, P = any>(render: (props: P, ref: MezedesNode) => MezedesNode): MezedesNode;
  export function lazy<T>(load: () => Promise<{ default: T }>): T;
  export function startTransition(callback: () => void): void;
  export function createElement(type: MezedesNode, props?: MezedesNode, ...children: MezedesNode[]): MezedesNode;
  export function cloneElement(element: MezedesNode, props?: MezedesNode): MezedesNode;
  export function isValidElement(value: MezedesNode): boolean;

  export const Fragment: MezedesNode;
  export const StrictMode: MezedesNode;
  export const Suspense: MezedesNode;
  export const Profiler: MezedesNode;
  export const Children: MezedesNode;

  const React: MezedesNode;
  export default React;
}

declare module "react-dom" {
  export function createPortal(children: MezedesNode, container: MezedesNode, key?: MezedesNode): MezedesNode;
  export function flushSync<T>(fn: () => T): T;
  const ReactDOM: MezedesNode;
  export default ReactDOM;
}

declare module "react-dom/client" {
  export function createRoot(
    container: MezedesNode,
    options?: MezedesNode,
  ): { render(node: MezedesNode): void; unmount(): void };
  export function hydrateRoot(container: MezedesNode, node: MezedesNode, options?: MezedesNode): MezedesNode;
}
`,
};
