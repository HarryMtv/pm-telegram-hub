import type { ReactNode } from 'react';

/** Standard screen frame: a title header and a scrollable body padded to clear
 * the fixed bottom tab bar. */
export function Screen({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">{title}</h1>
        {action}
      </header>
      <main className="flex-1 space-y-3 p-4 pb-28">{children}</main>
    </div>
  );
}

/** Muted, centered empty-state block. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
