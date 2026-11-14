import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolveBasePath } from './src/utils/base-path';

export default defineConfig(({ mode }) => ({
  base: resolveBasePath(mode, process.env.VITE_BASE_PATH),
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
