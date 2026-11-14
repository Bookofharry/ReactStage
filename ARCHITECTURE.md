# ARCHITECTURE.md — ReactStage Video Systems Architecture

## 1. Architectural Overview
**ReactStage** is architected as a **client-only, zero-backend media reaction studio** executing entirely inside standard browser APIs. Its central design invariants are:
1. **Decoupling of Source Playback, Creator Capture, Scene Composition, Live Audio Mixing, and Session Recording Clocks/States**: Creators can load, play, pause, seek, rewind, change speed, replace, or unload imported local videos without ever interrupting live camera/microphone capture, resetting the Web Audio mixer bus, or stopping the live scene compositor.
2. **Strict Resource Ownership**: Services (`HtmlVideoSourcePlayer` and `BrowserCaptureManager`) own underlying `blob:` Object URLs, the `<video>` element, and `MediaStreamTrack`s; `CanvasSceneCompositor`, `BrowserAudioMixer`, React UI components, and `MicrophoneLevelMeter` borrow media elements and streams without mutating source playback timing, stopping borrowed tracks, creating duplicate `MediaElementAudioSourceNode`s, or leaking hardware/Web Audio handles.

```mermaid
flowchart TD
  subgraph Ingestion["Local Media Ingestion (Task 1 — Active)"]
    FileInput["File Picker / Drag & Drop"] --> Validator["validateSourceVideoFile<br/>(Size + MIME + canPlayType)"]
    Validator -->|Valid| Registry["ObjectUrlRegistry<br/>(Deterministic create/revoke)"]
    Registry --> SourcePlayer["HtmlVideoSourcePlayer<br/>(Implements SourcePlayer)"]
    SourcePlayer --> VideoEl["Source HTMLVideoElement<br/>(Unity volume=1, muted=false under Web Audio)"]
  end

  subgraph CreatorCapture["Creator Webcam & Mic Setup (Task 2 — Active)"]
    UserAction["Explicit User Action<br/>(Zero calls on page load)"] --> CaptureMgr["BrowserCaptureManager<br/>(Implements CaptureManager)"]
    CaptureMgr -->|Borrowed Video Stream| CamPreview["Compact Self-Check Thumbnail<br/>(muted + playsInline + CSS mirror)"]
    CaptureMgr -->|Borrowed Mic Stream| MicMeter["MicrophoneLevelMeter<br/>(Pre-fader Setup Input Meter,<br/>0 speaker connections)"]
  end

  subgraph LiveComposition["Live Scene Compositor (Task 3 — Active)"]
    VideoEl -->|Read-Only Frame Borrow| Compositor["CanvasSceneCompositor<br/>(Canvas 2D @ 30fps, 720p / 1080p)"]
    CaptureMgr -->|Borrowed Video Stream via<br/>Internal Unflipped Muted Video| Compositor
    Compositor --> StageCanvas["Single Dominant Preview Canvas<br/>(source-only | camera-only | pip | side-by-side)"]
  end

  subgraph LiveAudioMixing["Live Audio Mixer (Task 4 — Active)"]
    VideoEl -->|WeakMap Single MediaElementAudioSourceNode| SourceGain["Source GainNode (0–200% + Mute)<br/>+ Post-Gain AnalyserNode"]
    CaptureMgr -->|Borrowed Mic MediaStreamAudioSourceNode| MicGain["Mic GainNode (0–200% + Mute)<br/>+ Post-Gain AnalyserNode"]
    SourceGain -->|Monitor GainNode (<=1 connection)| SpeakerDest["AudioContext.destination<br/>(Creator Speaker Monitor — Video Only)"]
    SourceGain --> MasterMix["Master GainNode + Master AnalyserNode"]
    MicGain --> MasterMix
    MasterMix --> MixDest["MediaStreamAudioDestinationNode<br/>(1 Stable Audio Track — Future Recorder Bus)"]
  end

  subgraph LiveRecording["Session Recording Engine (Task 5 — Active)"]
    StageCanvas -->|Ephemeral captureStream 30| RecEngine["BrowserRecordingEngine<br/>(MediaRecorder + Monotonic Clock +<br/>Streaming WebM Duration Patch)"]
    MixDest -->|Borrowed Mixed Audio Stream| RecEngine
    RecEngine -->|In-Memory RecordedMediaArtifact| ArtifactBuf["Finalized Local Reaction Blob<br/>(Finite Duration + Video/Audio)"]
  end

  subgraph LiveExport["Local Export Pipeline (Task 6 — Active)"]
    ArtifactBuf --> ExportMgr["BrowserExportManager<br/>(Isolated ObjectUrlRegistry Preview +<br/>Sanitized Local Download + Cleanup)"]
  end

  subgraph StateSlices["Isolated React Context Topology"]
    SourcePlayer --> PlaybackCtx["SourcePlaybackContext"]
    CaptureMgr --> CaptureCtx["CaptureContext"]
    MicMeter --> MeterCtx["MicrophoneMeterContext (~25Hz)"]
    Compositor --> CompCtx["CompositorContext"]
    Compositor --> CompDiagCtx["CompositorDiagnosticsContext (~2Hz)"]
    MasterMix --> MixerCtx["AudioMixerContext"]
    MasterMix --> MixerMetersCtx["AudioMixerMetersContext (~25Hz)"]
    RecEngine --> RecordingCtx["RecordingSessionContext"]
    RecEngine --> RecTelCtx["RecordingTelemetryContext (~10Hz)"]
    ExportMgr --> ExportCtx["ExportContext<br/>(Multi-Take Session Drawer)"]
    PlaybackCtx --> ShortcutsCtx["StudioShortcutsContext<br/>(WCAG 2.1.4 Hotkeys)"]
    PrefStore["StudioPreferencesStore<br/>(Schema-Validated localStorage v1)"] <--> PrefsCtx["StudioPreferencesContext<br/>(Auto-Save & Creator Presets)"]
  end
```

---

## 2. Isolated State & Clock Topology

| State Domain | Provider / Store | Primary Responsibility | Isolation Guarantee |
| :--- | :--- | :--- | :--- |
| **`SourcePlaybackState`** | `SourcePlaybackContext` (`PlaybackContext.tsx`) | Local video `currentTimeSec`, `durationSec`, `playbackRate`, unified `volume` (`0`–`2`), `muted`, `ObjectUrlRegistry` | Seeking, pausing, replacing, or unloading source media never touches `CaptureManager`, `SceneCompositor` loop state, `BrowserAudioMixer`'s mic channel, or `RecordingSessionState`. |
| **`CaptureStateSnapshot`** | `CaptureContext` (`CaptureContext.tsx`) | Independent camera & microphone permissions, device lists, active streams, CSS mirror flag, error states | Camera start/stop/switch/failure never interrupts microphone capture, and vice versa. Zero permissions requested on page load. |
| **`MicrophoneMeterReading`** | `MicrophoneMeterContext` (`CaptureContext.tsx`) | ~25Hz smoothed pre-fader setup `rms`, `peak`, `levelPercent`, and `clipping` telemetry | Subscribed only by the leaf setup meter bar component. |
| **`CompositorStateSnapshot`** | `CompositorContext` (`CompositorContext.tsx`) | Structural scene config (`layoutMode`, `resolutionPreset`, `width`, `height`, `targetFps`, `pipRect`, `pipFrameShape`, `pipBorderStyle`, `splitRatio`, `annotationCount`, `isRunning`, `error`) + transient Telestrator draft/laser channels | Emits only on discrete user configuration, stroke commit, or lifecycle transitions — **zero React re-renders during steady-state 30fps frame rendering or 60Hz+ pointer drawing/laser trails**. |
| **`CompositorDiagnostics`** | `CompositorDiagnosticsContext` (`CompositorContext.tsx`) | Throttled (~2Hz) `measuredFps`, `renderedFrames`, `sourceStatus`, `cameraStatus` telemetry | Subscribed only by leaf telemetry badges inside `SceneStagePanel`. |
| **`AudioMixerStateSnapshot`** | `AudioMixerContext` (`AudioMixerContext.tsx`) | Structural Web Audio state (`status`, `mixMode`, `sourceAvailability`, `microphoneAvailability`, `0–200%` channel gains/mutes, `outputTrackCount`, `error`) | Emits only on discrete gain/mute, availability, or `AudioContext` state transitions; unified bidirectionally with `PlaybackControls` source volume/mute. |
| **`AudioMeterSnapshot`** | `AudioMixerMetersContext` (`AudioMixerContext.tsx`) | ~25Hz post-gain RMS, peak, `0–100%` levels, and `CLIP` (`peak >= 0.98`) flags for source, mic, and combined mix bus | Subscribed only by leaf meter components inside `AudioMixerPanel` so meter ballistics never re-render `<canvas>`, sliders, or transport controls. |
| **`RecordingSessionState` & `RecordingStateSnapshot`** | `RecordingSessionContext` (`RecordingSessionContext.tsx`) | Structural recording session lifecycle (`idle`, `arming`, `recording`, `paused`, `stopping`, `completed`, `error`), codec negotiation, live `activeMarkers` (`RecordingChapterMarker[]`), `RecordedMediaArtifact` | Completely decoupled from `SourcePlaybackState.currentTimeSec`; pausing, seeking, slowing down, replacing, or unloading source video never interrupts active recording. |
| **`RecordingTelemetry`** | `RecordingTelemetryContext` (`RecordingSessionContext.tsx`) | ~10Hz (`100ms`) monotonic `elapsedRecordingMs`, `recordedBytes`, and `chunkCount` | Subscribed only by leaf clock/byte components (`StudioHeader`, `PlaybackControls`, `RecordingSessionPanel`) so timer ticks never re-render `<canvas>` or audio sliders. |
| **`ExportStateSnapshot`** | `ExportContext` (`ExportContext.tsx`) | Multi-take session catalog (`takes`, `selectedTakeId`, per-take custom filenames & download counts), single active `previewUrl`, `suggestedFileName`, and isolated `ObjectUrlRegistry` | At most **1** preview `blob:` URL is allocated at any moment across multi-take switching, managed in a dedicated `ObjectUrlRegistry` separate from `SourcePlayer`'s source URLs and revoked deterministically on switch, discard, or unmount. |
| **`StudioShortcutsContextValue`** | `StudioShortcutsContext` (`StudioShortcutsContext.tsx`) | Global studio hotkeys (`Space`/`K`, `J`, `1`–`4`, `V`, `M`, `R`, `Shift+R`, `P`, `Esc`, `?`), accessible focus-trapped dialog, and WCAG 2.1.4 single-key turn-off toggle | Automatically ignores `<input>`, `<textarea>`, `<select>`, `<video>`, open `[role="dialog"]` modals, and interactive `Space` targets so typing filenames or preset names never triggers studio hotkeys. |
| **`StudioPreferencesSnapshot`** | `StudioPreferencesContext` (`StudioPreferencesContext.tsx`) + `StudioPreferencesStore` | Schema-validated `localStorage` (`reactstage.studio-preferences.v1`) workspace auto-save, 3 built-in starter presets, up to 12 custom creator presets, and **Reset Defaults** | Hydrates non-hardware settings (`layoutMode`, `pipRect`, `splitRatio`, `resolutionPreset`, `sourceGain`/`micGain`/mutes, `mirrorPreview`, `preRollEnabled`, `shortcutsEnabled`) with `<StrictMode>` hydration guards and **zero** `getUserMedia` / `enumerateDevices` calls on page load. |

---

## 3. Source Video Lifecycle & Unified Web Audio Routing

Understanding how every `SourcePlayer` operation interacts with `<video>`, `CanvasSceneCompositor`, and `BrowserAudioMixer`:

1. **Importing a Local Video (`loadFile(file)`)**:
   - `validateSourceVideoFile` checks non-zero byte size, supported container MIME/extension, and `canPlayType` **before** creating any `blob:` URL.
   - `ObjectUrlRegistry.create(file)` allocates a tracked `blob:` URL; `HtmlVideoSourcePlayer` sets `video.src = objectUrl` and `video.load()`.
   - Once `loadedmetadata` confirms `videoWidth > 0`, `videoHeight > 0`, and finite `duration > 0`, `AudioMixerProvider` synchronizes `mixer.attachSourceElement(video, { label })`, lazily initializing Web Audio and binding `<video>` once via `createMediaElementSource(video)`.
2. **Replacing or Unloading a Video (`loadFile(nextFile)` / `unload()`)**:
   - `HtmlVideoSourcePlayer` pauses `<video>`, revokes the previous `blob:` Object URL immediately via `ObjectUrlRegistry`, and clears or swaps `video.src` on the **same mounted `<video>` element**.
   - Because the DOM `<video>` element is preserved, `BrowserAudioMixer` reuses the existing `MediaElementAudioSourceNode` from its `WeakMap` without recreating the audio graph or interrupting the live microphone channel or `MediaStreamAudioDestinationNode`. When unloaded, `sourceAvailability` transitions to `'no-source'` and `sourceGainNode` is silenced while the microphone remains live on the mixed output.
3. **Playing, Pausing, Seeking, and Changing Playback Speed**:
   - `play()` triggers `mixer.resume()` inside the user gesture so browser autoplay policies unlock `AudioContext` seamlessly, then calls `video.play()`.
   - `pause()` pauses `<video>`: Web Audio naturally pulls digital zeros (`0.0`) from the paused `MediaElementAudioSourceNode`, silencing only the source channel while `micGainNode` continues feeding live commentary into `MediaStreamAudioDestinationNode` and `CanvasSceneCompositor` holds the paused video frame while rendering live webcam frames.
   - `seek()` / `rewind()` / `setPlaybackRate()` mutate only `<video>.currentTime` or `<video>.playbackRate` (`preservesPitch` stays browser-managed); neither microphone capture nor the mixer destination stream is touched.
4. **Volume (`0–200%`) and Muting (Unified Control)**:
   - Once Web Audio captures an `HTMLMediaElement` via `createMediaElementSource(video)`, `<video>.volume` and `<video>.muted` still scale the signal *before* it enters `MediaElementAudioSourceNode`. If both `<video>.volume` and a Web Audio `GainNode` applied `0.5`, output gain would silently double-attenuate to `0.25` (and `<video>.volume` cannot boost above `1.0` / `100%`).
   - To eliminate double-attenuation and slider conflicts, `AudioMixerProvider` calls `player.setExternalAudioControl(true)` once `BrowserAudioMixer` binds `<video>`. `HtmlVideoSourcePlayer` holds `<video>.volume = 1` and `<video>.muted = false` at unity while `SourcePlaybackState.volume` (`0`–`2`) and `muted` stay bidirectionally synchronized with `BrowserAudioMixer.setSourceGain()` / `setSourceMuted()`. Moving either `PlaybackControls`'s volume slider or `AudioMixerPanel`'s `Video Audio` slider updates one canonical Web Audio `sourceGainNode` (`0–200%`).

---

## 4. Core Service Interfaces (`src/services/interfaces/`)

1. **`SourcePlayer`** (`source-player.ts` — *Implemented in Task 1, extended in Task 4 via `HtmlVideoSourcePlayer`*):
   - Owns local `File` validation, `ObjectUrlRegistry` lifecycle, `<video>` DOM binding, metadata verification, transport (`play`, `pause`, `seek`, `rewind`, `restart`), `playbackRate` (`0.5x`–`2x`), `volume` (`0`–`2`), `muted`, and `setExternalAudioControl(enabled)` unity delegation for Web Audio.
2. **`CaptureManager`** (`capture-manager.ts` — *Implemented in Task 2 via `BrowserCaptureManager`*):
   - Enumerates `videoinput` / `audioinput` devices on demand, starts/stops/switches camera and microphone streams independently from explicit user actions, guards against async `getUserMedia` races via monotonic tokens (`cameraOpId`, `microphoneOpId`), handles unexpected `MediaStreamTrack` `'ended'` events, and guarantees `track.stop()` cleanup.
   - Paired with **`MicrophoneLevelMeter`** (`src/services/capture-manager/microphone-level-meter.ts`) for pre-fader setup input metering without speaker output.
3. **`SceneCompositor`** (`scene-compositor.ts` — *Implemented in Task 3 via `CanvasSceneCompositor`*):
   - Composites the borrowed `HTMLVideoElement` and borrowed active camera `MediaStream` onto a single dominant HTML5 2D `<canvas>` (`1280×720` or `1920×1080` @ `30fps`) across `source-only`, `camera-only`, `pip`, and `side-by-side` layouts.
4. **`AudioMixer`** (`audio-mixer.ts` — *Implemented in Task 4 via `BrowserAudioMixer`*):
   - Combines imported source-video audio (`MediaElementAudioSourceNode`) and borrowed live microphone audio (`MediaStreamAudioSourceNode`) with independent `0–200%` (`0.0`–`2.0`) gains, independent mute controls, post-gain RMS/peak `AnalyserNode` meters + `CLIP` (`peak >= 0.98`) indicators, four derived mix modes (`combined`, `source-only`, `microphone-only`, `silent`), single speaker-monitor routing for source video only, zero mic-to-speaker paths, and one persistent `MediaStreamAudioDestinationNode` output stream for future `MediaRecorder` consumption.
5. **`RecordingEngine`** (`recording-engine.ts` — *Implemented in Task 5 via `BrowserRecordingEngine`*):
   - Orchestrates `MediaRecorder` over an ephemeral `compositor.getCanvas().captureStream(30)` video stream (`stopVideoTracksOnFinalize: true`) + borrowed `mixer.getMixedOutputStream()` audio stream (never stopped by the recorder), with priority MIME/codec negotiation (`vp9,opus` -> `vp8,opus` -> `h264,opus` -> `webm` -> `mp4`), a pause-aware monotonic `performance.now()` session clock (`elapsedRecordingMs`), `sessionGeneration` race protection, `cancel()`/`clearArtifact()`/`dispose()`, and `O(1)` header-slice EBML `Duration` (`0x4489`) patching (`webm-duration.ts`) so recorded WebM artifacts decode with finite duration in `<video>` players.
6. **`ExportManager`** (`export-manager.ts` — *Implemented in Task 6 via `BrowserExportManager`*):
   - Attaches finalized `RecordedMediaArtifact` takes, allocates and revokes preview `blob:` URLs through a dedicated `ObjectUrlRegistry`, normalizes and sanitizes Windows/POSIX download filenames (`<source-stem>-reaction-<YYYYMMDD-HHMMSS>.<ext>`), triggers direct local browser `<a download>` saves reusing the active `previewUrl` (eliminating duplicate `blob:` allocations and asynchronous Chromium download IPC races), and deterministically revokes URLs on replacement, discard, or `dispose()`.

---

## 5. Web Audio Graph Ownership & Isolation Invariants (`BrowserAudioMixer`)

1. **Single `MediaElementAudioSourceNode` per `HTMLMediaElement` Lifetime**:
   - The Web Audio spec forbids calling `audioContext.createMediaElementSource(el)` more than once on the same `HTMLMediaElement` (throwing `InvalidStateError`) and permanently binds that element to the `AudioContext` that created the node.
   - `BrowserAudioMixer` stores a module-level `WeakMap<HTMLMediaElement, BoundMediaElementRecord>` caching `{ context, sourceNode }`. Across React `<StrictMode>` double-mounts, video replacements, and unloads, the mixer reuses the bound `AudioContext` and `MediaElementAudioSourceNode`, calling `audioContext.close()` only when the mixer is disposed after `<video>` is detached from the live DOM (`!videoEl.isConnected` or `pagehide`).
2. **Distinct Speaker Monitor Bus vs. Recorder Mix Bus (Zero Mic Echo)**:
   - **Recorder Mix Bus**: `sourceGainNode -> masterGainNode -> MediaStreamAudioDestinationNode` **and** `micGainNode -> masterGainNode -> MediaStreamAudioDestinationNode`. Produces exactly `1` mixed audio track (`0` video tracks) whose `MediaStream` reference stays constant across play, pause, seek, video replacement, unload, and live mic switching.
   - **Creator Speaker Monitor Bus**: `sourceGainNode -> monitorGainNode -> AudioContext.destination` (connected **at most once**). Creators hear their imported video at the exact post-gain/mute level they set, while `micGainNode` **never** has any direct or transitive edge to `AudioContext.destination`, preventing acoustic speaker feedback loops.
3. **Silent / Trackless Video & Borrowed Track Safety**:
   - Inspects browser `audioTracks`, `mozHasAudio`, and Chromium's `webkitAudioDecodedByteCount` (after `>= 0.25s` playback) to surface `No Audio Track` (`'no-audio-track'`) truthfully when a video container carries no audio stream, while keeping microphone mixing active.
   - Attaches `'ended'`, `'mute'`, and `'unmute'` listeners to borrowed microphone `MediaStreamTrack`s to report `'track-ended'` / `'track-muted'` states without ever calling `track.stop()` on `CaptureManager`-owned tracks.
4. **Autoplay Gesture Recovery**:
   - Zero `AudioContext`s are created on initial empty page load. If browser autoplay policy leaves `AudioContext.state === 'suspended'` (e.g., after drag-and-drop), `AudioMixerPanel` surfaces `Audio Suspended` with an explicit user-gesture **Enable Audio** button calling `mixer.resume()`.

---

## 6. Scene Composition Geometry & Future `captureStream(30)` Ownership Contract

### Four Layout Modes & Aspect-Safe Math (`layout-geometry.ts`)
- **`source-only`**: `computeContainRect` aspect-safe letterbox/pillarbox without stretching.
- **`camera-only`**: `computeCoverCrop` centered full-bleed camera crop.
- **`pip`**: Normalized `[0..1]` draggable/resizable camera overlay (`minMargin = 0.02`, `width ∈ [0.16..0.48]`) with pointer, touch, and keyboard controls.
- **`side-by-side`**: Horizontal split (`splitRatio ∈ [0.20..0.80]`) with `contain`-fitted source left pane and `cover`-cropped camera right pane.

### `RecordingEngine` Stream Ownership & Streaming WebM Duration Patch (`BrowserRecordingEngine`)
- On **Start Recording**, `RecordingSessionProvider` unlocks Web Audio (`enableAudio()`) inside the user gesture, ensures the compositor loop is running and paints an immediate frame (`captureSceneStream(30)`), and passes `(sceneStream, mixedAudioStream, { stopVideoTracksOnFinalize: true })` to `BrowserRecordingEngine.start()`.
- When a session stops, cancels, fails, or disposes, `BrowserRecordingEngine` stops **only** the ephemeral `CanvasCaptureMediaStreamTrack` — leaving `CanvasSceneCompositor`, `BrowserAudioMixer`'s `MediaStreamAudioDestinationNode`, and `BrowserCaptureManager`'s camera/mic hardware tracks live.
- Because browser `MediaRecorder` writes streaming unknown-length WebM `Segment`s without a `Duration` (`0x4489`) header element, `patchWebmDurationIfStreaming` (`webm-duration.ts`) inspects only the first `8 KB` slice (`blob.slice(0, 8192)`) and splices the 11-byte float64 `Duration` element into `Segment -> Info` (`new Blob([prefix, sizeVint, info, durationElem, blob.slice(infoEnd)])`) in `O(1)` memory without copying media clusters.

---

## 7. Synthetic Hardware Verification & Known Browser/Hardware Limitations
- **Dual-Layer E2E & Spectral FFT Verification**:
  1. **Native Chromium Synthetic Driver (`--use-fake-device-for-media-stream`)**: Exercises Chromium's C++ media capture pipeline, `<video srcObject>` frame decoding, `CanvasRenderingContext2D.drawImage` composition, and Web Audio `AnalyserNode` metering.
  2. **Deterministic Spectral FFT Harness (`audio-mixer.spec.ts`)**: Combines a generated `440 Hz` Opus/VP9 WebM video fixture (`source-440hz-4s.webm`) with a synthetic `1200 Hz` sine-wave `getUserMedia` microphone stream and inspects `mixer.getMixedOutputStream()` via a dedicated `4096`-point FFT `AnalyserNode` (`getFloatFrequencyData`), verifying simultaneous `440 Hz` + `1200 Hz` energy in combined mode, selective `440 Hz` removal (`< -55 dBFS`) while `1200 Hz` remains (`> -35 dBFS`) on source pause/mute, `200%` clipping detection, `0` mic-to-speaker graph paths, and `No Audio Track` detection on trackless WebM files (`moving-source-6s.webm`).
- **Real-World Browser & Hardware Limitations to Note**:
  - **Autoplay Policy Suspension**: Safari, Firefox, and Chromium without `--autoplay-policy` suspend newly created `AudioContext`s until a trusted `click`/`keydown`/`pointerdown` gesture invokes `AudioContext.resume()`. `AudioMixerPanel` provides an explicit **Enable Audio** button whenever `status === 'suspended'`.
  - **Silent Audio Stream vs. Trackless Container**: `webkitAudioDecodedByteCount === 0` reliably identifies containers with *no* encoded audio track in Chromium, whereas a video file containing an encoded Opus/AAC track filled with digital zero samples is structurally `'playing'` with `0%` post-gain meter level.
  - **Acoustic Bleed Without Headphones**: Although `BrowserAudioMixer` guarantees zero digital microphone-to-speaker routing, if a creator monitors loud video playback over open laptop speakers while recording into a nearby condenser mic without headphones, physical room bleed can enter the microphone capsule (standard studio headphone recommendation applies).
  - **Background Tab Throttling & Bluetooth Profile Switching**: Hidden tabs clamp timers, and Bluetooth headsets switching from A2DP to HFP/HSP on mic activation can briefly renegotiate OS audio sample rates (`48 kHz` -> `16 kHz`).

---

## 8. Static Deployment & GitHub Pages Base Path
- `src/utils/base-path.ts` resolves Vite's `base` option to `/` in development and `/ReactStage/` in production (overridable via `VITE_BASE_PATH` in `.github/workflows/deploy.yml`).
- Public assets in `index.html` use relative paths (`./favicon.svg`).
