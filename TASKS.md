# TASKS.md — ReactStage Milestone Tracker & Verification Ledger

## Task 1: Studio Foundation, Local Source Player & Service Contracts (COMPLETED)

### Checklist
- [x] Scaffold React 19 + TypeScript + Vite 6 + Tailwind CSS 4 with `pnpm`.
- [x] Configure strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, `verbatimModuleSyntax: true`), ESLint (`strictTypeChecked` + `jsx-a11y`, `--max-warnings 0`), Vitest (`jsdom` + Testing Library), and Playwright (`chromium` + `@axe-core/playwright`).
- [x] Create `AGENTS.md`, `PRD.md`, `ARCHITECTURE.md`, `TASKS.md`, and `DECISIONS.md`.
- [x] Separate `SourcePlaybackState` (`PlaybackContext.tsx`) from `RecordingSessionState` (`RecordingSessionContext.tsx`).
- [x] Establish typed service contracts in `src/services/interfaces/` (`SourcePlayer`, `CaptureManager`, `SceneCompositor`, `AudioMixer`, `RecordingEngine`, `ExportManager`).
- [x] Build responsive, WCAG 2.1 AA accessible studio shell with local file picker, drag-and-drop, playback transport controls, dual clocks, and honest placeholders.
- [x] Implement two-stage file & browser playback validation and deterministic `ObjectUrlRegistry` cleanup.
- [x] Configure GitHub Pages deployment (`.github/workflows/deploy.yml` + `/ReactStage/` production base path).

---

## Task 2: Webcam and Microphone Capture (COMPLETED)

### Checklist
- [x] Inspect Task 1 codebase, `CaptureManager` interface, `PlaybackContext`, `RecordingSessionContext`, UI components, Object URL cleanup, and tests.
- [x] Refine `CaptureManager` contract (`src/services/interfaces/capture-manager.ts`) and implement `BrowserCaptureManager` (`src/services/capture-manager/browser-capture-manager.ts`):
  - [x] Zero permission or enumeration calls on page load; capture APIs invoked strictly from explicit user actions.
  - [x] Independent camera and microphone lifecycles (start, stop, cancel mid-request, device enumeration, device selection, live device switching).
  - [x] Structured error mapping (`MEDIA_DEVICES_UNSUPPORTED`, `PERMISSION_DENIED`, `DEVICE_NOT_FOUND`, `DEVICE_IN_USE`, `OVERCONSTRAINED`, `TRACK_ENDED_UNEXPECTEDLY`, `ENUMERATION_FAILED`, `CAPTURE_FAILED`).
  - [x] Duplicate concurrent request deduplication, per-channel monotonic race tokens (`cameraOpId`, `microphoneOpId`) stopping superseded/cancelled late streams, unexpected `MediaStreamTrack` `'ended'` recovery, and deterministic `track.stop()` disposal.
  - [x] Strict ownership boundary: `BrowserCaptureManager` owns created tracks; UI components and meter borrow `MediaStream` references read-only.
- [x] Replace webcam placeholder with `WebcamCapturePanel` (`src/components/WebcamCapturePanel.tsx`) and `MicrophoneCapturePanel` (`src/components/MicrophoneCapturePanel.tsx`) + `MicrophoneLevelMeter` (`src/services/capture-manager/microphone-level-meter.ts`) with zero connection to `AudioContext.destination`.
- [x] Verify responsive creator setup controls and synthetic hardware E2E coverage across Chromium.

---

## Task 3: Live Scene Compositor (COMPLETED)

### Checklist
- [x] Inspect Task 1 & Task 2 services (`HtmlVideoSourcePlayer`, `SourcePlaybackProvider`, `BrowserCaptureManager`, `CaptureProvider`), `SceneCompositor` interface, UI hierarchy, lifecycle ownership, and test suites.
- [x] Refine `SceneCompositor` contract (`src/services/interfaces/scene-compositor.ts`) and implement `CanvasSceneCompositor` (`src/services/scene-compositor/canvas-scene-compositor.ts`) + pure normalized geometry (`src/services/scene-compositor/layout-geometry.ts`):
  - [x] Borrow `HTMLVideoElement` read-only without owning or mutating source playback state or revoking Object URLs.
  - [x] Borrow active camera `MediaStream` via an internally managed detached `muted`, `playsInline` `<video>` decoder without ever stopping `CaptureManager`-owned tracks.
  - [x] Render at selectable `1280×720` (`720p`) and `1920×1080` (`1080p`) output dimensions targeting `30fps` with monotonic `loopGeneration` protection against duplicate loops.
  - [x] Report actual canvas dimensions, running state, errors (`CANVAS_CONTEXT_UNAVAILABLE`, `CANVAS_TAINTED`, `RENDER_ERROR`), and throttled (~2Hz) diagnostics truthfully while avoiding 30Hz React re-renders.
  - [x] Guarantee canvas output pixels remain unflipped when `WebcamCapturePanel` toggles CSS-only `-scale-x-100` preview mirroring.
- [x] Implement all four aspect-safe layout modes (`source-only`, `camera-only`, `pip`, `side-by-side`), preview-first `SceneStagePanel` UX, and unit + Chromium E2E suites.

---

## Task 4: Live Audio Mixer (COMPLETED)

### Checklist
- [x] Expand `AudioMixer` contract (`src/services/interfaces/audio-mixer.ts`) and implement `BrowserAudioMixer` (`src/services/audio-mixer/browser-audio-mixer.ts`):
  - [x] Imported source-video audio + borrowed live microphone commentary with independent `0–200%` (`0.0`–`2.0`) gains, mutes, post-gain RMS/peak `AnalyserNode` meters + `CLIP` indication (`peak >= 0.98`), and one stable `MediaStreamAudioDestinationNode` mixed output.
  - [x] Module-level `WeakMap<HTMLMediaElement, BoundMediaElementRecord>` guaranteeing at most **one** `MediaElementAudioSourceNode` per `HTMLMediaElement`, unified `PlaybackControls` volume/mute (`0–200%`), single speaker monitor connection for source video, and **0** mic-to-speaker paths.
- [x] Build `AudioMixerPanel` (`src/components/AudioMixerPanel.tsx`) + `AudioMixerContext` / leaf-isolated `AudioMixerMetersContext` (`src/state/AudioMixerContext.tsx`) and verify with Vitest + real Chromium `4096`-point FFT spectral E2E tests (`tests/e2e/audio-mixer.spec.ts`).

---

## Task 5: Live Recording Engine (COMPLETED)

### Checklist
- [x] Expand `RecordingEngine` contract (`src/services/interfaces/recording-engine.ts`) and implement `BrowserRecordingEngine` (`src/services/recording-engine/browser-recording-engine.ts`) + `O(1)` streaming WebM EBML `Duration` patcher (`src/services/recording-engine/webm-duration.ts`):
  - [x] Codec negotiation across AV (`video/webm;codecs=vp9,opus`, `vp8,opus`, `h264,opus`, `video/webm`, `video/mp4`) and video-only fallbacks.
  - [x] Ephemeral `canvas.captureStream(targetFps)` video track ownership (`stopVideoTracksOnFinalize: true`) while never stopping borrowed `AudioMixer`, `CanvasSceneCompositor`, or `BrowserCaptureManager` tracks.
  - [x] Pause-aware monotonic `performance.now()` session clock (`elapsedRecordingMs`) decoupled from `SourcePlayer` transport + zero-copy `Blob.slice(0, 8192)` EBML `Duration` (`0x4489`) patching.
- [x] Build `RecordingSessionPanel` (`src/components/RecordingSessionPanel.tsx`), live `StudioHeader` `REC` clock pill, and Chromium decoded WebM + FFT E2E verification (`tests/e2e/recording.spec.ts`).

---

## Task 6: Local Synchronized Reaction Export (COMPLETED)

### Checklist
- [x] Expand `ExportManager` contract (`src/services/interfaces/export-manager.ts`) and implement `BrowserExportManager` (`src/services/export-manager/browser-export-manager.ts`):
  - [x] Isolated `ObjectUrlRegistry` managing preview `blob:` URLs independently from `SourcePlayer`.
  - [x] Cross-platform Windows/POSIX filename sanitization (`normalizeDownloadFileName`, `buildSuggestedFileName`), direct local `<a download>` execution reusing the attached `previewUrl`, and deterministic `URL.revokeObjectURL` cleanup.
- [x] Build `ExportProvider` (`src/state/ExportContext.tsx`) and `ExportPanel` (`src/components/ExportPanel.tsx`) and verify with Vitest + Chromium disk download E2E (`tests/e2e/export.spec.ts`).

---

## Task 7: Studio Polish & Creator Ergonomics (COMPLETED)

### Checklist
- [x] **Pre-Roll `3–2–1` Count-In**: Optional `3s Pre-Roll` toggle + `Shift+R` trigger, non-canvas `StagePreRollOverlay` HUD, **Start Now**, and **Cancel (`Esc`)**.
- [x] **Multi-Take Session Drawer**: Ordered in-memory session take catalog (`SessionTakeEntry[]` in `ExportContext`) preserving per-take custom filenames and download counts with `activeObjectUrlCount <= 1`.
- [x] **Global Studio Keyboard Shortcuts & WCAG 2.1.4 Compliance**: Switcher hotkeys (`Space`/`K`, `J`, `1`–`4`, `V`, `M`, `R`, `Shift+R`, `P`, `Esc`, `?`) + focus-trapped `KeyboardShortcutsModal` with WCAG 2.1.4 single-key disable toggle.
- [x] Verified via `tests/unit/studio-polish.test.tsx` and `tests/e2e/studio-polish.spec.ts`.

---

## Task 8: Local Persistence & Creator Presets (COMPLETED)

### Checklist
- [x] **Schema-Validated Local Workspace Store (`StudioPreferencesStore`)**: Versioned `localStorage` persistence (`reactstage.studio-preferences.v1`), 3 built-in starter presets, up to 12 custom creator presets, and **Reset Defaults**.
- [x] **`<StrictMode>`-Safe Auto-Hydration & Zero Startup Hardware Calls (`StudioPreferencesProvider` + `StudioPresetsModal`)**: Restores workspace settings across reloads with `0` unsolicited `getUserMedia` / `enumerateDevices` calls.
- [x] Verified via `tests/unit/studio-preferences.test.tsx` and `tests/e2e/studio-presets.spec.ts`.

---

## Tasks 9 & 10: Live Stage Telestrator, PIP Framing Styles & Recording Chapter Markers (COMPLETED)

### Checklist
- [x] **Task 9 — Live Stage Telestrator & Vanishing Laser Pointer (`CanvasSceneCompositor` + `SceneStagePanel`)**:
  - [x] Normalized `[0..1]` Canvas 2D Telestrator supporting **Pen**, **Arrow**, **Box Highlight**, and **900ms Fading Laser Pointer** across 4 broadcast ink colors (`Coral Red`, `Broadcast Gold`, `Studio Cyan`, `Signal Green`), baked directly into `canvas.captureStream(30)` recordings with zero React re-renders during pointer movement.
  - [x] Undo (`Z` / `Ctrl+Z`), Clear (`C`), and Pen toggle (`D`) hotkeys integrated into `StudioShortcutsContext` and `KeyboardShortcutsModal`.
- [x] **Task 10 — PIP Webcam Framing Styles & Live Recording Chapter Markers**:
  - [x] Canvas 2D clipped PIP shapes (`Rect`, `Rounded`, `Circle` creator bubble) and border accents (`Cyan`, `Gold`, `Green`, `Subtle`, `No Border`), persisted in `StudioPreferencesStore` (`localStorage`).
  - [x] Monotonic session-clock chapter markers (`BrowserRecordingEngine.addChapterMarker`, `B` hotkey + live title form in `RecordingSessionPanel`) frozen onto `RecordedMediaArtifact`, with clickable `<video>` preview seek chips, auto-`00:00 Intro` YouTube chapter formatting, clipboard copy, and local `-chapters.txt` download in `ExportPanel` (`src/utils/chapters.ts`).
- [x] Add `<StrictMode>` unit/integration suite (`tests/unit/telestrator-and-chapters.test.tsx`) and Chromium E2E + `axe-core` suite (`tests/e2e/telestrator-and-chapters.spec.ts`).

### Final Release Verification Results (Tasks 1–10 — Release v1.0.0 Gate)
Executed via `pnpm run check` (`typecheck && lint && test && build && test:e2e`) on Windows (`Node.js` + `pnpm`):

| Check | Command | Result | Actual Output Details |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `pnpm run typecheck` | **PASS** | `tsc -b` exited `0` with `0` errors across app, node configs, unit tests, and Playwright E2E specs. |
| **Lint** | `pnpm run lint` | **PASS** | `eslint . --max-warnings 0` (`strictTypeChecked` + `stylisticTypeChecked` + `jsx-a11y`) exited `0` with `0` errors and `0` warnings. |
| **Unit & Integration Tests** | `pnpm run test` | **PASS** | Vitest `v3.2.7`: **20 passed test suites, 66 passed tests** in `8.97s` (including `telestrator-and-chapters.test.tsx` — 3 tests). |
| **Production Build** | `pnpm run build` | **PASS** | Vite `v6.4.6` (`72 modules transformed`) built in `1.30s` (`dist/index.html` `0.76 kB`, `dist/assets/index-CEa4kooD.css` `39.00 kB` / `7.44 kB` gzip, `dist/assets/index-DQUXHLus.js` `485.25 kB` / `129.26 kB` gzip) targeting `/ReactStage/` base path. |
| **Chromium E2E + A11y** | `pnpm run test:e2e` | **PASS** | Playwright Chromium: **19 passed E2E tests** in `26.2s` (including `telestrator-and-chapters.spec.ts` verifying real Coral Red `#ef4444` `<canvas>` pixel composition, circular PIP framing, live chapter markers, UTF-8 `-chapters.txt` disk download, `0` horizontal overflow at `375px`/`768px`/`1280px`/`1440px`, and `0` WCAG 2.1 AA `axe-core` violations). |
| **Full Composite Gate** | `pnpm run check` | **PASS** | Sequential execution of `typecheck && lint && test && build && test:e2e` exited `0` cleanly. |

---

## Tasks 11–14: Live Screen Share, Smart Voice Auto-Ducking & Mic Clarity, Stage Lower-Thirds & Snapshots, and Offline PWA (COMPLETED)

### Checklist
- [x] **Task 11 — Live Screen / Window / Browser-Tab Source (`HtmlVideoSourcePlayer.startScreenShare` + `BrowserAudioMixer.attachSourceStream`)**:
  - [x] `getDisplayMedia` ingestion (`sourceMode: 'screen'`, `video.muted = true` preventing speaker echo, `Infinity`-duration metadata guard, live freeze-frame `Freeze` / `Resume` for Telestrator drawing, and native `"Stop sharing"` `videoTrack` `'ended'` auto-unload).
  - [x] Dedicated `sourceStreamGainNode` in `BrowserAudioMixer` routing optional captured tab/system audio into `sourceAnalyser` + `masterMixBus` (`0–200%` unified gain, mute, and Auto-Duck) with **zero** paths to `AudioContext.destination`.
- [x] **Task 12 — Smart Voice Auto-Ducking & Broadcast Mic Processing (`BrowserAudioMixer` + `AudioMixerPanel`)**:
  - [x] Zero-tick voice-activated **Auto-Duck Video** (`setAutoDuckEnabled`, dipping source/screen audio toward `28%` / `-11 dB` when creator speech exceeds `AUTO_DUCK_SPEECH_RMS_THRESHOLD` and releasing smoothly when silent) with leaf-isolated `DUCKING` meter pill.
  - [x] Optional **Voice Clarity** (`setMicProcessingEnabled`) inserting an `85 Hz` `BiquadFilterNode` (`highpass`) + `4:1` `DynamicsCompressorNode` vocal limiter upstream of `micGainNode` with zero mic-to-speaker paths.
- [x] **Task 13 — Stage Lower-Thirds & Instant PNG Thumbnail Snapshots (`CanvasSceneCompositor` + `snapshot.ts`)**:
  - [x] On-canvas **Lower-Third** title & subtitle banner (`L` hotkey, persisted in `StudioPreferencesStore`, auto-flipping to bottom-right when PIP occupies bottom-left) + one-click lossless **Snapshot PNG** (`exportCanvasPngSnapshot`) with deterministic `URL.revokeObjectURL` cleanup.
- [x] **Task 14 — Installable Offline Desktop PWA (`manifest.webmanifest` + `sw.js` + `PwaContext`)**:
  - [x] Web App Manifest + `192×192` & `512×512` PNG icons, build-time `offline-manifest.json` Vite plugin, network-first + offline-precache Service Worker (`public/sw.js`), **Install App** (`beforeinstallprompt`), and **Offline Ready** status badge.
- [x] Add `<StrictMode>` unit/integration suite (`tests/unit/broadcast-and-pwa.test.tsx`) and Chromium E2E + `axe-core` + offline-reload suite (`tests/e2e/broadcast-and-pwa.spec.ts`).

### Final Release Verification Results (Tasks 1–14 — Release v1.1.0 Gate)
Executed via `pnpm run check` (`typecheck && lint && test && build && test:e2e`) on Windows (`Node.js` + `pnpm`):

| Check | Command | Result | Actual Output Details |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `pnpm run typecheck` | **PASS** | `tsc -b` exited `0` with `0` errors across app, node configs, unit tests, and Playwright E2E specs. |
| **Lint** | `pnpm run lint` | **PASS** | `eslint . --max-warnings 0` (`strictTypeChecked` + `stylisticTypeChecked` + `jsx-a11y`) exited `0` with `0` errors and `0` warnings. |
| **Unit & Integration Tests** | `pnpm run test` | **PASS** | Vitest `v3.2.7`: **21 passed test suites, 70 passed tests** in `12.29s` (including `broadcast-and-pwa.test.tsx` — 4 tests). |
| **Production Build** | `pnpm run build` | **PASS** | Vite `v6.4.6` (`75 modules transformed`) built in `1.62s` with `0` warnings (`dist/offline-manifest.json` `0.24 kB`, `dist/index.html` `0.92 kB`, `dist/assets/index-B03csGm4.css` `40.35 kB` / `7.60 kB` gzip, `dist/assets/index-jgQJC_Kb.js` `517.02 kB` / `135.32 kB` gzip) targeting `/ReactStage/` base path. |
| **Chromium E2E + A11y + Offline PWA** | `pnpm run test:e2e` | **PASS** | Playwright Chromium: **21 passed E2E tests** in `38.3s` (including `broadcast-and-pwa.spec.ts` verifying live `getDisplayMedia` screen composition, freeze/resume, Lower-Thirds, Auto-Duck & Voice Clarity, valid `0x89504E47` `.png` disk snapshot download, Service Worker offline reload under `context.setOffline(true)`, `0` horizontal overflow at `375px`/`768px`/`1280px`/`1440px`, and `0` WCAG 2.1 AA `axe-core` violations). |
| **Full Composite Gate** | `pnpm run check` | **PASS** | Sequential execution of `typecheck && lint && test && build && test:e2e` exited `0` cleanly. |
