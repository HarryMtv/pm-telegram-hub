import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { haptic } from './telegram';

/** One QueryClient for the app. Failures from queries and mutations surface as a
 * toast (with an error haptic) so nothing fails silently — spec §7 UX. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
  queryCache: new QueryCache({
    onError: (err) => {
      haptic.notify('error');
      toast.error(err instanceof Error ? err.message : 'Request failed');
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      haptic.notify('error');
      toast.error(err instanceof Error ? err.message : 'Action failed');
    },
  }),
});

/** Stable query keys. */
export const qk = {
  adapters: ['adapters'] as const,
  connections: ['connections'] as const,
  containers: (connectionId: string, parentId?: string) =>
    ['containers', connectionId, parentId ?? 'root'] as const,
  subscriptions: ['subscriptions'] as const,
  mappings: ['mappings'] as const,
  tasks: (params?: Record<string, unknown>) => ['tasks', params ?? {}] as const,
  task: (connectionId: string, taskId: string) => ['task', connectionId, taskId] as const,
  taskStatuses: (connectionId: string, taskId: string) =>
    ['task-statuses', connectionId, taskId] as const,
};
