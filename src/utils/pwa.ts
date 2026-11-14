export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: readonly string[];
  readonly userChoice: Promise<{
    readonly outcome: 'accepted' | 'dismissed';
    readonly platform: string;
  }>;
  prompt(): Promise<void>;
}

interface ViteImportMetaEnv {
  readonly PROD?: boolean;
  readonly BASE_URL?: string;
}

export interface RegisterServiceWorkerOptions {
  readonly forceProd?: boolean;
}

/**
 * Registers the local-first offline Service Worker (`./sw.js`) in production
 * browser environments without touching camera/microphone permissions.
 */
export async function registerStudioServiceWorker(
  options: RegisterServiceWorkerOptions = {},
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return null;
  }

  if (!('serviceWorker' in navigator)) {
    return null;
  }

  const metaEnv = (import.meta as unknown as { readonly env?: ViteImportMetaEnv })
    .env;
  const isProd = options.forceProd ?? Boolean(metaEnv?.PROD);

  // Skip Service Worker registration inside JSDOM or Vite HMR dev mode unless explicitly enabled
  if (!isProd) {
    return null;
  }

  const baseUrl = metaEnv?.BASE_URL ?? './';

  try {
    const swUrl = `${baseUrl}sw.js`;
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: baseUrl,
    });
    return registration;
  } catch {
    return null;
  }
}
