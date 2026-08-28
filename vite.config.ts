import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* [workspace-manager] Stack identico al proyecto task (PROYECTO TASKS/frontend):
 * Vite + React 18 + TS. Server HTTP propio en src/server/index.ts expone la API;
 * Vite hace proxy de /api hacia el servidor Node local. */
const PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8787';
const VITE_HOST = process.env.VITE_HOST || '127.0.0.1';

export default defineConfig({
    plugins: [react()],
    base: './',
    server: {
        host: VITE_HOST,
        port: Number(process.env.VITE_PORT) || 5174,
        strictPort: true,
        proxy: {
            '/api': {
                target: PROXY_TARGET,
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});
