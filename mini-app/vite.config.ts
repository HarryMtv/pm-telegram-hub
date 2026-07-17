import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Dev: proxy API calls to the local Integration Service.
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
