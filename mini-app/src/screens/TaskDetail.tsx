import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Screen } from '@/components/Screen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/api';
import { qk } from '@/lib/query';
import { STATUS_META } from '@/lib/status';
import { haptic } from '@/lib/telegram';
import type { FeedTask, StatusDef } from '@/lib/types';

export function TaskDetail({ task }: { task: FeedTask }) {
  const qc = useQueryClient();
  const { connectionId, id } = task;
  const [comment, setComment] = useState('');

  const detailQ = useQuery({
    queryKey: qk.task(connectionId, id),
    queryFn: () =>
      api(`/api/tasks/${connectionId}/${id}`) as Promise<{ task: FeedTask }>,
  });
  const statusesQ = useQuery({
    queryKey: qk.taskStatuses(connectionId, id),
    queryFn: () =>
      api(`/api/tasks/${connectionId}/${id}/statuses`) as Promise<{ statuses: StatusDef[] }>,
  });

  const detail = detailQ.data?.task ?? task;
  const statuses = statusesQ.data?.statuses ?? [];

  const setStatus = useMutation({
    mutationFn: (statusId: string) =>
      api(`/api/tasks/${connectionId}/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ statusId }),
      }),
    onSuccess: () => {
      haptic.notify('success');
      toast.success('Status updated');
      void qc.invalidateQueries({ queryKey: qk.task(connectionId, id) });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const addComment = useMutation({
    mutationFn: (text: string) =>
      api(`/api/tasks/${connectionId}/${id}/comment`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      haptic.notify('success');
      toast.success('Comment posted');
      setComment('');
    },
  });

  const meta = STATUS_META[detail.status.category];

  return (
    <Screen title="Task">
      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-snug">{detail.name}</CardTitle>
            <Badge variant="outline" className="shrink-0 capitalize">
              {detail.provider}
            </Badge>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: meta.color }} />
            {detail.status.name || meta.label}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          {detailQ.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : detail.description ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.description}</p>
          ) : null}
          <a href={detail.url} target="_blank" rel="noreferrer">
            <Button variant="outline" className="w-full">
              <ExternalLink className="size-4" /> Open in {detail.provider}
            </Button>
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change status</CardTitle>
        </CardHeader>
        <CardContent>
          {statusesQ.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select
              value={detail.status.id}
              onValueChange={(v) => setStatus.mutate(v)}
              disabled={setStatus.isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="comment" className="sr-only">
            Comment
          </Label>
          <Textarea
            id="comment"
            placeholder="Write a comment…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button
            className="w-full"
            disabled={!comment.trim() || addComment.isPending}
            onClick={() => addComment.mutate(comment.trim())}
          >
            {addComment.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Post comment
          </Button>
        </CardContent>
      </Card>
    </Screen>
  );
}
