import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const backendUrl = `http://127.0.0.1:${process.env.PORT || '3001'}`;
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, strictPort: true,
    watch: { ignored: ['**/dist/**', '**/dist-server/**', '**/.runtime/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.cert/**', '**/.runtime/**', '**/server/**', '**/tests/**', '**/docs/**', '**/prisma/**', '**/scripts/**'] },
    https: process.env.LOCAL_TLS === 'true' ? {
      key: readFileSync('.cert/localhost-key.pem'), cert: readFileSync('.cert/localhost.pem')
    } : undefined,
    proxy: { '/api': { target: backendUrl, xfwd: true }, '/socket.io': { target: backendUrl, ws: true, xfwd: true } }
  }
});
