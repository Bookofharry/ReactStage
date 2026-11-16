import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useExport } from './ExportContext';

export type WorkspaceDrawerTab = 'devices' | 'audio' | 'takes';

interface StudioUiContextValue {
  readonly activeTab: WorkspaceDrawerTab;
  readonly setActiveTab: (tab: WorkspaceDrawerTab) => void;
  readonly isMobileDrawerOpen: boolean;
  readonly toggleMobileDrawer: () => void;
  readonly isSettingsModalOpen: boolean;
  readonly openSettingsModal: () => void;
  readonly closeSettingsModal: () => void;
  readonly isDrawToolbarOpen: boolean;
  readonly setIsDrawToolbarOpen: (open: boolean) => void;
}

const StudioUiContext = createContext<StudioUiContextValue | null>(null);

export function StudioUiProvider({ children }: { readonly children: ReactNode }) {
  const { takes } = useExport();
  const [activeTabState, setActiveTabState] =
    useState<WorkspaceDrawerTab>('devices');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isDrawToolbarOpen, setIsDrawToolbarOpen] = useState(false);
  const prevTakeCountRef = useRef(0);

  const setActiveTab = useCallback((tab: WorkspaceDrawerTab) => {
    setActiveTabState(tab);
    setIsMobileDrawerOpen(true);
  }, []);

  const toggleMobileDrawer = useCallback(() => {
    setIsMobileDrawerOpen((prev) => !prev);
  }, []);

  const openSettingsModal = useCallback(() => {
    setIsSettingsModalOpen(true);
  }, []);

  const closeSettingsModal = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  // Automatically select Takes tab whenever a new recording completes or hydrates
  // (stays collapsed on mobile until the user taps Preview or expands the drawer)
  useEffect(() => {
    if (takes.length > prevTakeCountRef.current && takes.length > 0) {
      setActiveTabState('takes');
    }
    prevTakeCountRef.current = takes.length;
  }, [takes.length]);

  const value = useMemo<StudioUiContextValue>(
    () => ({
      activeTab: activeTabState,
      setActiveTab,
      isMobileDrawerOpen,
      toggleMobileDrawer,
      isSettingsModalOpen,
      openSettingsModal,
      closeSettingsModal,
      isDrawToolbarOpen,
      setIsDrawToolbarOpen,
    }),
    [
      activeTabState,
      closeSettingsModal,
      isDrawToolbarOpen,
      isMobileDrawerOpen,
      isSettingsModalOpen,
      openSettingsModal,
      setActiveTab,
      toggleMobileDrawer,
    ],
  );

  return (
    <StudioUiContext.Provider value={value}>{children}</StudioUiContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStudioUi(): StudioUiContextValue {
  const ctx = useContext(StudioUiContext);
  if (!ctx) {
    throw new Error('useStudioUi must be used inside StudioUiProvider');
  }
  return ctx;
}
