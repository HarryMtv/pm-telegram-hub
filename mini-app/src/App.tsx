import { useEffect, useState, type ReactNode } from 'react';

import { BottomTabs } from '@/components/BottomTabs';
import { NavProvider, type TabKey } from '@/lib/nav';
import { Connections } from '@/screens/Connections';
import { Inbox } from '@/screens/Inbox';
import { Mappings } from '@/screens/Mappings';
import { Subscriptions } from '@/screens/Subscriptions';
import { authenticate, getToken, onAuthLost } from './api';

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-6 text-center text-sm">{children}</div>;
}

export function App() {
  // Optimistically trust a stored token so the app renders instantly; any 401
  // triggers a transparent re-auth in `api()`, and an unrecoverable failure
  // flips us back to the sign-in gate via `onAuthLost`.
  const [authed, setAuthed] = useState<boolean>(!!getToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = onAuthLost(() => {
      setAuthed(false);
      setError('Session expired — reopen the app from Telegram.');
    });

    if (!getToken()) {
      authenticate().then((ok) => {
        if (ok) {
          setAuthed(true);
          setError(null);
        } else {
          setError('Open this app from Telegram to sign in.');
        }
      });
    }

    return off;
  }, []);

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!authed) return <Centered>Authenticating…</Centered>;

  const tabs: Record<TabKey, ReactNode> = {
    connections: <Connections />,
    subscriptions: <Subscriptions />,
    inbox: <Inbox />,
    mappings: <Mappings />,
  };

  return (
    <NavProvider tabs={tabs}>
      {(screen) => (
        <>
          {screen}
          <BottomTabs />
        </>
      )}
    </NavProvider>
  );
}
