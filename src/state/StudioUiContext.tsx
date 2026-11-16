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
  readonly isSettingsModalOpen: boolean;
  readonly openSettingsModal: () => void;
  readonly closeSettingsModal: () => void;
  readonly isDrawToolbarOpen: boolean;
  readonly setIsDrawToolbarOpen: (open: boolean) => void;
}

const StudioUiContext = createContext<StudioUiContextValue | null>(null);

export function StudioUiProvider({ children }: { readonly children: ReactNode }) {
  const { takes } = useExport();
  const [activeTab, setActiveTab] = useState<WorkspaceDrawerTab>('devices');
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isDrawToolbarOpen, setIsDrawToolbarOpen] = useState(false);
  const prevTakeCountRef = useRef(0);

  const openSettingsModal = useCallback(() => {
    setIsSettingsModalOpen(true);
  }, []);

  const closeSettingsModal = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  // Automatically bring Takes & Export into focus whenever a new recording completes or hydrates
  useEffect(() => {
    if (takes.length > prevTakeCountRef.current && takes.length > 0) {
      setActiveTab('takes');
    }
    prevTakeCountRef.current = takes.length;
  }, [takes.length]);

  const value = useMemo<StudioUiContextValue>(
    () => ({
      activeTab,
      setActiveTab,
      isSettingsModalOpen,
      openSettingsModal,
      closeSettingsModal,
      isDrawToolbarOpen,
      setIsDrawToolbarOpen,
    }),
    [
      activeTab,
      closeSettingsModal,
      isDrawToolbarOpen,
      isSettingsModalOpen,
      openSettingsModal,
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
