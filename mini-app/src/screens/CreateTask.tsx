import { useState } from 'react';
import { api } from '@/api';
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
import { Textarea } from '@/components/ui/textarea';
import { useNav } from '@/lib/nav';
import { qk } from '@/lib/query';
import { haptic, useMainButton } from '@/lib/telegram';
import type { Connection } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function CreateTask() {
  const qc = useQueryClient();
  const { pop } = useNav();
  const [connectionId, setConnectionId] = useState('');
  const [containers, setContainers] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const connsQ = useQuery({
    queryKey: qk.connections,
    queryFn: () => api('/api/connections') as Promise<{ connections: Connection[] }>,
  });
  const conns = connsQ.data?.connections ?? [];
  const containerId = containers[0];

  const create = useMutation({
    mutationFn: () =>
      api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          connectionId,
          containerId,
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      haptic.notify('success');
      toast.success('Task created');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      pop();
    },
  });

  const canCreate = Boolean(connectionId && containerId && name.trim());
  useMainButton({
    text: 'Create task',
    onClick: () => canCreate && create.mutate(),
    enabled: canCreate,
    loading: create.isPending,
  });

  return (
    <Screen title="New task">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="task-name">Name</Label>
            <Input
              id="task-name"
              placeholder="Task title"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              placeholder="Optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
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
            <p className="text-xs text-muted-foreground">Pick where the task is created.</p>
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
