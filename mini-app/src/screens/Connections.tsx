import { useState } from 'react';
import { api } from '@/api';
import { EmptyState, Screen } from '@/components/Screen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { qk } from '@/lib/query';
import { haptic } from '@/lib/telegram';
import type { AdapterMeta, Connection } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Onboarding {
  webhookUrl: string;
  secret: string;
}

export function Connections() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);

  const adaptersQ = useQuery({
    queryKey: qk.adapters,
    queryFn: () => api('/api/adapters') as Promise<{ adapters: AdapterMeta[] }>,
  });
  const connectionsQ = useQuery({
    queryKey: qk.connections,
    queryFn: () => api('/api/connections') as Promise<{ connections: Connection[] }>,
  });

  const connect = useMutation({
    mutationFn: (vars: { provider: string; credentials: Record<string, string> }) =>
      api('/api/connect', { method: 'POST', body: JSON.stringify(vars) }) as Promise<{
        onboarding?: Onboarding;
      }>,
    onSuccess: (res, vars) => {
      haptic.notify('success');
      setValues((v) => ({ ...v, [vars.provider]: {} }));
      void qc.invalidateQueries({ queryKey: qk.connections });
      if (res.onboarding) setOnboarding(res.onboarding);
      else toast.success(`Connected ${vars.provider}`);
    },
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => api(`/api/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic.notify('success');
      setConfirmId(null);
      toast.success('Disconnected');
      void qc.invalidateQueries({ queryKey: qk.connections });
    },
  });

  const connections = connectionsQ.data?.connections ?? [];
  const adapters = adaptersQ.data?.adapters ?? [];

  function setField(provider: string, key: string, value: string) {
    setValues((v) => ({ ...v, [provider]: { ...v[provider], [key]: value } }));
  }

  return (
    <Screen title="Connections">
      {/* Connected providers */}
      {connectionsQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : connections.length === 0 ? (
        <EmptyState>No providers connected yet. Add one below.</EmptyState>
      ) : (
        connections.map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Plug className="size-4 text-muted-foreground" />
                <CardTitle className="capitalize">{c.provider}</CardTitle>
                <Badge variant={c.isActive ? 'default' : 'secondary'}>
                  {c.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => setConfirmId(c.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </CardHeader>
          </Card>
        ))
      )}

      {/* Add a connection */}
      <h2 className="pt-2 text-sm font-semibold text-muted-foreground">Connect a provider</h2>
      {adaptersQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        adapters.map((a) => {
          const pending = connect.isPending && connect.variables?.provider === a.id;
          return (
            <Card key={a.id}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="capitalize">{a.id}</CardTitle>
                {a.capabilities.webhookSetup === 'admin-required' && (
                  <Badge variant="outline">admin webhook</Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {a.credentialFields.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`${a.id}-${f.key}`}>{f.label}</Label>
                    <Input
                      id={`${a.id}-${f.key}`}
                      type={f.type === 'token' || f.type === 'password' ? 'password' : 'text'}
                      placeholder={f.placeholder}
                      value={values[a.id]?.[f.key] ?? ''}
                      onChange={(e) => setField(a.id, f.key, e.target.value)}
                    />
                  </div>
                ))}
                <Button
                  className="w-full"
                  disabled={pending}
                  onClick={() =>
                    connect.mutate({ provider: a.id, credentials: values[a.id] ?? {} })
                  }
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  Connect {a.id}
                </Button>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Disconnect confirmation */}
      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect provider?</DialogTitle>
            <DialogDescription>
              This removes the connection, its webhook, and all its subscriptions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={() => confirmId && disconnect.mutate(confirmId)}
            >
              {disconnect.isPending && <Loader2 className="size-4 animate-spin" />}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin-webhook onboarding */}
      <Dialog open={onboarding !== null} onOpenChange={(o) => !o && setOnboarding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finish webhook setup</DialogTitle>
            <DialogDescription>
              Register this webhook in your provider’s admin console.
            </DialogDescription>
          </DialogHeader>
          {onboarding && (
            <div className="space-y-3">
              <CopyRow label="Webhook URL" value={onboarding.webhookUrl} />
              <CopyRow label="Secret" value={onboarding.secret} mono />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setOnboarding(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code
          className={`min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs ${mono ? 'font-mono' : ''}`}
        >
          {value}
        </code>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            haptic.impact('light');
            toast.success('Copied');
          }}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}
