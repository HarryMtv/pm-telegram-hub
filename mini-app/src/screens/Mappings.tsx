import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tags, Trash2 } from 'lucide-react';
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
import type { Connection, Mapping } from '@/lib/types';
import { NewMapping } from './NewMapping';

export function Mappings() {
  const qc = useQueryClient();
  const { push } = useNav();

  const mappingsQ = useQuery({
    queryKey: qk.mappings,
    queryFn: () => api('/api/mappings') as Promise<{ mappings: Mapping[] }>,
  });
  const connsQ = useQuery({
    queryKey: qk.connections,
    queryFn: () => api('/api/connections') as Promise<{ connections: Connection[] }>,
  });
  const conns = connsQ.data?.connections ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/mappings/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic.notify('success');
      toast.success('Alias removed');
      void qc.invalidateQueries({ queryKey: qk.mappings });
    },
  });

  const mappings = mappingsQ.data?.mappings ?? [];

  return (
    <Screen
      title="Aliases"
      action={
        <Button size="sm" onClick={() => push(<NewMapping />)} disabled={conns.length === 0}>
          <Plus className="size-4" /> New
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground">
        Aliases let you target a container from the bot: <code>/newtask Title #alias</code>.
      </p>
      {mappingsQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : mappings.length === 0 ? (
        <EmptyState>
          {conns.length === 0 ? 'Connect a provider first.' : 'No aliases yet.'}
        </EmptyState>
      ) : (
        mappings.map((m) => (
          <Card key={m.id}>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Tags className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">#{m.alias}</CardTitle>
                {m.isDefault && <Badge variant="secondary">default</Badge>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => remove.mutate(m.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              <span className="capitalize">{m.provider}</span> · {m.containerId}
            </CardContent>
          </Card>
        ))
      )}
    </Screen>
  );
}
