import { useEffect, useMemo } from 'react';
import { api } from '@/api';
import { EmptyState, Screen } from '@/components/Screen';
import { TaskCard } from '@/components/TaskCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInboxFilters } from '@/lib/inbox-filters';
import { useNav } from '@/lib/nav';
import { qk } from '@/lib/query';
import { STATUS_META, STATUS_ORDER } from '@/lib/status';
import type { Connection, FeedTask, StatusCategory } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';

import { CreateTask } from './CreateTask';
import { TaskDetail } from './TaskDetail';

/** First-letter capitalize for a provider id shown in the filter (e.g. clickup → Clickup). */
function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function Inbox() {
  const { push } = useNav();
  const { filters, setText, setProvider, setCategory, setView } = useInboxFilters();
  const { text, provider, category, view } = filters;

  const connsQ = useQuery({
    queryKey: qk.connections,
    queryFn: () => api('/api/connections') as Promise<{ connections: Connection[] }>,
  });
  const providers = useMemo(
    () => Array.from(new Set((connsQ.data?.connections ?? []).map((c) => c.provider))),
    [connsQ.data],
  );

  // A persisted filter can reference a provider that has since been disconnected.
  // Drop back to "all" so the trigger never shows a stale/blank selection.
  useEffect(() => {
    if (provider !== 'all' && !providers.includes(provider)) {
      setProvider('all');
    }
  }, [providers, provider, setProvider]);

  const params: Record<string, string> = {};
  if (text) params.text = text;
  if (provider !== 'all') params.provider = provider;
  if (category !== 'all') params.statusCategory = category;

  const tasksQ = useQuery({
    queryKey: qk.tasks(params),
    queryFn: () => {
      const qs = new URLSearchParams(params).toString();
      return api(`/api/tasks${qs ? `?${qs}` : ''}`) as Promise<{ tasks: FeedTask[] }>;
    },
  });
  const tasks = tasksQ.data?.tasks ?? [];

  return (
    <Screen
      title="Inbox"
      action={
        <Button size="sm" onClick={() => push(<CreateTask />)} disabled={providers.length === 0}>
          <Plus className="size-4" /> New
        </Button>
      }
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search tasks"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="min-w-[8rem] flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {titleCase(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="min-w-[8rem] flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {STATUS_ORDER.map((c) => (
              <SelectItem key={c} value={c}>
                {STATUS_META[c].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tabs value={view} onValueChange={(v) => setView(v as 'list' | 'board')}>
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="board">Board</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tasksQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState>No tasks match.</EmptyState>
      ) : view === 'list' ? (
        <div className="space-y-2">
          {tasks.map((t) => (
            <TaskCard
              key={`${t.connectionId}:${t.id}`}
              task={t}
              onClick={() => push(<TaskDetail task={t} />)}
            />
          ))}
        </div>
      ) : (
        <Board tasks={tasks} onOpen={(t) => push(<TaskDetail task={t} />)} />
      )}
    </Screen>
  );
}

function Board({ tasks, onOpen }: { tasks: FeedTask[]; onOpen: (t: FeedTask) => void }) {
  const byCategory = (cat: StatusCategory) => tasks.filter((t) => t.status.category === cat);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STATUS_ORDER.map((cat) => {
        const col = byCategory(cat);
        return (
          <div key={cat} className="w-64 shrink-0 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span
                className="size-2 rounded-full"
                style={{ background: STATUS_META[cat].color }}
              />
              {STATUS_META[cat].label}
              <span className="text-muted-foreground">{col.length}</span>
            </div>
            {col.map((t) => (
              <TaskCard key={`${t.connectionId}:${t.id}`} task={t} onClick={() => onOpen(t)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
