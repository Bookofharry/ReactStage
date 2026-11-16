import { useAudioMixer } from '../state/AudioMixerContext';
import { useCapture } from '../state/CaptureContext';
import { useExport } from '../state/ExportContext';
import { useStudioUi, type WorkspaceDrawerTab } from '../state/StudioUiContext';
import { AudioMixerPanel } from './AudioMixerPanel';
import { ExportPanel } from './ExportPanel';
import { MicrophoneCapturePanel } from './MicrophoneCapturePanel';
import {
  AudioMixerIcon,
  DownloadIcon,
  VideoCameraIcon,
} from './StudioIcons';
import { WebcamCapturePanel } from './WebcamCapturePanel';

export function StudioWorkspaceDrawer() {
  const { activeTab, setActiveTab } = useStudioUi();
  const { snapshot: captureSnapshot } = useCapture();
  const { state: mixerState, enableAudio } = useAudioMixer();
  const { takes } = useExport();

  const isCamOn =
    captureSnapshot.cameraStatus === 'active' &&
    captureSnapshot.activeCameraStream !== null;
  const isMicOn =
    captureSnapshot.microphoneStatus === 'active' &&
    captureSnapshot.activeMicrophoneStream !== null;
  const activeDeviceCount = (isCamOn ? 1 : 0) + (isMicOn ? 1 : 0);

  const tabs: readonly {
    readonly id: WorkspaceDrawerTab;
    readonly label: string;
    readonly badge: string | null;
    readonly activeDot: boolean;
  }[] = [
    {
      id: 'devices',
      label: 'Devices',
      badge: activeDeviceCount > 0 ? `${String(activeDeviceCount)} On` : null,
      activeDot: activeDeviceCount > 0,
    },
    {
      id: 'audio',
      label: 'Audio',
      badge:
        mixerState.autoDuckEnabled || mixerState.micProcessingEnabled
          ? 'Smart'
          : null,
      activeDot: mixerState.status === 'running',
    },
    {
      id: 'takes',
      label: 'Takes',
      badge: takes.length > 0 ? String(takes.length) : null,
      activeDot: takes.length > 0,
    },
  ];

  return (
    <div
      data-testid="studio-workspace-drawer"
      className="flex min-w-0 flex-col rounded-2xl border border-slate-800/80 bg-slate-900/55 p-2.5 sm:p-3"
    >
      {/* Always-visible Browser Autoplay Audio Prompt if suspended */}
      {mixerState.requiresUserGesture && (
        <div
          data-testid="mixer-gesture-banner"
          className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-400/40 bg-amber-950/65 px-3 py-2.5 text-xs text-amber-100"
        >
          <p className="min-w-0 flex-1 leading-relaxed">
            Your browser paused studio sound. Tap{' '}
            <strong className="font-semibold text-amber-200">
              Enable Audio
            </strong>{' '}
            to hear video playback.
          </p>
          <button
            type="button"
            data-testid="enable-audio-button"
            onClick={() => {
              void enableAudio();
            }}
            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-200 active:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            Enable Audio
          </button>
        </div>
      )}

      {/* Mild Segmented 3-Tab Switcher */}
      <div
        role="tablist"
        aria-label="Studio workspace panels"
        className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950/80 p-1"
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`workspace-tab-btn-${tab.id}`}
              type="button"
              role="tab"
              data-testid={`workspace-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`workspace-tabpanel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={
                selected
                  ? 'inline-flex min-h-9 flex-wrap items-center justify-center gap-1 rounded-lg bg-slate-800 px-1.5 py-1.5 text-[11px] font-semibold text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 min-[375px]:gap-1.5 min-[375px]:px-2 min-[375px]:text-xs'
                  : 'inline-flex min-h-9 flex-wrap items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 min-[375px]:gap-1.5 min-[375px]:px-2 min-[375px]:text-xs'
              }
            >
              {tab.id === 'devices' && (
                <VideoCameraIcon className="hidden h-3.5 w-3.5 shrink-0 text-slate-300 min-[400px]:block" />
              )}
              {tab.id === 'audio' && (
                <AudioMixerIcon className="hidden h-3.5 w-3.5 shrink-0 text-slate-300 min-[400px]:block" />
              )}
              {tab.id === 'takes' && (
                <DownloadIcon className="hidden h-3.5 w-3.5 shrink-0 text-slate-300 min-[400px]:block" />
              )}
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={
                    selected
                      ? 'rounded-full bg-sky-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-200 tabular-nums'
                      : 'rounded-full bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-300 tabular-nums'
                  }
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panel 1: Devices (Camera & Microphone Setup) */}
      <div
        id="workspace-tabpanel-devices"
        role="tabpanel"
        aria-labelledby="workspace-tab-btn-devices"
        className={
          activeTab === 'devices' ? 'mt-3 flex flex-col gap-3' : 'hidden'
        }
      >
        <WebcamCapturePanel />
        <MicrophoneCapturePanel />
      </div>

      {/* Panel 2: Audio Mix & Voice Enhancement */}
      <div
        id="workspace-tabpanel-audio"
        role="tabpanel"
        aria-labelledby="workspace-tab-btn-audio"
        className={activeTab === 'audio' ? 'mt-3 block' : 'hidden'}
      >
        <AudioMixerPanel />
      </div>

      {/* Panel 3: Recorded Takes, Trim & Export */}
      <div
        id="workspace-tabpanel-takes"
        role="tabpanel"
        aria-labelledby="workspace-tab-btn-takes"
        className={activeTab === 'takes' ? 'mt-3 block' : 'hidden'}
      >
        <ExportPanel />
      </div>
    </div>
  );
}
