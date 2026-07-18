import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ContainerTree } from '@/components/ContainerTree';
import { Screen } from '@/components/Screen';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/api';
import { useNav } from '@/lib/nav';
import { qk } from '@/lib/query';
import { haptic, useMainButton } from '@/lib/telegram';
import type { Connection } from '@/lib/types';

export function NewMapping() {
  const qc = useQueryClient();
  const { pop } = useNav();
  const [connectionId, setConnectionId] = useState('');
  const [containers, setContainers] = useState<string[]>([]);
  const [alias, setAlias] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const connsQ = useQuery({
    queryKey: qk.connections,
    queryFn: () => api('/api/connections') as Promise<{ connections: Connection[] }>,
  });
  const conns = connsQ.data?.connections ?? [];
  const provider = conns.find((c) => c.id === connectionId)?.provider;
  const containerId = containers[0];
  const cleanAlias = alias.trim().replace(/^#/, '');

  const save = useMutation({
    mutationFn: () =>
      api('/api/mappings', {
        method: 'POST',
        body: JSON.stringify({ provider, alias: cleanAlias, containerId, isDefault }),
      }),
    onSuccess: () => {
      haptic.notify('success');
      void qc.invalidateQueries({ queryKey: qk.mappings });
      pop();
    },
  });

  const canSave = Boolean(provider && containerId && cleanAlias);
  useMainButton({
    text: 'Save alias',
    onClick: () => canSave && save.mutate(),
    enabled: canSave,
    loading: save.isPending,
  });

  return (
    <Screen title="New alias">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alias</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="alias">Name</Label>
            <Input
              id="alias"
              placeholder="e.g. bugs"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          </div>
          <Label className="justify-between font-normal">
            Default for this provider
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </Label>
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={connectionId}
              onValueChange={(v) => {
                setConnectionId(v);
                setContainers([]);
              }}
            >
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
          </div>
        </CardContent>
      </Card>

      {connectionId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Container</CardTitle>
          </CardHeader>
          <CardContent>
            <ContainerTree
              connectionId={connectionId}
              mode="single"
              selected={containers}
              onChange={setContainers}
            />
          </CardContent>
        </Card>
      )}
    </Screen>
  );
}
