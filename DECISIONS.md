# DECISIONS.md — Architectural Decision Records

## ADR-001: 100% Local-First Execution via Object URLs with Registry-Enforced Cleanup
- **Status**: Accepted (Task 1)
- **Context**: Reaction creators routinely work with large (`500 MB`–`4 GB`) local video files. Uploading files to a backend introduces latency, hosting costs, privacy risks, and copyright friction, while reading entire files via `FileReader.readAsArrayBuffer` exhausts browser tab memory.
- **Decision**: Ingest local `File` objects exclusively via `URL.createObjectURL(file)` managed by a dedicated `ObjectUrlRegistry`. Pre-validate files before creating any URL, and deterministically invoke `URL.revokeObjectURL` on replacement, media decode failure, manual unload, and React provider unmount.
- **Consequences**: Zero-copy instant video loading regardless of file size, zero network traffic, and provably zero `blob:` memory leaks.

---

## ADR-002: Strictly Separated Source Playback State vs. Recording Session State
- **Status**: Accepted (Task 1)
- **Context**: In a reaction studio, pausing or rewinding the source video is part of the creator's performance. Coupling the studio timeline to `HTMLVideoElement.currentTime` breaks pause-to-explain commentary and causes unwanted re-renders across unrelated UI panels.
- **Decision**: Maintain independent state models and React contexts (`SourcePlaybackContext`, `CaptureContext`, `CompositorContext`, `AudioMixerContext`, `RecordingSessionContext`).
- **Consequences**: Source transport updates never mutate recording session time, stop the live compositor loop, reset the Web Audio mix destination, or interrupt active camera/microphone streams.

---

## ADR-003: Six-Service Media Pipeline Interfaces Upfront
- **Status**: Accepted (Task 1)
- **Context**: Milestones incrementally introduce local playback, `getUserMedia` device capture, `<canvas>` real-time scene compositing, Web Audio graph mixing, `MediaRecorder` chunked capture, and artifact export.
- **Decision**: Define explicit, framework-agnostic TypeScript interfaces in `src/services/interfaces/` (`SourcePlayer`, `CaptureManager`, `SceneCompositor`, `AudioMixer`, `RecordingEngine`, `ExportManager`).
- **Consequences**: Clean module boundaries, straightforward unit mocking without hardware dependencies, and incremental milestone delivery (`SourcePlayer` in Task 1, `CaptureManager` in Task 2, `SceneCompositor` in Task 3, `AudioMixer` in Task 4).

---

## ADR-004: Two-Stage Media Validation (Pre-Allocation MIME/canPlayType + Post-Load Metadata Probe)
- **Status**: Accepted (Task 1)
- **Context**: File extensions alone are unreliable: a `.txt` renamed to `.mp4` or an audio-only `.mp4` (`0×0` video dimensions) can pass filename checks and fail in `<video>`.
- **Decision**: Validate byte size, MIME, and `canPlayType` prior to `createObjectURL`, then verify `videoWidth > 0`, `videoHeight > 0`, and finite positive `duration` on `loadedmetadata`, revoking failed Object URLs immediately.
- **Consequences**: Actionable `role="alert"` diagnostics for every failure class without leaked Object URLs.

---

## ADR-005: Honest Milestone Placeholders Instead of Fake Controls
- **Status**: Accepted (Task 1, Fulfilled Across Tasks 1–6)
- **Context**: Clickable mock controls mislead creators and pollute state machines.
- **Decision**: Only ship interactive controls backed by real media implementations (`SourcePlayer` in Task 1; `CaptureManager` + `MicrophoneLevelMeter` in Task 2; `CanvasSceneCompositor` in Task 3; `BrowserAudioMixer` in Task 4; `BrowserRecordingEngine` in Task 5; `BrowserExportManager` in Task 6). With Task 6 complete, every studio panel is backed by a verified local browser service with zero placeholders remaining.
- **Consequences**: Trustworthy UX, clean state invariants, and 100% WCAG 2.1 AA compliance.

---

## ADR-006: GitHub Pages Subpath Routing & Production E2E Verification
- **Status**: Accepted (Task 1)
- **Context**: GitHub Pages serves project sites under `/<repo>/`, breaking root-relative asset paths.
- **Decision**: Normalize `base` in `src/utils/base-path.ts` (`/ReactStage/` in production, configurable via `VITE_BASE_PATH`) and run Playwright E2E tests against `vite preview` at `http://127.0.0.1:4173/ReactStage/`.
- **Consequences**: Every E2E test verifies production asset paths under the GitHub Pages subpath.

---

## ADR-007: Independent Camera/Microphone Lifecycles, Track Ownership & Per-Channel Race Tokens
- **Status**: Accepted (Task 2)
- **Context**: Creators often record reactions with mic-only, webcam-only, or switch microphones mid-setup without wanting their webcam to flicker or stop. Additionally, `navigator.mediaDevices.getUserMedia` is asynchronous and may resolve after the user has clicked Cancel/Stop, switched devices, or unmounted the page.
- **Decision**:
  1. Never invoke `getUserMedia` or `enumerateDevices` on page load; trigger capture strictly from user actions, with an active **Cancel Camera / Cancel Microphone** control while pending.
  2. Maintain separate state machines and monotonic operation counters (`cameraOpId`, `microphoneOpId`) inside `BrowserCaptureManager`, immediately stopping any late-resolving superseded stream.
  3. `BrowserCaptureManager` exclusively owns `MediaStreamTrack` lifecycles (`stop()`), while UI components, meters, `CanvasSceneCompositor`, and `BrowserAudioMixer` borrow `MediaStream` references read-only.
- **Consequences**: Camera and microphone operate independently, source video playback/replacement/unload never affects capture, and hardware tracks never leak across async races or unmounts.

---

## ADR-008: CSS-Only Preview Mirroring & Zero-Destination Web Audio Input Metering
- **Status**: Accepted (Task 2)
- **Context**: Creators expect selfie-style horizontal mirroring in a self-check preview monitor, but mutating `MediaStream` pixels permanently bakes reversed text into downstream scenes. Separately, creators need visual mic input metering without speaker feedback.
- **Decision**:
  1. Apply preview mirroring purely via CSS (`-scale-x-100`) on `<video muted playsInline>` in `WebcamCapturePanel`, keeping `activeCameraStream` and `CanvasSceneCompositor` pixels unflipped.
  2. Implement `MicrophoneLevelMeter` connecting `MediaStreamAudioSourceNode -> AnalyserNode` only (never `AudioContext.destination`), with instant-attack / exponential-release studio ballistics and deterministic `AudioContext.close()` cleanup.
- **Consequences**: Unflipped composed scene output, zero speaker feedback loops, zero `AudioContext` leaks, and isolated React renders for meter updates.

---

## ADR-009: Dual-Layer Synthetic Hardware & Spectral FFT Verification Strategy
- **Status**: Accepted (Task 2, Extended Tasks 3 & 4)
- **Context**: Automated headless browsers lack physical USB cameras and microphones, yet real media pipelines must be verified beyond mocks — including pixel composition and actual multi-frequency Web Audio mixing.
- **Decision**: Combine native Chromium `--use-fake-device-for-media-stream` E2E tests with generated VP9/Opus video fixtures (`moving-source-6s.webm`, `portrait-source-4s.webm`, and `source-440hz-4s.webm` carrying a `440 Hz` tone), programmable `<canvas>.captureStream` + `1200 Hz` `OscillatorNode` synthetic microphone harnesses, and browser-side `4096`-point FFT `getFloatFrequencyData` spectral verification of `MediaStreamAudioDestinationNode`.
- **Consequences**: High-confidence automated proof of real browser pixel composition and frequency-domain audio mixing alongside deterministic edge-case coverage.

---

## ADR-010: Canvas 2D Live Scene Compositor with Normalized Geometry & Borrowed Media Decoders
- **Status**: Accepted (Task 3)
- **Context**: Reaction creators need one live output scene (`1280×720` or `1920×1080` at `30fps`) combining imported video and live webcam across four layouts (`source-only`, `camera-only`, `pip`, `side-by-side`) without mutating source playback or camera track ownership.
- **Decision**:
  1. Implement `CanvasSceneCompositor` over HTML5 Canvas 2D (`alpha: false`), borrowing `HtmlVideoSourcePlayer`'s `<video>` element read-only and decoding `CaptureManager`'s borrowed camera `MediaStream` through an internal detached `muted`, `playsInline` `<video>` element.
  2. Store PIP coordinates (`PipOverlayRect`) and `splitRatio` in normalized `[0..1]` canvas fractions computed via pure functions in `layout-geometry.ts`.
  3. Guard the 30fps scheduler with a monotonic `loopGeneration` counter and enforce local/untainted source checks before `drawImage`.
- **Consequences**: Deterministic pixel composition across portrait and landscape sources and clean readiness for `captureStream(30)`.

---

## ADR-011: Preview-First Single Dominant Stage & Throttled Telemetry Contexts
- **Status**: Accepted (Task 3, Extended Task 4)
- **Context**: High-frequency telemetry (`30fps` canvas frames and `25Hz` audio meters) dispatched through top-level React contexts would re-render controls dozens of times per second.
- **Decision**: Split structural control contexts (`CompositorContext`, `AudioMixerContext`) from high-frequency leaf-only telemetry contexts (`CompositorDiagnosticsContext`, `MicrophoneMeterContext`, `AudioMixerMetersContext`).
- **Consequences**: Responsive, jank-free sliders and transport controls while leaf meters update smoothly.

---

## ADR-012: Element-Bound `WeakMap` Web Audio Graph & Unified `0–200%` Source Gain Stage
- **Status**: Accepted (Task 4)
- **Context**:
  1. Calling `AudioContext.createMediaElementSource(video)` more than once on the same `HTMLMediaElement` throws `InvalidStateError`, and closing the `AudioContext` that created a `MediaElementAudioSourceNode` permanently silences that `HTMLMediaElement` for the rest of its DOM lifetime — a critical trap under React 19 `<StrictMode>` double-effect mounts and repeated video replacements.
  2. Once an `HTMLMediaElement` is routed into Web Audio, `<video>.volume` (`0`–`1`) scales the signal *before* `MediaElementAudioSourceNode`. Having separate uncoordinated `<video>.volume` and mixer `GainNode` controls causes unexpected `0.5 × 0.5 = 0.25` double-attenuation and prevents boosting quiet videos up to `200%`.
- **Decision**:
  1. Keep one persistent `<video>` element owned by `SourcePlaybackProvider` across file replacements and unloads, and cache `{ context, sourceNode }` inside a module-level `WeakMap<HTMLMediaElement, BoundMediaElementRecord>` in `BrowserAudioMixer`. Only close `AudioContext` when `dispose()` runs after `<video>` is disconnected from the document (`!videoEl.isConnected`) or on `pagehide`.
  2. Add `SourcePlayer.setExternalAudioControl(enabled)`: once `BrowserAudioMixer` binds `<video>`, `HtmlVideoSourcePlayer` holds `<video>.volume = 1` and `<video>.muted = false` at unity while `PlaybackControls` (`0–200%` volume + mute) and `AudioMixerPanel` (`0–200%` Video Audio gain + mute) bidirectionally drive the single Web Audio `sourceGainNode`.
- **Consequences**: Zero `InvalidStateError` crashes under `<StrictMode>` or repeated video replacements, true `0–200%` gain boost for quiet source clips, and zero double-attenuation between transport and mixer sliders.

---

## ADR-013: Distinct Speaker Monitor vs. `MediaStreamAudioDestinationNode` Mix Bus with Zero Mic-to-Speaker Routing
- **Status**: Accepted (Task 4)
- **Context**: A reaction creator must hear the imported source video through their speakers/headphones while speaking into a live microphone, yet routing live microphone audio to `AudioContext.destination` causes immediate acoustic feedback/echo, and routing source audio through multiple paths causes phase-comb doubling. Meanwhile, future `MediaRecorder` requires a single uninterrupted `MediaStream` containing *both* post-gain source audio and post-gain microphone commentary.
- **Decision**:
  1. Construct two strictly separated output sinks inside `BrowserAudioMixer`:
     - **Recorder Mix Destination**: `sourceGainNode -> masterGainNode -> MediaStreamAudioDestinationNode` and `micGainNode -> masterGainNode -> MediaStreamAudioDestinationNode` (1 stable audio track).
     - **Creator Monitor Destination**: `sourceGainNode -> monitorGainNode -> AudioContext.destination` (connected at most once when a source `<video>` is bound).
  2. Never create any connection path from `micStreamSourceNode` / `micGainNode` to `AudioContext.destination`, and verify `micToSpeakerPaths === 0` via automated graph-reachability audits in both Vitest and Playwright.
- **Consequences**: Clean single-path speaker monitoring of source video, provably zero digital microphone feedback, and a rock-solid `MediaStreamAudioDestinationNode` ready for Milestone 5 `RecordingEngine` consumption.

---

## ADR-014: Ephemeral Canvas `captureStream` Ownership, Pause-Aware Monotonic Clock & `O(1)` Streaming WebM Duration Patch
- **Status**: Accepted (Task 5)
- **Context**:
  1. `MediaRecorder` must combine `1280×720` / `1920×1080` composited video frames with mixed Web Audio without stopping the live compositor, audio mixer, or camera/mic hardware when a recording stops or cancels.
  2. Reaction creators pause, seek, slow down, or swap imported videos mid-recording, AND may also pause/resume the recording session itself; the session clock must reflect exact recorded commentary duration monotonically.
  3. Browser `MediaRecorder` outputs streaming unknown-length EBML WebM `Segment`s without a `Duration` (`0x4489`) element, causing `<video>` players and editors to report `duration === Infinity`.
- **Decision**:
  1. Derive a fresh `canvas.captureStream(targetFps)` per recording session (`stopVideoTracksOnFinalize: true`) while borrowing `AudioMixer.getMixedOutputStream()` read-only (never stopping mixed audio tracks), and split structural `RecordingSessionContext` from leaf-only `RecordingTelemetryContext` (~10Hz).
  2. Track `elapsedRecordingMs` via monotonic `performance.now()` deltas accumulated across `pause()` / `resume()` transitions, guarded by `sessionGeneration` tokens on `cancel()` / `dispose()`.
  3. Implement `patchWebmDurationIfStreaming` (`webm-duration.ts`) reading only `blob.slice(0, 8192)` and splicing the 11-byte float64 `Duration` (`0x4489`) element into `Segment -> Info` combined with `blob.slice(infoEnd)` in `O(1)` memory without copying video/audio clusters.
- **Consequences**: Zero leaked canvas capture tracks, continuous live preview/capture after stopping a take, independent commentary timing, and immediately seekable finite-duration WebM recordings verified in real Chromium `<video>` + FFT playback.

---

## ADR-015: Local Reaction Preview, Preview-URL Reuse During Download & Cross-Platform Filename Sanitization
- **Status**: Accepted (Task 6)
- **Context**:
  1. Creators want to immediately review their recorded reaction take (seeking and checking audio/video balance) and customize the filename before saving to disk, without re-encoding or uploading anything.
  2. Sharing a single `ObjectUrlRegistry` between `SourcePlayer` and `ExportManager` could accidentally revoke a source video URL when discarding a take (or vice versa).
  3. Synchronously revoking an `<a download>` `blob:` URL right after `.click()` can race Chromium's asynchronous `BlobRegistry` download IPC stream, truncating or failing downloads on large files.
- **Decision**:
  1. Instantiate an isolated `ObjectUrlRegistry` inside `BrowserExportManager` (`attachArtifact` / `dispose`), keeping source video `blob:` URLs and recorded reaction `blob:` URLs strictly independent.
  2. When `triggerLocalDownload` exports the currently attached artifact, reuse the active `previewUrl` directly on `<a download>` (zero extra `blob:` allocation and zero IPC race while preview remains mounted, with deterministic revocation when the take is replaced, discarded, or unmounted); when invoked standalone for an unattached artifact, revoke its ephemeral URL after a short grace timer (`300ms`) or immediately on `dispose()`.
  3. Sanitize custom and suggested filenames (`normalizeDownloadFileName`) across Windows and POSIX filesystems (stripping `<>:"/\|?*`, control bytes, path separators, reserved trailing dots/spaces, and enforcing `.webm` or `.mp4` extensions matching the container MIME).
- **Consequences**: Instant seekable `<video>` review, reliable zero-copy browser downloads verified to disk with valid EBML WebM headers, cross-platform safe filenames, and provably zero leaked Object URLs.

---

## ADR-016: Non-Canvas Pre-Roll Count-In, Single-Preview Multi-Take Session Drawer & WCAG 2.1.4 Studio Shortcuts
- **Status**: Accepted (Task 7)
- **Context**:
  1. Reaction creators benefit from an optional `3–2–1` count-in before `MediaRecorder` begins encoding, but drawing countdown digits onto `<canvas>` risks baking HUD chrome into the first recorded keyframe, and delaying Web Audio unlock by 3 seconds can lose browser user-activation privileges.
  2. Creators frequently record multiple reaction takes in one sitting and want to compare, rename, or download earlier takes without multiplying active `blob:` Object URLs.
  3. Broadcast single-character hotkeys (`K`, `J`, `1`–`4`, `V`, `M`, `R`, `P`) dramatically speed up live reactions, yet must never hijack form inputs and must satisfy WCAG 2.1 Success Criterion 2.1.4 (Character Key Shortcuts: Turn Off).
- **Decision**:
  1. Unlock Web Audio synchronously inside the initial user gesture (`requestStartRecording`), step `3 -> 2 -> 1` via a monotonic `countdownTokenRef`-guarded timer (`Cancel` / `Esc` / `Start Now`), and render `<StagePreRollOverlay />` as a pure DOM HUD layer above `<canvas>` so recorded video pixels remain untouched.
  2. Catalog completed `RecordedMediaArtifact` takes in `ExportContext` (`SessionTakeEntry[]`, preserving per-take custom filenames and download counts) while attaching **only** the currently selected take to `BrowserExportManager` — guaranteeing `activeObjectUrlCount <= 1` across arbitrary multi-take switching.
  3. Implement `StudioShortcutsProvider` + focus-trapped `KeyboardShortcutsModal` (`?`), automatically bypassing `<input>`, `<textarea>`, `<select>`, `<video>`, and interactive `Space` consumers, with an explicit **Shortcuts Enabled / Disabled** toggle fulfilling WCAG 2.1.4.
- **Consequences**: Broadcast-grade creator ergonomics with zero canvas pixel pollution, bounded single-URL preview memory, full keyboard + screen-reader accessibility, and `0` `axe-core` violations.

---

## ADR-017: Schema-Validated LocalStorage Workspace Persistence & Creator Presets Without Startup Permission Calls
- **Status**: Accepted (Task 8)
- **Context**:
  1. Reaction creators tune scene layout (`pip`, `side-by-side`, `source-only`, `camera-only`), PIP overlay geometry, split ratio, output resolution (`720p` / `1080p`), `Video Audio` vs. `Microphone` gain balance (`0–200%`), self-check preview mirroring, `3s Pre-Roll`, and WCAG 2.1.4 hotkey preferences across sessions, and often switch between distinct formats (e.g., Code Review vs. Trailer Reaction vs. Side-by-Side Commentary).
  2. Persisting device IDs or auto-starting camera/microphone hardware on mount would violate ReactStage's strict zero-permission-on-load privacy guarantee, while unvalidated `localStorage` JSON or `<StrictMode>` mount ordering could corrupt geometry bounds or overwrite saved settings with Render-1 factory defaults.
- **Decision**:
  1. Introduce `StudioPreferencesStore` (`src/services/studio-preferences/studio-preferences-store.ts`, key `'reactstage.studio-preferences.v1'`) storing only non-hardware workspace parameters (`StudioWorkspaceProfile`) and up to `12` custom `CreatorPreset` entries alongside `3` built-in starter presets, clamping every restored field (`clampPipRect`, `clampSplitRatio`, `[0..2]` gains) and gracefully recovering from corrupt JSON, out-of-range numbers, private-browsing `SecurityError`, or `QuotaExceededError`.
  2. Guard `<StrictMode>` hydration inside `StudioPreferencesProvider` (`pendingHydrationProfileRef`) so auto-persistence waits until child contexts reflect the hydrated profile before writing subsequent live edits, and never invoke `getUserMedia`, `enumerateDevices`, or `AudioContext` construction during hydration.
- **Consequences**: Instant zero-network setup restoration across browser reloads, one-click built-in and custom creator presets, full **Reset Defaults** recovery, and provably `0` unsolicited media permission calls on startup.

---

## ADR-018: Normalized Canvas 2D Telestrator & Transient Laser Pointer Without React Render Churn
- **Status**: Accepted (Task 9)
- **Context**:
  1. Educators, reviewers, and coaches frequently pause imported footage to circle details, draw directional arrows, highlight callout regions, or guide attention with a laser pointer — and those visual explanations must appear inside the recorded reaction video (`canvas.captureStream(30)`), not merely on a non-recorded DOM overlay.
  2. Dispatching React state updates on `pointermove` (`60–120 Hz`) would cause expensive component tree re-renders while recording live audio/video.
- **Decision**:
  1. Render committed `StageAnnotation` vectors (`pen`, `arrow`, `rect`) and transient `draftAnnotation` + `laserTrail` (`LASER_TRAIL_TTL_MS = 900`) directly inside `CanvasSceneCompositor`'s 2D render pass using normalized `[0..1]` scene coordinates so switching between `720p` and `1080p` preserves exact annotation alignment and proportional stroke thickness.
  2. Update `draftAnnotation` and `laserTrail` imperatively inside `CanvasSceneCompositor` (`setDraftAnnotation`, `pushLaserPoint`), publishing React `stateSnapshot` updates (`annotationCount`) **only** on stroke commit (`pointerup`), `undoAnnotation` (`Z` / `Ctrl+Z`), or `clearAnnotations` (`C`).
- **Consequences**: Zero React re-renders during live drawing, automatic inclusion of Telestrator ink and fading laser pointer inside exported WebM/MP4 takes, and resolution-independent `[0..1]` vector geometry.

---

## ADR-019: PIP Framing Masks (`rect` / `rounded` / `circle`) & Monotonic Session Chapter Markers (`YouTube 00:00`)
- **Status**: Accepted (Task 10)
- **Context**:
  1. Creators want expressive webcam presentation framing (`Rect`, `Rounded`, `Circle` creator bubble with selectable accent borders) persisted alongside their studio presets.
  2. Long-form technical reviews and commentary videos need timestamped chapters mapped to the **monotonic commentary recording clock** (`elapsedRecordingMs`, pausing when the recording pauses) while also noting the corresponding imported source video timestamp (`sourceTimeSec`) when applicable.
- **Decision**:
  1. Extend `CanvasSceneCompositor` with Canvas 2D path clipping (`arc` / rounded-rect path + border ring) for `pipFrameShape` (`rect` | `rounded` | `circle`) and `pipBorderStyle` (`sky` | `amber` | `emerald` | `subtle` | `none`), persisted in `StudioPreferencesStore`.
  2. Capture `RecordingChapterMarker` entries directly inside `BrowserRecordingEngine.addChapterMarker()` (`B` hotkey or live marker form) using `computeCurrentElapsedMs()`, freeze `chapterMarkers` onto `RecordedMediaArtifact` on `stop()`, and provide clickable `<video>` preview chapter chips + auto-`00:00 Intro` YouTube chapter formatting (`formatYouTubeChapters`) + local `-chapters.txt` export in `ExportPanel`.
- **Consequences**: Broadcast-ready circular/rounded PIP styling, exact commentary-clock chapter markers across pauses, one-click preview seeking, and instant YouTube chapter copy/download with zero network activity.
