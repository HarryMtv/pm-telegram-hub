import { useEffect, useState, type ReactNode } from 'react';

import { retrieveRawInitData } from '@telegram-apps/sdk-react';

import { BottomTabs } from '@/components/BottomTabs';
import { NavProvider, type TabKey } from '@/lib/nav';
import { Connections } from '@/screens/Connections';
import { Inbox } from '@/screens/Inbox';
import { Mappings } from '@/screens/Mappings';
import { Subscriptions } from '@/screens/Subscriptions';
import { api, getToken, setToken } from './api';

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-6 text-center text-sm">{children}</div>;
}

export function App() {
  const [authed, setAuthed] = useState<boolean>(!!getToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authed) return;
    let initDataRaw: string | undefined;
    try {
      initDataRaw = retrieveRawInitData();
    } catch {
      initDataRaw = undefined;
    }
    if (!initDataRaw) {
      setError('Open this app from Telegram to sign in.');
      return;
    }
    api('/api/auth/init-data', {
      method: 'POST',
      body: JSON.stringify({ initData: initDataRaw }),
    })
      .then(({ token }: { token: string }) => {
        setToken(token);
        setAuthed(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [authed]);

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
