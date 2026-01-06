import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 5000,
        host: '0.0.0.0',
        allowedHosts: true as const,
        proxy: {
          '/api': {
            target: 'http://localhost:3001',
            changeOrigin: true,
            timeout: 600000,
            proxyTimeout: 600000,
            configure: (proxy) => {
              proxy.on('error', (err) => {
                console.log('[Vite Proxy] Error:', err.message);
              });
              proxy.on('proxyReq', (proxyReq, req) => {
                if (req.url?.includes('/upload')) {
                  console.log('[Vite Proxy] Starting large file upload...');
                }
              });
            }
          }
        }
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@assets': path.resolve(__dirname, 'attached_assets'),
        }
      },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        include: ['**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'server/**/*.test.ts'],
      }
    };
});
