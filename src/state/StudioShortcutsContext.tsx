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
import { useAudioMixer } from './AudioMixerContext';
import { useSceneCompositor } from './CompositorContext';
import { useSourcePlayback } from './PlaybackContext';
import { useRecordingSession } from './RecordingSessionContext';

export interface StudioShortcutsContextValue {
  readonly isModalOpen: boolean;
  readonly shortcutsEnabled: boolean;
  readonly openShortcutsModal: () => void;
  readonly closeShortcutsModal: () => void;
  readonly toggleShortcutsModal: () => void;
  readonly setShortcutsEnabled: (enabled: boolean) => void;
  readonly toggleShortcutsEnabled: () => void;
}

const StudioShortcutsContext =
  createContext<StudioShortcutsContextValue | null>(null);

function isFormOrMediaElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'VIDEO' ||
    tag === 'AUDIO'
  ) {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(
    target.closest('input, textarea, select, video, [contenteditable="true"]'),
  );
}

function isInteractiveSpaceConsumer(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, a[href], summary, [role="button"], [role="slider"], [data-testid="pip-stage-overlay"]',
    ),
  );
}

export interface StudioShortcutsProviderProps {
  readonly children: ReactNode;
}

export function StudioShortcutsProvider({
  children,
}: StudioShortcutsProviderProps) {
  const {
    state: playbackState,
    togglePlayPause,
    rewind,
  } = useSourcePlayback();
  const { toggleSourceMute, toggleMicrophoneMute } = useAudioMixer();
  const {
    state: compositorState,
    activeTool,
    setActiveTool,
    setLayoutMode,
    undoAnnotation,
    clearAnnotations,
  } = useSceneCompositor();
  const {
    engineState,
    countdownSecondsRemaining,
    requestStartRecording,
    stopRecording,
    togglePauseRecording,
    addChapterMarker,
    cancelCountdown,
  } = useRecordingSession();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = useState(true);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);

  const openShortcutsModal = useCallback(() => {
    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusedElementRef.current = document.activeElement;
    }
    setIsModalOpen(true);
  }, []);

  const closeShortcutsModal = useCallback(() => {
    setIsModalOpen(false);
    const toRestore = previousFocusedElementRef.current;
    previousFocusedElementRef.current = null;
    if (toRestore?.isConnected) {
      queueMicrotask(() => {
        toRestore.focus();
      });
    }
  }, []);

  const toggleShortcutsModal = useCallback(() => {
    if (isModalOpen) {
      closeShortcutsModal();
    } else {
      openShortcutsModal();
    }
  }, [closeShortcutsModal, isModalOpen, openShortcutsModal]);

  const toggleShortcutsEnabled = useCallback(() => {
    setShortcutsEnabled((prev) => !prev);
  }, []);

  const isSourcePlayable =
    playbackState.status === 'ready' ||
    playbackState.status === 'playing' ||
    playbackState.status === 'paused' ||
    playbackState.status === 'ended';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey) {
        return;
      }

      // Support Ctrl+Z / Cmd+Z undo for stage annotations outside form fields
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      ) {
        if (
          !isModalOpen &&
          (typeof document === 'undefined' ||
            document.querySelector('[role="dialog"]') === null) &&
          !isFormOrMediaElement(event.target) &&
          compositorState.annotationCount > 0
        ) {
          event.preventDefault();
          undoAnnotation();
        }
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        return;
      }

      const isHelpShortcut =
        event.key === '?' || (event.shiftKey && event.code === 'Slash');

      if (isModalOpen) {
        if (event.key === 'Escape' || (!event.repeat && isHelpShortcut)) {
          event.preventDefault();
          closeShortcutsModal();
        }
        return;
      }

      if (
        typeof document !== 'undefined' &&
        document.querySelector('[role="dialog"]') !== null
      ) {
        return;
      }

      if (isFormOrMediaElement(event.target)) {
        return;
      }

      if (event.key === 'Escape' && countdownSecondsRemaining !== null) {
        event.preventDefault();
        cancelCountdown();
        return;
      }

      if (!event.repeat && isHelpShortcut) {
        event.preventDefault();
        openShortcutsModal();
        return;
      }

      if (!shortcutsEnabled || event.repeat) {
        return;
      }

      const key = event.key;
      const lower = key.toLowerCase();

      if (key === ' ') {
        if (isInteractiveSpaceConsumer(event.target)) {
          return;
        }
        if (isSourcePlayable) {
          event.preventDefault();
          void togglePlayPause();
        }
        return;
      }

      if (!event.shiftKey) {
        if (lower === 'k') {
          if (isSourcePlayable) {
            event.preventDefault();
            void togglePlayPause();
          }
          return;
        }

        if (lower === 'j') {
          if (isSourcePlayable) {
            event.preventDefault();
            rewind(10);
          }
          return;
        }

        if (lower === 'v') {
          event.preventDefault();
          toggleSourceMute();
          return;
        }

        if (lower === 'm') {
          event.preventDefault();
          toggleMicrophoneMute();
          return;
        }

        if (key === '1') {
          event.preventDefault();
          setLayoutMode('pip');
          return;
        }
        if (key === '2') {
          event.preventDefault();
          setLayoutMode('side-by-side');
          return;
        }
        if (key === '3') {
          event.preventDefault();
          setLayoutMode('source-only');
          return;
        }
        if (key === '4') {
          event.preventDefault();
          setLayoutMode('camera-only');
          return;
        }

        if (lower === 'p') {
          const recStatus = engineState.status;
          if (recStatus === 'recording' || recStatus === 'paused') {
            event.preventDefault();
            togglePauseRecording();
          }
          return;
        }

        if (lower === 'b') {
          const recStatus = engineState.status;
          if (recStatus === 'recording' || recStatus === 'paused') {
            event.preventDefault();
            addChapterMarker();
          }
          return;
        }

        if (lower === 'd') {
          event.preventDefault();
          setActiveTool(activeTool === 'pen' ? 'none' : 'pen');
          return;
        }

        if (lower === 'z') {
          if (compositorState.annotationCount > 0) {
            event.preventDefault();
            undoAnnotation();
          }
          return;
        }

        if (lower === 'c') {
          if (compositorState.annotationCount > 0) {
            event.preventDefault();
            clearAnnotations();
          }
          return;
        }
      }

      if (lower === 'r') {
        if (!engineState.isSupported) {
          return;
        }
        event.preventDefault();
        if (countdownSecondsRemaining !== null) {
          cancelCountdown();
          return;
        }
        const recStatus = engineState.status;
        if (recStatus === 'recording' || recStatus === 'paused') {
          if (!event.shiftKey) {
            void stopRecording();
          }
          return;
        }
        if (
          recStatus === 'idle' ||
          recStatus === 'uninitialized' ||
          recStatus === 'completed' ||
          recStatus === 'error'
        ) {
          void requestStartRecording({ forcePreRoll: event.shiftKey });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    activeTool,
    addChapterMarker,
    cancelCountdown,
    clearAnnotations,
    closeShortcutsModal,
    compositorState.annotationCount,
    countdownSecondsRemaining,
    engineState.isSupported,
    engineState.status,
    isModalOpen,
    isSourcePlayable,
    openShortcutsModal,
    requestStartRecording,
    rewind,
    setActiveTool,
    setLayoutMode,
    shortcutsEnabled,
    stopRecording,
    toggleMicrophoneMute,
    toggleSourceMute,
    togglePauseRecording,
    togglePlayPause,
    undoAnnotation,
  ]);

  const value = useMemo<StudioShortcutsContextValue>(
    () => ({
      isModalOpen,
      shortcutsEnabled,
      openShortcutsModal,
      closeShortcutsModal,
      toggleShortcutsModal,
      setShortcutsEnabled,
      toggleShortcutsEnabled,
    }),
    [
      closeShortcutsModal,
      isModalOpen,
      openShortcutsModal,
      shortcutsEnabled,
      toggleShortcutsEnabled,
      toggleShortcutsModal,
    ],
  );

  return (
    <StudioShortcutsContext.Provider value={value}>
      {children}
    </StudioShortcutsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStudioShortcuts(): StudioShortcutsContextValue {
  const ctx = useContext(StudioShortcutsContext);
  if (!ctx) {
    throw new Error(
      'useStudioShortcuts must be used within a StudioShortcutsProvider',
    );
  }
  return ctx;
}
