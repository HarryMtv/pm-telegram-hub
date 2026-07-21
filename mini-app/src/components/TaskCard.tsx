import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { STATUS_META } from '@/lib/status';
import type { FeedTask } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CalendarClock } from 'lucide-react';

export function TaskCard({ task, onClick }: { task: FeedTask; onClick?: () => void }) {
  const status = STATUS_META[task.status.category];
  return (
    <Card
      className={cn('gap-2 py-3', onClick && 'cursor-pointer active:opacity-80')}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 px-3">
        <p className="text-sm font-medium leading-snug">{task.name}</p>
        <Badge variant="outline" className="shrink-0 capitalize">
          {task.provider}
        </Badge>
      </div>
      <div className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: status.color }} />
          {task.status.name || status.label}
        </span>
        {task.dueDate && (
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" />
            {formatDue(task.dueDate)}
          </span>
        )}
      </div>
    </Card>
  );
}

function formatDue(due: string): string {
  const ms = Number(due);
  const date =
    Number.isFinite(ms) && due.length >= 10 && /^\d+$/.test(due) ? new Date(ms) : new Date(due);
  if (Number.isNaN(date.getTime())) return due;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
