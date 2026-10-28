import { defineConfig } from 'vite';

// In development the Vite app (port 5173) forwards API and real-time traffic to the
// game server (port 3001), so the browser only ever talks to one address.
const target = process.env.TEAMUP_SERVER || 'http://localhost:3001';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': target,
      '/socket.io': { target, ws: true },
    },
  },
});
