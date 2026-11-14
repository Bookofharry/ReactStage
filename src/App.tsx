import { AudioMixerPanel } from './components/AudioMixerPanel';
import { ExportPanel } from './components/ExportPanel';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { MicrophoneCapturePanel } from './components/MicrophoneCapturePanel';
import { PlaybackControls } from './components/PlaybackControls';
import { RecordingSessionPanel } from './components/RecordingSessionPanel';
import { SceneStagePanel } from './components/SceneStagePanel';
import { StudioHeader } from './components/StudioHeader';
import { StudioPresetsModal } from './components/StudioPresetsModal';
import { WebcamCapturePanel } from './components/WebcamCapturePanel';
import type { MicrophoneLevelMeter } from './services/capture-manager';
import type { AudioMixer } from './services/interfaces/audio-mixer';
import type { CaptureManager } from './services/interfaces/capture-manager';
import type { ExportManager } from './services/interfaces/export-manager';
import type { RecordingEngine } from './services/interfaces/recording-engine';
import type { SceneCompositor } from './services/interfaces/scene-compositor';
import type { SourcePlayer } from './services/interfaces/source-player';
import type { StudioPreferencesStore } from './services/studio-preferences';
import type { TakeVault } from './services/take-vault';
import { AudioMixerProvider } from './state/AudioMixerContext';
import { CaptureProvider } from './state/CaptureContext';
import { CompositorProvider } from './state/CompositorContext';
import { ExportProvider } from './state/ExportContext';
import { SourcePlaybackProvider } from './state/PlaybackContext';
import { PwaProvider } from './state/PwaContext';
import { RecordingSessionProvider } from './state/RecordingSessionContext';
import { StudioPreferencesProvider } from './state/StudioPreferencesContext';
import { StudioShortcutsProvider } from './state/StudioShortcutsContext';
import type { RecordingSessionState } from './types/media';

export interface AppProps {
  readonly player?: SourcePlayer;
  readonly captureManager?: CaptureManager;
  readonly levelMeter?: MicrophoneLevelMeter;
  readonly compositor?: SceneCompositor;
  readonly audioMixer?: AudioMixer;
  readonly recordingEngine?: RecordingEngine;
  readonly exportManager?: ExportManager;
  readonly takeVault?: TakeVault;
  readonly preferencesStore?: StudioPreferencesStore;
  readonly initialRecordingState?: RecordingSessionState;
  readonly countdownStepMs?: number;
}

export function App({
  player,
  captureManager,
  levelMeter,
  compositor,
  audioMixer,
  recordingEngine,
  exportManager,
  takeVault,
  preferencesStore,
  initialRecordingState,
  countdownStepMs,
}: AppProps = {}) {
  return (
    <PwaProvider>
      <CaptureProvider manager={captureManager} levelMeter={levelMeter}>
      <SourcePlaybackProvider player={player}>
        <AudioMixerProvider mixer={audioMixer}>
          <CompositorProvider compositor={compositor}>
            <RecordingSessionProvider
              engine={recordingEngine}
              initialState={initialRecordingState}
              countdownStepMs={countdownStepMs}
            >
              <ExportProvider manager={exportManager} vault={takeVault}>
                <StudioShortcutsProvider>
                  <StudioPreferencesProvider
                    preferencesStore={preferencesStore}
                  >
                    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
                      <StudioHeader />

                      <main
                        id="studio-main"
                        className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:py-6 lg:px-6"
                      >
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
                          <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
                            <SceneStagePanel />
                            <PlaybackControls />
                            <AudioMixerPanel />
                          </div>

                          <aside
                            aria-label="Creator capture setup and studio pipeline"
                            className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-4 lg:grid-cols-1"
                          >
                            <WebcamCapturePanel />
                            <MicrophoneCapturePanel />
                            <RecordingSessionPanel />
                            <ExportPanel />
                          </aside>
                        </div>
                      </main>

                      <footer className="border-t border-slate-900 bg-slate-950 px-4 py-3 text-center text-xs text-slate-300">
                        ReactStage · Free &amp; Open-Source Local-First Video
                        Reaction Studio · Media stays on your device
                      </footer>

                      <StudioPresetsModal />
                      <KeyboardShortcutsModal />
                    </div>
                  </StudioPreferencesProvider>
                </StudioShortcutsProvider>
              </ExportProvider>
            </RecordingSessionProvider>
          </CompositorProvider>
        </AudioMixerProvider>
      </SourcePlaybackProvider>
    </CaptureProvider>
    </PwaProvider>
  );
}

export default App;
