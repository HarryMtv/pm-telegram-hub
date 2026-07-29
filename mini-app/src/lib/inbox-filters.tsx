import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Inbox filter state, lifted out of the `Inbox` screen. `Inbox` unmounts whenever
 * a detail view is pushed or the user switches tabs (see `NavProvider`), so local
 * component state would reset. This provider lives above the swapping screen slot,
 * so the chosen filters survive navigation.
 */
export type InboxView = 'list' | 'board';

export interface InboxFilters {
  text: string;
  provider: string;
  category: string;
  view: InboxView;
}

interface InboxFiltersValue {
  filters: InboxFilters;
  setText: (v: string) => void;
  setProvider: (v: string) => void;
  setCategory: (v: string) => void;
  setView: (v: InboxView) => void;
}

const DEFAULTS: InboxFilters = { text: '', provider: 'all', category: 'all', view: 'list' };

const InboxFiltersContext = createContext<InboxFiltersValue | null>(null);

export function InboxFiltersProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState(DEFAULTS.text);
  const [provider, setProvider] = useState(DEFAULTS.provider);
  const [category, setCategory] = useState(DEFAULTS.category);
  const [view, setView] = useState<InboxView>(DEFAULTS.view);

  const value = useMemo<InboxFiltersValue>(
    () => ({ filters: { text, provider, category, view }, setText, setProvider, setCategory, setView }),
    [text, provider, category, view],
  );

  return <InboxFiltersContext.Provider value={value}>{children}</InboxFiltersContext.Provider>;
}

export function useInboxFilters(): InboxFiltersValue {
  const ctx = useContext(InboxFiltersContext);
  if (!ctx) throw new Error('useInboxFilters must be used within <InboxFiltersProvider>');
  return ctx;
}
