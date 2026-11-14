import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { BeforeInstallPromptEvent } from '../utils/pwa';

export interface PwaContextValue {
  readonly isOffline: boolean;
  readonly canInstall: boolean;
  readonly isStandalone: boolean;
  readonly promptInstall: () => Promise<boolean>;
}

const DEFAULT_PWA_VALUE: PwaContextValue = {
  isOffline: false,
  canInstall: false,
  isStandalone: false,
  promptInstall: () => Promise.resolve(false),
};

const PwaContext = createContext<PwaContextValue>(DEFAULT_PWA_VALUE);

function detectStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(display-mode: standalone)').matches;
    } catch {
      return false;
    }
  }
  return false;
}

export interface PwaProviderProps {
  readonly children: ReactNode;
}

export function PwaProvider({ children }: PwaProviderProps) {
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() =>
    detectStandaloneDisplayMode(),
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => {
      setIsOffline(false);
    };
    const handleOffline = () => {
      setIsOffline(true);
    };
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) {
      return false;
    }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (choice.outcome === 'accepted') {
        setIsStandalone(true);
        return true;
      }
      return false;
    } catch {
      setDeferredPrompt(null);
      return false;
    }
  }, [deferredPrompt]);

  const value = useMemo<PwaContextValue>(
    () => ({
      isOffline,
      canInstall: deferredPrompt !== null && !isStandalone,
      isStandalone,
      promptInstall,
    }),
    [deferredPrompt, isOffline, isStandalone, promptInstall],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePwaStatus(): PwaContextValue {
  return useContext(PwaContext);
}
