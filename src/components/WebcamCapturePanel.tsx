import { useEffect, useRef, type ChangeEvent } from 'react';
import type { CaptureChannelStatus } from '../services/interfaces/capture-manager';
import { useCapture } from '../state/CaptureContext';
import {
  AlertIcon,
  CameraPlaceholderIcon,
  MirrorHorizontalIcon,
  RefreshIcon,
} from './StudioIcons';

function getCameraBadgeMeta(status: CaptureChannelStatus): {
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
        label: 'Camera Off',
        classes: 'border-slate-700 bg-slate-800 text-slate-300',
      };
  }
}

export function WebcamCapturePanel() {
  const {
    snapshot,
    startCamera,
    stopCamera,
    switchCamera,
    toggleMirrorPreview,
    refreshDevices,
  } = useCapture();

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const isCameraActive =
    snapshot.cameraStatus === 'active' && snapshot.activeCameraStream !== null;
  const isRequesting = snapshot.cameraStatus === 'requesting';
  const badge = getCameraBadgeMeta(snapshot.cameraStatus);

  // Borrow MediaStream from CaptureManager for compact self-monitor without altering stream pixels
  useEffect(() => {
    const videoEl = previewVideoRef.current;
    if (!videoEl) {
      return undefined;
    }

    videoEl.muted = true;

    if (snapshot.activeCameraStream) {
      if (videoEl.srcObject !== snapshot.activeCameraStream) {
        videoEl.srcObject = snapshot.activeCameraStream;
      }
      void videoEl.play().catch(() => undefined);
    } else {
      videoEl.srcObject = null;
    }

    return () => {
      videoEl.srcObject = null;
    };
  }, [snapshot.activeCameraStream]);

  const handleToggleCamera = () => {
    if (isCameraActive || isRequesting) {
      stopCamera();
      return;
    }
    void startCamera();
  };

  const handleDeviceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    void switchCamera(event.currentTarget.value);
  };

  return (
    <section
      data-testid="webcam-capture-panel"
      aria-labelledby="webcam-panel-heading"
      className="flex min-w-0 flex-col rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-lg min-[375px]:p-3.5 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="webcam-panel-heading"
          className="text-sm font-semibold text-slate-100"
        >
          Camera Setup
        </h2>
        <span
          data-testid="camera-status-badge"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.classes}`}
        >
          {isCameraActive && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            />
          )}
          {badge.label}
        </span>
      </div>

      {/* Compact Self-Check Thumbnail Row (avoids stacking a second full-size preview) */}
      <div className="mt-3 flex flex-col gap-2.5 rounded-lg border border-slate-800 bg-slate-950 p-2.5 min-[380px]:flex-row min-[380px]:items-center min-[380px]:gap-3">
        <div className="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded border border-slate-800 bg-slate-900 min-[380px]:w-28 sm:w-32">
          <video
            ref={previewVideoRef}
            data-testid="webcam-preview-video"
            aria-label="Local camera self-check monitor"
            muted
            playsInline
            autoPlay
            className={
              isCameraActive
                ? `h-full w-full object-cover ${
                    snapshot.mirrorPreview ? '-scale-x-100' : ''
                  }`
                : 'hidden'
            }
          />

          {snapshot.cameraStatus === 'idle' && (
            <CameraPlaceholderIcon className="h-5 w-5 text-slate-400" />
          )}

          {isRequesting && (
            <div
              role="status"
              data-testid="camera-requesting-indicator"
              className="flex flex-col items-center gap-1 text-center"
            >
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
              <span className="sr-only">Waiting for camera access…</span>
            </div>
          )}

          {(snapshot.cameraStatus === 'error' ||
            snapshot.cameraStatus === 'ended') && (
            <AlertIcon className="h-5 w-5 text-rose-300" />
          )}
        </div>

        <div className="min-w-0 flex-1 text-xs">
          {isCameraActive ? (
            <div className="flex flex-col gap-1">
              {snapshot.activeCameraLabel && (
                <p
                  data-testid="active-camera-label"
                  className="font-semibold text-slate-100 break-words"
                  title={snapshot.activeCameraLabel}
                >
                  {snapshot.activeCameraLabel}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-300">
                  Self-check monitor
                </span>
                {snapshot.mirrorPreview && (
                  <span
                    data-testid="camera-mirror-indicator"
                    className="rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
                  >
                    Mirrored Preview
                  </span>
                )}
              </div>
            </div>
          ) : isRequesting ? (
            <p className="font-medium text-slate-100">
              Waiting for camera permission…
            </p>
          ) : (
            <div>
              <p className="font-medium text-slate-100">Camera is off</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-300">
                Permissions are requested only when you click Start Camera.
              </p>
            </div>
          )}
        </div>
      </div>

      {(snapshot.cameraStatus === 'error' ||
        snapshot.cameraStatus === 'ended') &&
        snapshot.cameraError && (
          <div
            role="alert"
            data-testid="camera-error-alert"
            className="mt-2.5 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/75 p-3 text-xs text-rose-100"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">
                  {snapshot.cameraError.title}
                </span>
                <span className="rounded bg-rose-900/90 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
                  {snapshot.cameraError.code}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-rose-100 break-words">
                {snapshot.cameraError.message}
              </p>
            </div>
          </div>
        )}

      {snapshot.deviceEnumerationError && (
        <div
          role="alert"
          data-testid="device-enumeration-error"
          className="mt-2.5 rounded-lg border border-rose-500/40 bg-rose-950/70 px-3 py-2 text-xs text-rose-100 break-words"
        >
          <span className="font-semibold">
            {snapshot.deviceEnumerationError.title}:{' '}
          </span>
          {snapshot.deviceEnumerationError.message}
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="camera-toggle-button"
          onClick={handleToggleCamera}
          className={
            isCameraActive || isRequesting
              ? 'inline-flex min-h-10 min-w-[8.5rem] flex-1 items-center justify-center rounded-lg border border-rose-400/50 bg-rose-950/70 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-900/80 active:bg-rose-900/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
              : 'inline-flex min-h-10 min-w-[8.5rem] flex-1 items-center justify-center rounded-lg bg-sky-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 active:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
          }
        >
          {isRequesting
            ? 'Cancel Camera'
            : isCameraActive
              ? 'Stop Camera'
              : 'Start Camera'}
        </button>

        <button
          type="button"
          data-testid="camera-mirror-button"
          aria-pressed={snapshot.mirrorPreview}
          onClick={toggleMirrorPreview}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <MirrorHorizontalIcon className="h-3.5 w-3.5 text-sky-300" />
          <span>Mirror Preview</span>
        </button>

        <button
          type="button"
          data-testid="refresh-devices-button"
          disabled={snapshot.isEnumeratingDevices}
          onClick={() => {
            void refreshDevices();
          }}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshIcon className="h-3.5 w-3.5 text-slate-300" />
          <span>Refresh Devices</span>
        </button>
      </div>

      {/* Camera Device Selector */}
      <div className="mt-3 flex flex-col gap-1">
        <label
          htmlFor="camera-device-select"
          className="text-xs font-medium text-slate-300"
        >
          Camera Source
        </label>
        <select
          id="camera-device-select"
          data-testid="camera-device-select"
          disabled={isRequesting || !snapshot.isSupported}
          value={snapshot.selectedCameraDeviceId}
          onChange={handleDeviceChange}
          className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">System Default Camera</option>
          {snapshot.availableCameras.map((camera) => (
            <option key={camera.deviceId} value={camera.deviceId}>
              {camera.label}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
        Mirror Preview uses CSS on the self-check thumbnail only — Live Scene
        Stage canvas output remains unflipped.
      </p>
    </section>
  );
}
