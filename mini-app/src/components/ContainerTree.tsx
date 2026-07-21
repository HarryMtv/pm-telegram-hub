import { useMemo, useState } from 'react';
import { api } from '@/api';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { qk } from '@/lib/query';
import { haptic } from '@/lib/telegram';
import type { Container } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, Hash } from 'lucide-react';

interface TreeNode extends Container {
  children: TreeNode[];
}

function buildTree(containers: Container[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const c of containers) byId.set(c.id, { ...c, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

interface ContainerTreeProps {
  connectionId: string;
  /** 'multi' = checkboxes (subscription filters); 'single' = pick one (mapping). */
  mode: 'multi' | 'single';
  selected: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Lazily-fetched container tree. The backend returns the connection's full
 * hierarchy as a flat list; we assemble it client-side and let the user expand
 * nodes. Only task-holding containers are selectable.
 */
export function ContainerTree({ connectionId, mode, selected, onChange }: ContainerTreeProps) {
  const { data, isLoading } = useQuery({
    queryKey: qk.containers(connectionId),
    queryFn: () =>
      api(`/api/connections/${connectionId}/containers`) as Promise<{ containers: Container[] }>,
  });

  const tree = useMemo(() => buildTree(data?.containers ?? []), [data]);

  function toggle(id: string) {
    haptic.impact('light');
    if (mode === 'single') {
      onChange(selected[0] === id ? [] : [id]);
      return;
    }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }
  if (tree.length === 0) {
    return <p className="text-sm text-muted-foreground">No containers found.</p>;
  }

  return (
    <div className="rounded-lg border">
      {tree.map((node) => (
        <TreeNodeRow key={node.id} node={node} depth={0} selected={selected} onToggle={toggle} />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  selected,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const isSelected = selected.includes(node.id);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-2 text-sm',
          node.canContainTasks && 'cursor-pointer hover:bg-accent',
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => node.canContainTasks && onToggle(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="text-muted-foreground"
          >
            <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-4" />
        )}
        {node.canContainTasks ? (
          <Hash className="size-4 text-muted-foreground" />
        ) : (
          <Folder className="size-4 text-muted-foreground" />
        )}
        <span className="flex-1 truncate">{node.name}</span>
        {node.canContainTasks && (
          <Checkbox checked={isSelected} onCheckedChange={() => onToggle(node.id)} />
        )}
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
