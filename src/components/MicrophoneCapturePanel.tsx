import type { ChangeEvent } from 'react';
import type { CaptureChannelStatus } from '../services/interfaces/capture-manager';
import { useCapture, useMicrophoneMeter } from '../state/CaptureContext';
import { AlertIcon, MicrophoneIcon } from './StudioIcons';

function getMicBadgeMeta(status: CaptureChannelStatus): {
  readonly label: string;
  readonly classes: string;
} {
  switch (status) {
    case 'active':
      return {
        label: 'Live',
        classes: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
      };
    case 'requesting':
      return {
        label: 'Requesting…',
        classes: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
      };
    case 'ended':
      return {
        label: 'Disconnected',
        classes: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
      };
    case 'error':
      return {
        label: 'Error',
        classes: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
      };
    case 'idle':
    default:
      return {
        label: 'Mic Off',
        classes: 'border-white/10 bg-slate-800/90 text-slate-300',
      };
  }
}

function MicrophoneLevelMeterReadout() {
  const reading = useMicrophoneMeter();

  const barColorClass = reading.clipping
    ? 'bg-rose-400'
    : reading.levelPercent >= 75
      ? 'bg-amber-400'
      : 'bg-emerald-400';

  const statusText = !reading.isMonitoring
    ? 'Inactive (0 percent)'
    : reading.clipping
      ? `${String(reading.levelPercent)} percent (clipping)`
      : `${String(reading.levelPercent)} percent`;

  return (
    <div className="mt-2.5 rounded-xl border border-white/[0.06] bg-slate-900/75 p-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-slate-100">
          <MicrophoneIcon className="h-3.5 w-3.5 text-emerald-300" />
          <span>Voice Level</span>
        </div>

        <div className="flex items-center gap-2">
          {reading.clipping && (
            <span
              data-testid="microphone-clip-badge"
              className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-200"
            >
              TOO LOUD
            </span>
          )}
          <span
            data-testid="microphone-level-value"
            className="font-mono text-xs font-semibold text-slate-100 tabular-nums"
          >
            {reading.isMonitoring ? `${String(reading.levelPercent)}%` : 'Off'}
          </span>
        </div>
      </div>

      <div
        role="meter"
        aria-label="Microphone input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={reading.levelPercent}
        aria-valuetext={statusText}
        data-testid="microphone-level-meter"
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800"
      >
        <div
          data-testid="microphone-level-fill"
          style={{ width: `${String(reading.levelPercent)}%` }}
          className={`h-full rounded-full ${barColorClass}`}
        />
      </div>

      {reading.error && (
        <p
          role="alert"
          data-testid="microphone-meter-error"
          className="mt-2 text-xs text-rose-200"
        >
          {reading.error}
        </p>
      )}
    </div>
  );
}

export function MicrophoneCapturePanel() {
  const { snapshot, startMicrophone, stopMicrophone, switchMicrophone } =
    useCapture();

  const isMicActive =
    snapshot.microphoneStatus === 'active' &&
    snapshot.activeMicrophoneStream !== null;
  const isRequesting = snapshot.microphoneStatus === 'requesting';
  const badge = getMicBadgeMeta(snapshot.microphoneStatus);

  const handleToggleMicrophone = () => {
    if (isMicActive || isRequesting) {
      stopMicrophone();
      return;
    }
    void startMicrophone();
  };

  const handleDeviceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    void switchMicrophone(event.currentTarget.value);
  };

  return (
    <section
      data-testid="microphone-capture-panel"
      aria-labelledby="microphone-panel-heading"
      className="flex min-w-0 flex-col rounded-xl border border-white/[0.07] bg-slate-950/65 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2
            id="microphone-panel-heading"
            className="text-sm font-semibold text-white"
          >
            Microphone
          </h2>
          {isMicActive && snapshot.activeMicrophoneLabel && (
            <span
              data-testid="active-microphone-label"
              className="rounded-md bg-slate-800/90 px-2 py-0.5 text-[11px] text-sky-300 break-words"
              title={snapshot.activeMicrophoneLabel}
            >
              {snapshot.activeMicrophoneLabel}
            </span>
          )}
        </div>

        <span
          data-testid="microphone-status-badge"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.classes}`}
        >
          {isMicActive && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            />
          )}
          {badge.label}
        </span>
      </div>

      {(snapshot.microphoneStatus === 'error' ||
        snapshot.microphoneStatus === 'ended') &&
        snapshot.microphoneError && (
          <div
            role="alert"
            data-testid="microphone-error-alert"
            className="mt-2.5 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/75 p-3 text-xs text-rose-100"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">
                  {snapshot.microphoneError.title}
                </span>
                <span className="rounded bg-rose-900/90 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
                  {snapshot.microphoneError.code}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-rose-100 break-words">
                {snapshot.microphoneError.message}
              </p>
            </div>
          </div>
        )}

      <div className={isMicActive ? 'block' : 'hidden'}>
        <MicrophoneLevelMeterReadout />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="microphone-toggle-button"
          onClick={handleToggleMicrophone}
          className={
            isMicActive || isRequesting
              ? 'inline-flex min-h-9 w-full items-center justify-center rounded-xl border border-rose-400/40 bg-rose-950/60 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
              : 'inline-flex min-h-9 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
          }
        >
          {isRequesting
            ? 'Cancel Microphone'
            : isMicActive
              ? 'Turn Off Microphone'
              : 'Turn On Microphone'}
        </button>
      </div>

      <div className="mt-2.5 flex flex-col gap-1">
        <label
          htmlFor="microphone-device-select"
          className="text-xs font-medium text-slate-300"
        >
          Choose microphone
        </label>
        <select
          id="microphone-device-select"
          data-testid="microphone-device-select"
          disabled={isRequesting || !snapshot.isSupported}
          value={snapshot.selectedMicrophoneDeviceId}
          onChange={handleDeviceChange}
          className="min-h-10 w-full rounded-xl border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Default Microphone</option>
          {snapshot.availableMicrophones.map((mic) => (
            <option key={mic.deviceId} value={mic.deviceId}>
              {mic.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
