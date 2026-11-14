const CACHE_PREFIX = 'reactstage-shell-';
const FALLBACK_VERSION = 'v1-dev';
const CORE_SHELL_PATHS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './pwa-192.png',
  './pwa-512.png',
];

let activeCacheName = `${CACHE_PREFIX}${FALLBACK_VERSION}`;

function toScopedUrl(relativePath) {
  return new URL(relativePath, self.registration.scope).toString();
}

async function resolvePrecacheSpec() {
  try {
    const manifestResp = await fetch(toScopedUrl('./offline-manifest.json'), {
      cache: 'no-store',
    });
    if (manifestResp.ok) {
      const data = await manifestResp.json();
      const version =
        typeof data.version === 'string' && data.version.length > 0
          ? data.version
          : FALLBACK_VERSION;
      const extraAssets = Array.isArray(data.assets) ? data.assets : [];
      const merged = Array.from(new Set([...CORE_SHELL_PATHS, ...extraAssets]));
      return {
        cacheName: `${CACHE_PREFIX}${version}`,
        urls: merged.map((p) => toScopedUrl(p)),
      };
    }
  } catch {
    // Offline or dev server without build manifest: use core shell paths
  }

  return {
    cacheName: `${CACHE_PREFIX}${FALLBACK_VERSION}`,
    urls: CORE_SHELL_PATHS.map((p) => toScopedUrl(p)),
  };
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const spec = await resolvePrecacheSpec();
      activeCacheName = spec.cacheName;
      const cache = await caches.open(spec.cacheName);
      await Promise.allSettled(
        spec.urls.map(async (url) => {
          const resp = await fetch(url, { cache: 'reload' });
          if (resp.ok) {
            await cache.put(url, resp);
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key.startsWith(CACHE_PREFIX) && key !== activeCacheName) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        }),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const scope = self.registration.scope;
  if (!request.url.startsWith(scope)) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok && networkResponse.type === 'basic') {
          const cache = await caches.open(activeCacheName);
          void cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cachedExact =
          (await caches.match(request.url, {
            ignoreSearch: true,
            ignoreVary: true,
          })) ||
          (await caches.match(request, {
            ignoreSearch: true,
            ignoreVary: true,
          }));
        if (cachedExact) {
          return cachedExact;
        }
        if (request.mode === 'navigate') {
          const indexFallback =
            (await caches.match(toScopedUrl('./index.html'), {
              ignoreSearch: true,
              ignoreVary: true,
            })) ||
            (await caches.match(toScopedUrl('./'), {
              ignoreSearch: true,
              ignoreVary: true,
            }));
          if (indexFallback) {
            return indexFallback;
          }
        }
        throw new Error('Offline and resource not cached');
      }
    })(),
  );
});
