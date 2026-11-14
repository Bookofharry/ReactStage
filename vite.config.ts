import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolveBasePath } from './src/utils/base-path';

function reactStageOfflineManifestPlugin(): Plugin {
  return {
    name: 'reactstage-offline-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assetPaths: string[] = [
        './',
        './index.html',
        './manifest.webmanifest',
        './favicon.svg',
        './pwa-192.png',
        './pwa-512.png',
      ];

      const hash = createHash('sha256');
      const sortedNames = Object.keys(bundle).sort();
      for (const fileName of sortedNames) {
        if (fileName.endsWith('.map')) {
          continue;
        }
        hash.update(fileName);
        assetPaths.push(`./${fileName}`);
      }

      const version = `v1-${hash.digest('hex').slice(0, 10)}`;
      const payload = JSON.stringify(
        {
          version,
          assets: Array.from(new Set(assetPaths)),
        },
        null,
        2,
      );

      this.emitFile({
        type: 'asset',
        fileName: 'offline-manifest.json',
        source: payload,
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: resolveBasePath(mode, process.env.VITE_BASE_PATH),
  plugins: [react(), tailwindcss(), reactStageOfflineManifestPlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
}));
