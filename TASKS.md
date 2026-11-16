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

---

## Tasks 15–19: GitHub Actions CI & Live GitHub Pages, `9:16` Vertical Shorts Mode, Persistent IndexedDB Take Vault, Eye-Line Teleprompter, and In-Studio Trim / `.wav` Export (COMPLETED)

### Checklist
- [x] **Task 15 — Automated GitHub Actions Quality Gate (`ci.yml`) & Live GitHub Pages Deployment (`deploy.yml`)**:
  - [x] Added `.github/workflows/ci.yml` enforcing `pnpm run check` (`tsc -b`, `eslint --max-warnings 0`, Vitest, Vite build, and Playwright Chromium E2E + WCAG 2.1 AA `axe-core`) on PRs and non-`main` pushes, and aligned `.github/workflows/deploy.yml` on `pnpm 10` + `Node.js 22` (`actions/deploy-pages@v4`).
  - [x] Published `Bookofharry/ReactStage` live to GitHub Pages (`https://bookofharry.github.io/ReactStage/`).
- [x] **Task 16 — Vertical Shorts / Reels Mode (`9:16` Portrait Output + `Top / Bottom` Split Layout)**:
  - [x] Added `'720p-vertical'` (`720×1280`) and `'1080p-vertical'` (`1080×1920`) output resolutions, `'top-bottom'` vertical split layout (`resolveVerticalSplitPanes`, `5` hotkey, `contain` source top + `cover` camera bottom), centered `9:16` stage viewport framing, portrait-proportioned Lower-Third cards, and the built-in `'built-in-shorts'` (`Vertical Shorts / Reels (9:16)`) preset.
- [x] **Task 17 — Persistent Local IndexedDB Take Vault & Crash/Reload Recovery (`IndexedDbTakeVault`)**:
  - [x] Implemented `IndexedDbTakeVault` (`reactstage-take-vault-v1`, FIFO cap `MAX_VAULT_TAKES = 12`) + `InMemoryTakeVault`, hydrating recorded reaction `Blob`s, chapter markers, and custom filenames across browser reloads while holding at most `1` active preview `ObjectURL` and firing `0` unsolicited `getUserMedia` / `enumerateDevices` calls on startup.
- [x] **Task 18 — On-Stage Eye-Line Teleprompter HUD (`SceneStagePanel` + `StudioPreferencesStore`)**:
  - [x] Added pure-DOM `StageTeleprompterConfig` (`T` hotkey, script notes, `sm`/`md`/`lg` font sizes, and `1x–5x` smooth `requestAnimationFrame` auto-scroll, persisted in `localStorage`) positioned at top-center directly below the creator's webcam so `canvas.captureStream(30)` recordings remain 100% free of teleprompter text.
- [x] **Task 19 — In-Studio Trim In/Out & Companion `.wav` Audio Export (`media-trim-and-wav.ts` + `ExportPanel`)**:
  - [x] Added non-destructive `Trim In` / `Trim Out` range controls clamping `<video>` preview playback, local trimmed `.webm` clip saving (`exportTrimmedWebmBlob`), and spec-compliant 44-byte RIFF/WAVE `16-bit PCM` `.wav` audio extraction (`extractCompanionWavBlob`) with `0` speaker bleed (`AudioContext` closed immediately in `finally` with zero connections to `destination`).
- [x] Added `<StrictMode>` unit/integration suite (`tests/unit/shorts-vault-teleprompter-trim.test.tsx`) and Chromium E2E + `axe-core` + reload-recovery suite (`tests/e2e/shorts-vault-teleprompter-trim.spec.ts`).

### Final Release Verification Results (Tasks 1–19 — Release v1.2.0 Gate)
Executed via `pnpm run check` (`typecheck && lint && test && build && test:e2e`) on Windows (`Node.js` + `pnpm`):

| Check | Command | Result | Actual Output Details |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `pnpm run typecheck` | **PASS** | `tsc -b` exited `0` with `0` errors across app, node configs, unit tests, and Playwright E2E specs. |
| **Lint** | `pnpm run lint` | **PASS** | `eslint . --max-warnings 0` (`strictTypeChecked` + `stylisticTypeChecked` + `jsx-a11y`) exited `0` with `0` errors and `0` warnings. |
| **Unit & Integration Tests** | `pnpm run test` | **PASS** | Vitest `v3.2.7`: **22 passed test suites, 73 passed tests** in `14.45s` (including `shorts-vault-teleprompter-trim.test.tsx` — 3 tests). |
| **Production Build** | `pnpm run build` | **PASS** | Vite `v6.4.6` (`78 modules transformed`) built in `1.39s` with `0` warnings (`dist/offline-manifest.json` `0.24 kB`, `dist/index.html` `0.92 kB`, `dist/assets/index-9ID1Wqty.css` `42.12 kB` / `7.89 kB` gzip, `dist/assets/index-Bskep78r.js` `547.40 kB` / `142.44 kB` gzip) targeting `/ReactStage/` base path. |
| **Chromium E2E + A11y + Vault Reload** | `pnpm run test:e2e` | **PASS** | Playwright Chromium: **22 passed E2E tests** in `56.3s` (including `shorts-vault-teleprompter-trim.spec.ts` verifying `720×1280` `9:16` Shorts recording, non-recorded Teleprompter HUD, RIFF/WAVE `.wav` header bytes, IndexedDB reload persistence with `0` unsolicited media calls, `0` horizontal overflow at `375px`/`768px`/`1280px`/`1440px`, and `0` WCAG 2.1 AA `axe-core` violations). |
| **Full Composite Gate** | `pnpm run check` | **PASS** | Sequential execution of `typecheck && lint && test && build && test:e2e` exited `0` cleanly. |

---

## Task 20: 15-Viewport Fluid Mobile/Tablet/Desktop Responsiveness & Touch Ergonomics (COMPLETED)

### Checklist
- [x] **Viewport Stability & Coarse-Pointer Ergonomics (`src/index.css` & `src/App.tsx`)**:
  - [x] Enforced `overflow-x: clip`, `min-h-dvh`, `-webkit-text-size-adjust: 100%`, `touch-action: manipulation`, `@media (pointer: coarse)` enlarged range-slider hit targets, and a fluid `max-w-[96rem]` shell with proportional padding/gaps from `320px` through `1920px`.
- [x] **Zero Clipped Text, Fluid Typography & Touch Targets Across All Studio Panels**:
  - [x] Eliminated every single `truncate` text-clipping rule across `StudioHeader`, `SceneStagePanel`, `PlaybackControls`, `AudioMixerPanel`, `WebcamCapturePanel`, `MicrophoneCapturePanel`, `RecordingSessionPanel`, `ExportPanel`, `StudioPresetsModal`, and `KeyboardShortcutsModal`, replacing fixed slider widths with flexible `min-w-[...] flex-1` tracks, fluid `clamp()` headings/clocks, and `min-h-9`–`min-h-11` interactive touch targets.
  - [x] Docked `teleprompter-stage-overlay` cleanly at the top eye-line above `source-dropzone`, rendered `pip-drag-handle` as a compact `MoveQuadArrowsIcon` badge on `< 768px` (or `< 24%` PIP width) with screen-reader-preserved `"Move PIP"` text so `pip-drag-handle` and `pip-resize-handle` never collide even at `320px` + `16%` PIP, and added responsive `min-h-[14.5rem] sm:min-h-0` mobile stage clearance when onboarding, error, or 3-second pre-roll overlays are active.
- [x] **15-Viewport Automated Playwright Verification (`tests/e2e/mobile-responsiveness.spec.ts`)**:
  - [x] Verified `320px`, `360px`, `375px`, `390px`, `414px`, `430px`, `480px`, `640px`, `768px`, `820px`, `1024px`, `1280px`, `1440px`, `1536px`, and `1920px` across empty onboarding, loaded active studio + `16%` PIP + Teleprompter + Lower-Third + recorded take + Trim/WAV export, `9:16` Vertical Shorts + Top/Bottom Split, mobile/desktop Presets & Shortcuts modals, and WCAG 2.1 AA `axe-core` scans.

### Final Release Verification Results (Tasks 1–20 — Release v1.3.0 Gate)
Executed via `pnpm run check` (`typecheck && lint && test && build && test:e2e`) on Windows (`Node.js` + `pnpm`):

| Check | Command | Result | Actual Output Details |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `pnpm run typecheck` | **PASS** | `tsc -b` exited `0` with `0` errors across app, node configs, unit tests, and Playwright E2E specs. |
| **Lint** | `pnpm run lint` | **PASS** | `eslint . --max-warnings 0` (`strictTypeChecked` + `stylisticTypeChecked` + `jsx-a11y`) exited `0` with `0` errors and `0` warnings. |
| **Unit & Integration Tests** | `pnpm run test` | **PASS** | Vitest `v3.2.7`: **22 passed test suites, 73 passed tests** with `0` regressions. |
| **Production Build** | `pnpm run build` | **PASS** | Vite `v6.4.6` (`78 modules transformed`) built in `2.13s` with `0` warnings (`dist/offline-manifest.json` `0.24 kB`, `dist/index.html` `0.92 kB`, `dist/assets/index-DjCSujcq.css` `46.76 kB` / `8.59 kB` gzip, `dist/assets/index-YmKVadyB.js` `554.39 kB` / `143.60 kB` gzip) targeting `/ReactStage/` base path. |
| **Chromium E2E + 15-Viewport Audit + A11y** | `pnpm run test:e2e` | **PASS** | Playwright Chromium: **23 passed E2E tests** in `1.1m` (including `mobile-responsiveness.spec.ts` verifying all 15 widths from `320px` to `1920px` with `0` horizontal overflow, `0` clipped buttons, `0` overlapping handles/HUDs, intact media scaling, and `0` WCAG 2.1 AA `axe-core` violations). |
| **Full Composite Gate** | `pnpm run check` | **PASS** | Sequential execution of `typecheck && lint && test && build && test:e2e` exited `0` cleanly. |

---

## Task 21: Creator-First Interface, Unified Bottom Control Dock, 3-Step Onboarding & Tabbed Workspace Drawer (`v1.4.0`) (COMPLETED)

### Checklist
- [x] **Clean Cinema Stage & Unified Bottom Control Dock (`src/App.tsx`, `SceneStagePanel.tsx`, `PlaybackControls.tsx`, `RecordingSessionPanel.tsx`)**:
  - [x] Focused the primary `lg:col-span-8` workspace on `SceneStagePanel` + dark-glass `PlaybackControls` + unified bottom `RecordingSessionPanel` dock featuring 1-click `Cam On/Off` (`dock-camera-button`) and `Mic On/Off` (`dock-mic-button`) pills, glowing `Start Recording` CTA, `3s Count-In`, single session clock, inline `Chapter Bookmarks`, and `Preview & Download` take jump.
- [x] **3-Tab Glass Workspace Drawer & Auto-Focus on Completed Takes (`StudioUiContext.tsx`, `StudioWorkspaceDrawer.tsx`)**:
  - [x] Consolidated `WebcamCapturePanel`, `MicrophoneCapturePanel`, `AudioMixerPanel`, and `ExportPanel` into a sleek 3-tab right-hand glass drawer (`Devices`, `Audio`, `Takes`) with live status/count badges, top-level autoplay `Enable Audio` prompt, and automatic switch to `Takes` whenever a recording completes or hydrates from `IndexedDbTakeVault`.
- [x] **3-Step On-Stage Onboarding Checklist & Progressive Disclosure**:
  - [x] Added a friendly 3-step quick-start checklist right on the empty stage (`1. Add a video or share your screen`, `2. Check camera & mic` with inline 1-click toggles, `3. Press Start Recording below`), removed engineering jargon (`Chunks`, `Object URL revoked`, `100%` unity labels), kept `File name` + `Download Video` + `Auto-Duck Video` + `Voice Clarity` 1-click up front, and tucked advanced controls (`Customize` PIP/Split framing, `Draw` Telestrator palette, per-channel VU meters, `Trim Clip & Save Audio (.wav)`) behind clean disclosure toggles.
- [x] **Dedicated Unit & Full 15-Viewport E2E + Accessibility Verification (`creator-ux-workspace.test.tsx` & Playwright Suite)**:
  - [x] Added `<StrictMode>` unit/integration coverage in `tests/unit/creator-ux-workspace.test.tsx` and verified zero horizontal overflow, zero clipped text, zero element overlap, and zero WCAG 2.1 AA `axe-core` violations across all 15 standard device viewports (`320px`–`1920px`).

### Final Release Verification Results (Tasks 1–21 — Release v1.4.0 Gate)
Executed via `pnpm run check` (`typecheck && lint && test && build && test:e2e`) on Windows (`Node.js` + `pnpm`):

| Check | Command | Result | Actual Output Details |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `pnpm run typecheck` | **PASS** | `tsc -b` exited `0` with `0` errors across app, node configs, unit tests, and Playwright E2E specs. |
| **Lint** | `pnpm run lint` | **PASS** | `eslint . --max-warnings 0` (`strictTypeChecked` + `stylisticTypeChecked` + `jsx-a11y`) exited `0` with `0` errors and `0` warnings. |
| **Unit & Integration Tests** | `pnpm run test` | **PASS** | Vitest `v3.2.7`: **23 passed test suites, 74 passed tests** in `14.91s` (including `creator-ux-workspace.test.tsx`). |
| **Production Build** | `pnpm run build` | **PASS** | Vite `v6.4.6` (`80 modules transformed`) built in `1.65s` with `0` warnings (`dist/offline-manifest.json` `0.24 kB`, `dist/index.html` `0.92 kB`, `dist/assets/index-CSkxMKV4.css` `55.64 kB` / `9.87 kB` gzip, `dist/assets/index-CZW3mGos.js` `564.07 kB` / `144.63 kB` gzip) targeting `/ReactStage/` base path. |
| **Chromium E2E + 15-Viewport Audit + A11y** | `pnpm run test:e2e` | **PASS** | Playwright Chromium: **23 passed E2E tests** in `58.5s` (including `mobile-responsiveness.spec.ts` verifying all 15 widths from `320px` to `1920px` with `0` horizontal overflow, `0` clipped buttons, `0` overlapping handles/HUDs, intact media scaling, and `0` WCAG 2.1 AA `axe-core` violations). |
| **Full Composite Gate** | `pnpm run check` | **PASS** | Sequential execution of `typecheck && lint && test && build && test:e2e` exited `0` cleanly. |

---

## Task 22: Mild & Easy Interface Simplification & `StudioSettingsModal` (`v1.5.0`) (COMPLETED)

### Checklist
- [x] **Unified `StudioSettingsModal` Packing Extra Tools & Preferences (`src/components/StudioSettingsModal.tsx`, `StudioUiContext.tsx`)**:
  - [x] Packed `Format` (`720p`/`1080p`/Shorts), extra layouts (`Video Only` / `Cam Only`), PIP/Split fine-tuning (`Corner`, `Shape`, `Border`, `Size`, `Split Balance`), `Draw on Video`, `Title Banner`, `Speaker Notes`, `Save PNG Frame`, `3-Second Count-In`, `Pause/Resume Stage`, `Saved Presets`, and `Keyboard Shortcuts` into one clean, calm modal (`open-settings-modal-button` / `open-stage-tools-button`).
- [x] **Mild Stage, Simpler Always-Visible Video Player & Slim Side Panel**:
  - [x] Reduced the stage top bar to a single calm row (`PIP` · `Split` · `Shorts` + `More Tools`), replaced the multi-box stage checklist with one friendly `"Add a video to react to"` card (`Choose Video` / `Share Screen`), streamlined the fixed single-row navbar (`ReactStage` + `Settings & Tools`), simplified `PlaybackControls` and `RecordingSessionPanel` (`Cam` · `Mic` · `Start Recording`), and collapsed idle camera/mic placeholders in the slim `xl:col-span-3` side panel.
- [x] **15-Viewport & WCAG 2.1 AA Verification**:
  - [x] Verified `StudioSettingsModal`, `StudioPresetsModal`, `KeyboardShortcutsModal`, and the mild workspace across all 15 widths (`320px`–`1920px`) with `0` horizontal overflow, `0` clipped labels, `0` overlaps, and `0` `axe-core` violations.

### Final Release Verification Results (Tasks 1–22 — Release v1.5.0 Gate)
Executed via `pnpm run check` (`typecheck && lint && test && build && test:e2e`) on Windows (`Node.js` + `pnpm`):

| Check | Command | Result | Actual Output Details |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `pnpm run typecheck` | **PASS** | `tsc -b` exited `0` with `0` errors across app, node configs, unit tests, and Playwright E2E specs. |
| **Lint** | `pnpm run lint` | **PASS** | `eslint . --max-warnings 0` (`strictTypeChecked` + `stylisticTypeChecked` + `jsx-a11y`) exited `0` with `0` errors and `0` warnings. |
| **Unit & Integration Tests** | `pnpm run test` | **PASS** | Vitest `v3.2.7`: **23 passed test suites, 74 passed tests** in `12.34s`. |
| **Production Build** | `pnpm run build` | **PASS** | Vite `v6.4.6` (`81 modules transformed`) built in `1.32s` with `0` warnings (`dist/offline-manifest.json` `0.24 kB`, `dist/index.html` `0.92 kB`, `dist/assets/index-DE37xtmG.css` `51.10 kB` / `9.34 kB` gzip, `dist/assets/index-rrbgeahm.js` `562.20 kB` / `144.53 kB` gzip) targeting `/ReactStage/` base path. |
| **Chromium E2E + 15-Viewport Audit + A11y** | `pnpm run test:e2e` | **PASS** | Playwright Chromium: **23 passed E2E tests** in `51.6s` across all 15 widths (`320px`–`1920px`) with `0` WCAG 2.1 AA `axe-core` violations. |
| **Full Composite Gate** | `pnpm run check` | **PASS** | Sequential execution of `typecheck && lint && test && build && test:e2e` exited `0` cleanly. |

---

## Task 23: Zero-Stress Mobile Video Experience & Basic Mobile Controls (`v1.6.0`) (COMPLETED)

### Checklist
- [x] **Tap-to-Play Stage, 1-Tap `9:16` Shorts & Clean Mobile Video Picker (`SceneStagePanel.tsx`)**:
  - [x] Enabled tap-to-play/pause directly on `<canvas>` with a mobile `Tap to Play` pill when paused, automatic `9:16` (`720p-vertical`/`1080p-vertical`) <-> `16:9` aspect switching when tapping `Shorts` vs `PIP`/`Split`, and a full-width mobile `Choose Video` button (hiding desktop `Share Screen` & byte-size clutter on `< sm`).
- [x] **Single-Row Basic Mobile Video Controls (`PlaybackControls.tsx`)**:
  - [x] Simplified the mobile `< sm` player to a finger-friendly scrubber plus one horizontal thumb row (`Play/Pause` · `-10s` · `Mute` with `min-h-11` touch targets), keeping `Restart`, `Speed`, and the volume slider cleanly reserved for `sm:` (`>= 640px`).
- [x] **1-Tap Front/Back Camera Flip, Single-Screen Mobile Layout & Instant Save / Share (`CaptureContext.tsx`, `RecordingSessionPanel.tsx`, `StudioWorkspaceDrawer.tsx`)**:
  - [x] Added `flipCamera()` (`facingMode: 'user' | 'environment'` + multi-device cycle) with a 1-tap `Flip` button beside `Cam On`, collapsed `StudioWorkspaceDrawer` on `< lg` behind a 1-tap `Camera, Audio & Saved Videos` bar so 100% of the studio fits on one phone screen without scrolling, and added direct 1-tap `Save Video` (`dock-save-video-button`) + native mobile Web Share (`dock-share-video-button`) right in the Record Bar when a recording finishes.

### Final Release Verification Results (Tasks 1–23 — Release v1.6.0 Gate)
Executed via `pnpm run check` (`typecheck && lint && test && build && test:e2e`) on Windows (`Node.js` + `pnpm`):

| Check | Command | Result | Actual Output Details |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `pnpm run typecheck` | **PASS** | `tsc -b` exited `0` with `0` errors across app, node configs, unit tests, and Playwright E2E specs. |
| **Lint** | `pnpm run lint` | **PASS** | `eslint . --max-warnings 0` (`strictTypeChecked` + `stylisticTypeChecked` + `jsx-a11y`) exited `0` with `0` errors and `0` warnings. |
| **Unit & Integration Tests** | `pnpm run test` | **PASS** | Vitest `v3.2.7`: **23 passed test suites, 74 passed tests** in `22.84s`. |
| **Production Build** | `pnpm run build` | **PASS** | Vite `v6.4.6` (`81 modules transformed`) built in `7.53s` with `0` warnings (`dist/offline-manifest.json` `0.24 kB`, `dist/index.html` `0.92 kB`, `dist/assets/index-CgOaMAr6.css` `52.34 kB` / `9.49 kB` gzip, `dist/assets/index-N9S4TQbF.js` `567.21 kB` / `145.82 kB` gzip) targeting `/ReactStage/` base path. |
| **Chromium E2E + 15-Viewport Audit + A11y** | `pnpm run test:e2e` | **PASS** | Playwright Chromium: **23 passed E2E tests** in `1.6m` across all 15 widths (`320px`–`1920px`) with `0` WCAG 2.1 AA `axe-core` violations. |
| **Full Composite Gate** | `pnpm run check` | **PASS** | Sequential execution of `typecheck && lint && test && build && test:e2e` exited `0` cleanly. |
