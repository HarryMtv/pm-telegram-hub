import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SDKProvider } from '@telegram-apps/sdk-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

const queryClient = new QueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <SDKProvider acceptCustomStyles>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </SDKProvider>
  </StrictMode>,
);
