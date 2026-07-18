import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useBackButton } from './telegram';

export type TabKey = 'connections' | 'subscriptions' | 'inbox' | 'mappings';

interface NavState {
  tab: TabKey;
  setTab: (tab: TabKey) => void;
  /** Push a full-screen detail view; the native BackButton pops it. */
  push: (node: ReactNode) => void;
  pop: () => void;
  depth: number;
}

const NavContext = createContext<NavState | null>(null);

export function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used within <NavProvider>');
  return ctx;
}

/**
 * Tab + detail-stack navigation for a Mini App (no URL bar). A non-empty detail
 * stack renders its top entry and wires the Telegram BackButton to pop; otherwise
 * the active tab screen renders under the bottom tab bar.
 */
export function NavProvider({
  tabs,
  children,
}: {
  tabs: Record<TabKey, ReactNode>;
  children: (activeScreen: ReactNode) => ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>('connections');
  const [stack, setStack] = useState<ReactNode[]>([]);

  const push = useCallback((node: ReactNode) => setStack((s) => [...s, node]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  // Show the BackButton whenever a detail view is on the stack.
  useBackButton(stack.length > 0 ? pop : undefined);

  const value = useMemo<NavState>(
    () => ({ tab, setTab, push, pop, depth: stack.length }),
    [tab, push, pop, stack.length],
  );

  const activeScreen = stack.length > 0 ? stack[stack.length - 1] : tabs[tab];

  return <NavContext.Provider value={value}>{children(activeScreen)}</NavContext.Provider>;
}
