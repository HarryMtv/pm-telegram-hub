import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ContainerTree } from '@/components/ContainerTree';
import { Screen } from '@/components/Screen';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/api';
import { useNav } from '@/lib/nav';
import { qk } from '@/lib/query';
import { haptic, useMainButton } from '@/lib/telegram';
import { EVENT_TYPES, type Connection } from '@/lib/types';

const DEFAULT_EVENTS = EVENT_TYPES.map((e) => e.value);

export function NewSubscription() {
  const qc = useQueryClient();
  const { pop } = useNav();
  const [connectionId, setConnectionId] = useState<string>('');
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [containers, setContainers] = useState<string[]>([]);

  const connsQ = useQuery({
    queryKey: qk.connections,
    queryFn: () => api('/api/connections') as Promise<{ connections: Connection[] }>,
  });
  const conns = connsQ.data?.connections ?? [];

  const save = useMutation({
    mutationFn: () =>
      api('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          connectionId,
          eventTypes: events,
          filters: containers.length ? { containers } : {},
        }),
      }),
    onSuccess: () => {
      haptic.notify('success');
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
      pop();
    },
  });

  const canSave = Boolean(connectionId) && events.length > 0;
  useMainButton({
    text: 'Save subscription',
    onClick: () => canSave && save.mutate(),
    enabled: canSave,
    loading: save.isPending,
  });

  function toggleEvent(value: string) {
    haptic.impact('light');
    setEvents((e) => (e.includes(value) ? e.filter((x) => x !== value) : [...e, value]));
  }

  return (
    <Screen title="New subscription">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={connectionId} onValueChange={setConnectionId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a connection" />
            </SelectTrigger>
            <SelectContent>
              {conns.map((c) => (
                <SelectItem key={c.id} value={c.id} className="capitalize">
                  {c.provider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {EVENT_TYPES.map((e) => (
            <Label key={e.value} className="justify-between font-normal">
              {e.label}
              <Checkbox checked={events.includes(e.value)} onCheckedChange={() => toggleEvent(e.value)} />
            </Label>
          ))}
        </CardContent>
      </Card>

      {connectionId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Container filter</CardTitle>
            <p className="text-xs text-muted-foreground">
              Leave empty to receive events from all containers.
            </p>
          </CardHeader>
          <CardContent>
            <ContainerTree
              connectionId={connectionId}
              mode="multi"
              selected={containers}
              onChange={setContainers}
            />
          </CardContent>
        </Card>
      )}
    </Screen>
  );
}
