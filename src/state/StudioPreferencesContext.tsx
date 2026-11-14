import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  StudioPreferencesStore,
  areWorkspaceProfilesEqual,
  createDefaultWorkspaceProfile,
  type StudioPreferencesSnapshot,
  type StudioSavedPreset,
  type StudioWorkspaceProfile,
} from '../services/studio-preferences';
import { useAudioMixer } from './AudioMixerContext';
import { useCapture } from './CaptureContext';
import { useSceneCompositor } from './CompositorContext';
import { useRecordingSession } from './RecordingSessionContext';
import { useStudioShortcuts } from './StudioShortcutsContext';

export interface StudioPreferencesContextValue {
  readonly snapshot: StudioPreferencesSnapshot;
  readonly currentLiveProfile: StudioWorkspaceProfile;
  readonly isPresetsModalOpen: boolean;
  readonly openPresetsModal: () => void;
  readonly closePresetsModal: () => void;
  readonly saveCurrentAsPreset: (name: string) => StudioSavedPreset | null;
  readonly applyPreset: (presetId: string) => boolean;
  readonly deleteCustomPreset: (presetId: string) => boolean;
  readonly resetStudioToDefaults: () => void;
}

const StudioPreferencesContext =
  createContext<StudioPreferencesContextValue | null>(null);

const DEFAULT_PROFILE = createDefaultWorkspaceProfile();

export interface StudioPreferencesProviderProps {
  readonly children: ReactNode;
  readonly preferencesStore?: StudioPreferencesStore;
}

export function StudioPreferencesProvider({
  children,
  preferencesStore: externalStore,
}: StudioPreferencesProviderProps) {
  const { snapshot: captureSnapshot, setMirrorPreview } = useCapture();
  const {
    state: mixerState,
    setSourceGain,
    setSourceMuted,
    setMicrophoneGain,
    setMicrophoneMuted,
    setAutoDuckEnabled,
    setMicProcessingEnabled,
  } = useAudioMixer();
  const {
    state: compositorState,
    setLayoutMode,
    setResolution,
    setPipRect,
    setPipFrameShape,
    setPipBorderStyle,
    setSplitRatio,
    setLowerThird,
  } = useSceneCompositor();
  const { preRollEnabled, setPreRollEnabled } = useRecordingSession();
  const { shortcutsEnabled, setShortcutsEnabled } = useStudioShortcuts();

  const [internalStore] = useState<StudioPreferencesStore>(
    () => new StudioPreferencesStore(),
  );
  const activeStore = externalStore ?? internalStore;

  const subscribe = useCallback(
    (listener: () => void) => activeStore.subscribe(listener),
    [activeStore],
  );
  const getSnapshot = useCallback(
    () => activeStore.getSnapshot(),
    [activeStore],
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [isPresetsModalOpen, setIsPresetsModalOpen] = useState(false);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);

  const hydratedRef = useRef(false);
  const pendingHydrationProfileRef = useRef<StudioWorkspaceProfile | null>(
    null,
  );

  const applyProfileToStudio = useCallback(
    (profile: StudioWorkspaceProfile) => {
      setLayoutMode(profile.layoutMode);
      setResolution(profile.resolutionPreset);
      setPipRect(profile.pipRect);
      setPipFrameShape(profile.pipFrameShape);
      setPipBorderStyle(profile.pipBorderStyle);
      setSplitRatio(profile.splitRatio);
      setSourceGain(profile.sourceGain);
      setSourceMuted(profile.sourceMuted);
      setMicrophoneGain(profile.microphoneGain);
      setMicrophoneMuted(profile.microphoneMuted);
      setAutoDuckEnabled(profile.autoDuckEnabled);
      setMicProcessingEnabled(profile.micProcessingEnabled);
      setLowerThird({
        enabled: profile.lowerThirdEnabled,
        title: profile.lowerThirdTitle,
        subtitle: profile.lowerThirdSubtitle,
      });
      setMirrorPreview(profile.mirrorPreview);
      setPreRollEnabled(profile.preRollEnabled);
      setShortcutsEnabled(profile.shortcutsEnabled);
    },
    [
      setAutoDuckEnabled,
      setLayoutMode,
      setLowerThird,
      setMicProcessingEnabled,
      setMicrophoneGain,
      setMicrophoneMuted,
      setMirrorPreview,
      setPipBorderStyle,
      setPipFrameShape,
      setPipRect,
      setPreRollEnabled,
      setResolution,
      setShortcutsEnabled,
      setSourceGain,
      setSourceMuted,
      setSplitRatio,
    ],
  );

  const currentLiveProfile = useMemo<StudioWorkspaceProfile>(
    () => ({
      layoutMode: compositorState.layoutMode,
      resolutionPreset: compositorState.resolutionPreset,
      pipRect: compositorState.pipRect,
      pipFrameShape: compositorState.pipFrameShape,
      pipBorderStyle: compositorState.pipBorderStyle,
      splitRatio: compositorState.splitRatio,
      sourceGain: mixerState.sourceChannel.gain,
      sourceMuted: mixerState.sourceChannel.muted,
      microphoneGain: mixerState.microphoneChannel.gain,
      microphoneMuted: mixerState.microphoneChannel.muted,
      autoDuckEnabled: mixerState.autoDuckEnabled,
      micProcessingEnabled: mixerState.micProcessingEnabled,
      lowerThirdEnabled: compositorState.lowerThird.enabled,
      lowerThirdTitle: compositorState.lowerThird.title,
      lowerThirdSubtitle: compositorState.lowerThird.subtitle,
      mirrorPreview: captureSnapshot.mirrorPreview,
      preRollEnabled,
      shortcutsEnabled,
    }),
    [
      captureSnapshot.mirrorPreview,
      compositorState.layoutMode,
      compositorState.lowerThird.enabled,
      compositorState.lowerThird.subtitle,
      compositorState.lowerThird.title,
      compositorState.pipBorderStyle,
      compositorState.pipFrameShape,
      compositorState.pipRect,
      compositorState.resolutionPreset,
      compositorState.splitRatio,
      mixerState.autoDuckEnabled,
      mixerState.micProcessingEnabled,
      mixerState.microphoneChannel.gain,
      mixerState.microphoneChannel.muted,
      mixerState.sourceChannel.gain,
      mixerState.sourceChannel.muted,
      preRollEnabled,
      shortcutsEnabled,
    ],
  );

  // Hydrate saved studio configuration once on startup (zero permission/hardware calls!)
  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;

    const initial = activeStore.getSnapshot();
    if (initial.hasSavedWorkspace) {
      pendingHydrationProfileRef.current = initial.activeProfile;
      applyProfileToStudio(initial.activeProfile);
    }
  }, [activeStore, applyProfileToStudio]);

  // Auto-persist creator workspace changes once hydration has settled
  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    const pending = pendingHydrationProfileRef.current;
    if (pending !== null) {
      if (areWorkspaceProfilesEqual(currentLiveProfile, pending)) {
        pendingHydrationProfileRef.current = null;
      }
      return;
    }

    const storeSnap = activeStore.getSnapshot();
    if (
      !storeSnap.hasSavedWorkspace &&
      areWorkspaceProfilesEqual(currentLiveProfile, DEFAULT_PROFILE)
    ) {
      return;
    }

    activeStore.saveActiveProfile(currentLiveProfile);
  }, [activeStore, currentLiveProfile]);

  const openPresetsModal = useCallback(() => {
    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusedElementRef.current = document.activeElement;
    }
    setIsPresetsModalOpen(true);
  }, []);

  const closePresetsModal = useCallback(() => {
    setIsPresetsModalOpen(false);
    const toRestore = previousFocusedElementRef.current;
    previousFocusedElementRef.current = null;
    if (toRestore?.isConnected) {
      queueMicrotask(() => {
        toRestore.focus();
      });
    }
  }, []);

  const saveCurrentAsPreset = useCallback(
    (name: string): StudioSavedPreset | null => {
      return activeStore.saveCustomPreset(name, currentLiveProfile);
    },
    [activeStore, currentLiveProfile],
  );

  const applyPreset = useCallback(
    (presetId: string): boolean => {
      const preset = activeStore.getPresetById(presetId);
      if (!preset) {
        return false;
      }
      pendingHydrationProfileRef.current = null;
      applyProfileToStudio(preset.profile);
      activeStore.saveActiveProfile(preset.profile);
      return true;
    },
    [activeStore, applyProfileToStudio],
  );

  const deleteCustomPreset = useCallback(
    (presetId: string): boolean => {
      return activeStore.deleteCustomPreset(presetId);
    },
    [activeStore],
  );

  const resetStudioToDefaults = useCallback(() => {
    const defaults = activeStore.resetActiveProfileToDefaults();
    pendingHydrationProfileRef.current = defaults;
    applyProfileToStudio(defaults);
  }, [activeStore, applyProfileToStudio]);

  const value = useMemo<StudioPreferencesContextValue>(
    () => ({
      snapshot,
      currentLiveProfile,
      isPresetsModalOpen,
      openPresetsModal,
      closePresetsModal,
      saveCurrentAsPreset,
      applyPreset,
      deleteCustomPreset,
      resetStudioToDefaults,
    }),
    [
      applyPreset,
      closePresetsModal,
      currentLiveProfile,
      deleteCustomPreset,
      isPresetsModalOpen,
      openPresetsModal,
      resetStudioToDefaults,
      saveCurrentAsPreset,
      snapshot,
    ],
  );

  return (
    <StudioPreferencesContext.Provider value={value}>
      {children}
    </StudioPreferencesContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStudioPreferences(): StudioPreferencesContextValue {
  const ctx = useContext(StudioPreferencesContext);
  if (!ctx) {
    throw new Error(
      'useStudioPreferences must be used within a StudioPreferencesProvider',
    );
  }
  return ctx;
}
