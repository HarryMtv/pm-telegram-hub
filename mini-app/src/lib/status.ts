import type { StatusCategory } from './types';

/** Presentation for each unified status category: label + a dot/accent color that
 * reads in both light and dark (uses fixed hues, not theme tokens, so categories
 * stay distinguishable). */
export const STATUS_META: Record<StatusCategory, { label: string; color: string }> = {
  open: { label: 'Open', color: '#8e8e93' },
  in_progress: { label: 'In progress', color: '#2481cc' },
  done: { label: 'Done', color: '#34c759' },
  cancelled: { label: 'Cancelled', color: '#ff3b30' },
};

export const STATUS_ORDER: StatusCategory[] = ['open', 'in_progress', 'done', 'cancelled'];
