import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';

import { Toaster } from '@/components/ui/sonner';
import { queryClient } from '@/lib/query';
import { initTelegram } from '@/lib/telegram';
import { App } from './App';

import './index.css';

// Boot the Telegram SDK (theme/viewport/CSS vars) before first paint.
initTelegram();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  </StrictMode>,
);
