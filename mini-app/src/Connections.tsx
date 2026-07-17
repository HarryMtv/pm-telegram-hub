import { useEffect, useState } from 'react';

import { api } from './api';

interface CredentialField {
  key: string;
  label: string;
  type: 'token' | 'text' | 'url' | 'password';
  placeholder?: string;
}
interface AdapterMeta {
  id: string;
  capabilities: { webhookSetup: 'auto' | 'admin-required' };
  credentialFields: CredentialField[];
}
interface Connection {
  id: string;
  provider: string;
  isActive: boolean;
}

export function Connections() {
  const [adapters, setAdapters] = useState<AdapterMeta[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    const [{ adapters }, { connections }] = await Promise.all([
      api('/api/adapters'),
      api('/api/connections'),
    ]);
    setAdapters(adapters);
    setConnections(connections);
  }

  useEffect(() => {
    refresh().catch((err: Error) => setStatus(err.message));
  }, []);

  async function connect(
    provider: string,
    fields: CredentialField[],
    form: HTMLFormElement,
  ) {
    setStatus(null);
    const fd = new FormData(form);
    const credentials: Record<string, string> = {};
    for (const f of fields) credentials[f.key] = String(fd.get(f.key) ?? '');
    try {
      await api('/api/connect', {
        method: 'POST',
        body: JSON.stringify({ provider, credentials }),
      });
      form.reset();
      await refresh();
      setStatus(`✅ Connected ${provider}`);
    } catch (err) {
      setStatus(`❌ ${(err as Error).message}`);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Connections</h2>
      <ul>
        {connections.map((c) => (
          <li key={c.id}>
            {c.provider} {c.isActive ? '✅' : '⛔'}
          </li>
        ))}
        {connections.length === 0 && <li style={{ opacity: 0.6 }}>None yet</li>}
      </ul>

      <h3>Connect a provider</h3>
      {adapters.map((a) => (
        <form
          key={a.id}
          onSubmit={(e) => {
            e.preventDefault();
            void connect(a.id, a.credentialFields, e.currentTarget);
          }}
          style={{ marginBottom: 24 }}
        >
          <strong>{a.id}</strong>
          {a.credentialFields.map((f) => (
            <div key={f.key}>
              <label style={{ display: 'block' }}>{f.label}</label>
              <input
                name={f.key}
                type={f.type === 'token' || f.type === 'password' ? 'password' : 'text'}
                placeholder={f.placeholder}
                required
              />
            </div>
          ))}
          {a.capabilities.webhookSetup === 'admin-required' && (
            <p style={{ opacity: 0.7, fontSize: 14 }}>Requires admin webhook setup — instructions shown after connect.</p>
          )}
          <button type="submit">Connect {a.id}</button>
        </form>
      ))}

      {status && <p>{status}</p>}
    </div>
  );
}
