import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { EmptyState, Screen } from '@/components/Screen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/api';
import { useNav } from '@/lib/nav';
import { qk } from '@/lib/query';
import { haptic } from '@/lib/telegram';
import { EVENT_TYPES, type Connection, type Subscription } from '@/lib/types';
import { NewSubscription } from './NewSubscription';

const EVENT_LABEL = new Map(EVENT_TYPES.map((e) => [e.value, e.label]));

export function Subscriptions() {
  const qc = useQueryClient();
  const { push } = useNav();

  const subsQ = useQuery({
    queryKey: qk.subscriptions,
    queryFn: () => api('/api/subscriptions') as Promise<{ subscriptions: Subscription[] }>,
  });
  const connsQ = useQuery({
    queryKey: qk.connections,
    queryFn: () => api('/api/connections') as Promise<{ connections: Connection[] }>,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/subscriptions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic.notify('success');
      toast.success('Subscription removed');
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
  });

  const subs = subsQ.data?.subscriptions ?? [];
  const conns = connsQ.data?.connections ?? [];
  const providerOf = (id: string) => conns.find((c) => c.id === id)?.provider ?? 'provider';

  return (
    <Screen
      title="Subscriptions"
      action={
        <Button size="sm" onClick={() => push(<NewSubscription />)} disabled={conns.length === 0}>
          <Plus className="size-4" /> New
        </Button>
      }
    >
      {subsQ.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : subs.length === 0 ? (
        <EmptyState>
          {conns.length === 0
            ? 'Connect a provider first, then subscribe to its events.'
            : 'No subscriptions yet. Tap “New” to create one.'}
        </EmptyState>
      ) : (
        subs.map((s) => {
          const containers = Array.isArray(s.filters.containers)
            ? (s.filters.containers as string[])
            : [];
          return (
            <Card key={s.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="size-4 text-muted-foreground" />
                  <CardTitle className="capitalize">{providerOf(s.connectionId)}</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => remove.mutate(s.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {s.eventTypes.map((e) => (
                    <Badge key={e} variant="secondary">
                      {EVENT_LABEL.get(e) ?? e}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {containers.length
                    ? `${containers.length} container filter${containers.length > 1 ? 's' : ''}`
                    : 'All containers'}
                </p>
              </CardContent>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
