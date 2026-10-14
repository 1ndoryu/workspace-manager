import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { obtenerToken } from './src/server/seguridad/token.js';

/* [workspace-manager] Stack identico al proyecto task (PROYECTO TASKS/frontend):
 * Vite + React 18 + TS. Server HTTP propio en src/server/index.ts expone la API;
 * Vite hace proxy de /api hacia el servidor Node local. */
const PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8787';
const VITE_HOST = process.env.VITE_HOST || '127.0.0.1';
/* [por que] El token lo pone el proxy, no el navegador: así la pestaña nunca lo ve y
 * EventSource (que no admite cabeceras propias) también queda autorizado. */
const TOKEN_API = obtenerToken();

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
                configure: (proxy) => {
                    proxy.on('proxyReq', (proxyReq) => {
                        proxyReq.setHeader('Authorization', `Bearer ${TOKEN_API}`);
                    });
                },
            },
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});
