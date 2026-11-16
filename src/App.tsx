import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { PlaybackControls } from './components/PlaybackControls';
import { RecordingSessionPanel } from './components/RecordingSessionPanel';
import { SceneStagePanel } from './components/SceneStagePanel';
import { StudioHeader } from './components/StudioHeader';
import { StudioPresetsModal } from './components/StudioPresetsModal';
import { StudioSettingsModal } from './components/StudioSettingsModal';
import { StudioWorkspaceDrawer } from './components/StudioWorkspaceDrawer';
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
import { StudioUiProvider } from './state/StudioUiContext';
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
                      <StudioUiProvider>
                        <div className="relative flex min-h-dvh w-full flex-col overflow-x-clip bg-slate-950 text-slate-100">
                          {/* Soft, mild ambient studio glow */}
                          <div
                            aria-hidden="true"
                            className="pointer-events-none fixed inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_70%_50%_at_50%_-15%,rgba(56,189,248,0.06),transparent_70%)]"
                          />

                          <StudioHeader />

                          <main
                            id="studio-main"
                            className="relative z-10 mx-auto w-full max-w-[92rem] flex-1 px-2.5 py-3 min-[375px]:px-3.5 sm:px-5 sm:py-5 lg:px-6 xl:px-8"
                          >
                            <div className="grid grid-cols-1 items-start gap-3.5 sm:gap-4 lg:grid-cols-12 lg:gap-5">
                              {/* Calm Stage + Simple Player + Record Bar */}
                              <div className="flex min-w-0 flex-col gap-2.5 sm:gap-3 lg:col-span-8 xl:col-span-9">
                                <SceneStagePanel />
                                <PlaybackControls />
                                <RecordingSessionPanel />
                              </div>

                              {/* Slim Side Panel (Devices · Audio · Takes) */}
                              <aside
                                aria-label="Studio setup, audio mix, and recorded takes"
                                className="min-w-0 lg:col-span-4 lg:sticky lg:top-[calc(var(--studio-header-height,3.75rem)+1rem)] xl:col-span-3"
                              >
                                <StudioWorkspaceDrawer />
                              </aside>
                            </div>
                          </main>

                          <footer className="relative z-10 border-t border-slate-900 bg-slate-950 px-3 py-3 text-center text-xs text-slate-400 break-words sm:px-6">
                            ReactStage · Private &amp; local on your device
                          </footer>

                          <StudioSettingsModal />
                          <StudioPresetsModal />
                          <KeyboardShortcutsModal />
                        </div>
                      </StudioUiProvider>
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
