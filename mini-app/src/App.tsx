import { useEffect, useState } from 'react';

import { retrieveLaunchParams } from '@telegram-apps/sdk-react';

import { api, getToken, setToken } from './api';
import { Connections } from './Connections';

export function App() {
  const [authed, setAuthed] = useState<boolean>(!!getToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authed) return;
    const { initDataRaw } = retrieveLaunchParams();
    if (!initDataRaw) {
      setError('No Telegram initData (open the app from Telegram).');
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

  if (error) return <div style={{ padding: 16 }}>⚠️ {error}</div>;
  if (!authed) return <div style={{ padding: 16 }}>Authenticating…</div>;
  return <Connections />;
}
