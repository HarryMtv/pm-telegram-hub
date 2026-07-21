import { useNav, type TabKey } from '@/lib/nav';
import { haptic } from '@/lib/telegram';
import { cn } from '@/lib/utils';
import { Bell, Inbox, Plug, Tags, type LucideIcon } from 'lucide-react';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'connections', label: 'Connections', icon: Plug },
  { key: 'subscriptions', label: 'Alerts', icon: Bell },
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'mappings', label: 'Aliases', icon: Tags },
];

export function BottomTabs() {
  const { tab, setTab, depth } = useNav();
  // Hidden while a detail view is open (BackButton drives navigation there).
  if (depth > 0) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                haptic.impact('light');
                setTab(key);
              }}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('size-5', active && 'fill-primary/10')} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
