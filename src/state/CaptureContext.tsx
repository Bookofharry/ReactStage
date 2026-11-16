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
  BrowserCaptureManager,
  MicrophoneLevelMeter,
  type MicrophoneMeterReading,
} from '../services/capture-manager';
import type {
  CameraCaptureConfig,
  CaptureManager,
  CaptureStateSnapshot,
  MediaDeviceDescriptor,
  MicrophoneCaptureConfig,
} from '../services/interfaces/capture-manager';

export interface CaptureContextValue {
  readonly snapshot: CaptureStateSnapshot;
  readonly refreshDevices: () => Promise<readonly MediaDeviceDescriptor[]>;
  readonly startCamera: (
    config?: CameraCaptureConfig,
  ) => Promise<MediaStream | null>;
  readonly stopCamera: () => void;
  readonly switchCamera: (deviceId: string) => Promise<MediaStream | null>;
  readonly flipCamera: () => Promise<MediaStream | null>;
  readonly setMirrorPreview: (mirror: boolean) => void;
  readonly toggleMirrorPreview: () => void;
  readonly startMicrophone: (
    config?: MicrophoneCaptureConfig,
  ) => Promise<MediaStream | null>;
  readonly stopMicrophone: () => void;
  readonly switchMicrophone: (deviceId: string) => Promise<MediaStream | null>;
  readonly stopAllCapture: () => void;
}

const CaptureContext = createContext<CaptureContextValue | null>(null);
const MicrophoneMeterContext = createContext<MicrophoneLevelMeter | null>(null);

export interface CaptureProviderProps {
  readonly children: ReactNode;
  readonly manager?: CaptureManager;
  readonly levelMeter?: MicrophoneLevelMeter;
}

export function CaptureProvider({
  children,
  manager: externalManager,
  levelMeter: externalMeter,
}: CaptureProviderProps) {
  const [internalManager] = useState<CaptureManager>(
    () => new BrowserCaptureManager(),
  );
  const [internalMeter] = useState<MicrophoneLevelMeter>(
    () => new MicrophoneLevelMeter(),
  );

  const activeManager = externalManager ?? internalManager;
  const activeMeter = externalMeter ?? internalMeter;
  const facingModeRef = useRef<'user' | 'environment'>('user');

  const subscribeCapture = useCallback(
    (listener: () => void) => activeManager.subscribe(listener),
    [activeManager],
  );
  const getCaptureSnapshot = useCallback(
    () => activeManager.getSnapshot(),
    [activeManager],
  );

  const snapshot = useSyncExternalStore(
    subscribeCapture,
    getCaptureSnapshot,
    getCaptureSnapshot,
  );

  // Borrow activeMicrophoneStream for Web Audio input level metering without stopping tracks
  useEffect(() => {
    activeMeter.attachStream(snapshot.activeMicrophoneStream);
  }, [activeMeter, snapshot.activeMicrophoneStream]);

  // Deterministic cleanup of owned hardware tracks and AudioContext on provider unmount
  useEffect(() => {
    return () => {
      activeMeter.stop();
      activeManager.stopAll();
    };
  }, [activeManager, activeMeter]);

  const refreshDevices = useCallback(
    () => activeManager.enumerateDevices(),
    [activeManager],
  );

  const startCamera = useCallback(
    (config?: CameraCaptureConfig) => activeManager.startCamera(config),
    [activeManager],
  );

  const stopCamera = useCallback(
    () => activeManager.stopCamera(),
    [activeManager],
  );

  const switchCamera = useCallback(
    (deviceId: string) => activeManager.switchCamera(deviceId),
    [activeManager],
  );

  const flipCamera = useCallback(() => {
    const current = activeManager.getSnapshot();
    const cams = current.availableCameras;
    if (cams.length >= 2) {
      const currentIdx = cams.findIndex(
        (c) =>
          c.deviceId ===
          (current.activeCameraDeviceId ?? current.selectedCameraDeviceId),
      );
      const nextCam = cams[(currentIdx + 1) % cams.length];
      if (nextCam) {
        return activeManager.switchCamera(nextCam.deviceId);
      }
    }
    const nextFacing: 'user' | 'environment' =
      facingModeRef.current === 'user' ? 'environment' : 'user';
    facingModeRef.current = nextFacing;
    return activeManager.startCamera({
      facingMode: nextFacing,
      mirrorPreview: nextFacing === 'user',
    });
  }, [activeManager]);

  const setMirrorPreview = useCallback(
    (mirror: boolean) => activeManager.setMirrorPreview(mirror),
    [activeManager],
  );

  const toggleMirrorPreview = useCallback(() => {
    activeManager.setMirrorPreview(!activeManager.getSnapshot().mirrorPreview);
  }, [activeManager]);

  const startMicrophone = useCallback(
    (config?: MicrophoneCaptureConfig) => activeManager.startMicrophone(config),
    [activeManager],
  );

  const stopMicrophone = useCallback(
    () => activeManager.stopMicrophone(),
    [activeManager],
  );

  const switchMicrophone = useCallback(
    (deviceId: string) => activeManager.switchMicrophone(deviceId),
    [activeManager],
  );

  const stopAllCapture = useCallback(
    () => activeManager.stopAll(),
    [activeManager],
  );

  const value = useMemo<CaptureContextValue>(
    () => ({
      snapshot,
      refreshDevices,
      startCamera,
      stopCamera,
      switchCamera,
      flipCamera,
      setMirrorPreview,
      toggleMirrorPreview,
      startMicrophone,
      stopMicrophone,
      switchMicrophone,
      stopAllCapture,
    }),
    [
      snapshot,
      refreshDevices,
      startCamera,
      stopCamera,
      switchCamera,
      flipCamera,
      setMirrorPreview,
      toggleMirrorPreview,
      startMicrophone,
      stopMicrophone,
      switchMicrophone,
      stopAllCapture,
    ],
  );

  return (
    <CaptureContext.Provider value={value}>
      <MicrophoneMeterContext.Provider value={activeMeter}>
        {children}
      </MicrophoneMeterContext.Provider>
    </CaptureContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCapture(): CaptureContextValue {
  const ctx = useContext(CaptureContext);
  if (!ctx) {
    throw new Error('useCapture must be used within a CaptureProvider');
  }
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMicrophoneMeter(): MicrophoneMeterReading {
  const meter = useContext(MicrophoneMeterContext);
  if (!meter) {
    throw new Error('useMicrophoneMeter must be used within a CaptureProvider');
  }

  const subscribe = useCallback(
    (listener: () => void) => meter.subscribe(listener),
    [meter],
  );
  const getSnapshot = useCallback(() => meter.getReading(), [meter]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
