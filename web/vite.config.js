// Builds the two pages (measuring page and class view) into ../static/app,
// which app.py serves at / and /class. `npm run dev` proxies the API, the
// WebSocket and the plain static files to a uvicorn on port 8001.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const API = process.env.RPPG_API || 'http://localhost:8001';

export default defineConfig({
  base: '/static/app/',
  plugins: [react()],
  build: {
    outDir: here('../static/app'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      input: { index: here('index.html'), class: here('class.html') },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
      '/api': API,
      '^/static/(?!app/)': API,
      // In dev, Vite puts the base in front of /static/theme.js; send it to the server's copy.
      '/static/app/static/': { target: API, rewrite: (path) => path.replace('/static/app/static/', '/static/') },
    },
  },
});
