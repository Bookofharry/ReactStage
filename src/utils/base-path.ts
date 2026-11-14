/**
 * Resolves the Vite / GitHub Pages base URL path from mode and optional VITE_BASE_PATH.
 */
export function resolveBasePath(mode: string, envBasePath?: string): string {
  const raw = envBasePath?.trim();
  if (raw) {
    const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
    return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
  }
  return mode === 'production' ? '/ReactStage/' : '/';
}
