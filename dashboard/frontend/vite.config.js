import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const integrated = process.env.VITE_BASE === '/app/';
const gatewayPort = process.env.INTEGRATED_PORT || '4000';

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // When served behind integrated gateway at :4000/app/
    origin: integrated ? `http://localhost:${gatewayPort}` : undefined,
    proxy: integrated
      ? undefined
      : { '/api': 'http://localhost:5000', '/uploads': 'http://localhost:5000' },
  },
});
