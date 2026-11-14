# AGENTS.md — ReactStage Engineering Handbook

## 1. Mission & Product Ethos
**ReactStage** is a free, open-source, **100% local-first** video reaction studio built for educators, code reviewers, analysts, and commentary creators. Creators import a local video, play/pause/rewind/slow down to explain, frame their webcam presentation across live scene layouts, mix video audio with live microphone commentary, record continuous commentary, and export a synchronized reaction video — with **zero backend servers, zero cloud uploads, zero telemetry, and zero artificial lock-in**.

## 2. Non-Negotiable Architectural Rules
1. **Strict Local-First Privacy**:
   - Never upload, proxy, or transmit user media over the network.
   - Local source videos are ingested exclusively via `File` objects and browser `URL.createObjectURL(file)`.
   - Every created Object URL **must** be tracked by `ObjectUrlRegistry` and deterministically revoked via `URL.revokeObjectURL` on file replacement, decode/validation failure, manual unload, and component unmount.
2. **Decoupled Multi-Clock & Pipeline State Topology**:
   - **Source Playback State** (`SourcePlaybackState` / `SourcePlaybackContext`) owns local source video transport (`status`, `currentTimeSec`, `durationSec`, `playbackRate`, unified `volume` `0–2`, `muted`, `metadata`, `error`).
   - **Capture State** (`CaptureStateSnapshot` / `CaptureContext`) owns independent camera and microphone hardware lifecycles (`BrowserCaptureManager`).
   - **Scene Compositor State** (`CompositorStateSnapshot` / `CompositorContext`) owns live Canvas 2D layout (`source-only`, `camera-only`, `pip`, `side-by-side`), output resolution (`720p` / `1080p`), normalized PIP/split geometry, and independent render-loop state (`CanvasSceneCompositor`).
   - **Audio Mixer State** (`AudioMixerStateSnapshot` / `AudioMixerContext` + `AudioMixerMetersContext`) owns live Web Audio mixing of source video audio and borrowed microphone commentary (`0–200%` independent gains, mutes, post-gain RMS/peak/clipping meters, single source-monitor speaker output, zero mic-to-speaker paths, and one stable `MediaStreamAudioDestinationNode` output via `BrowserAudioMixer`).
   - **Recording Session State** (`RecordingSessionState` / `RecordingSessionContext` + `RecordingTelemetryContext`) owns continuous `MediaRecorder` commentary lifecycle (`status`, monotonic `elapsedRecordingMs`, `recordedBytes`, `chunkCount`, `lastArtifact` via `BrowserRecordingEngine`).
   - **Export State** (`ExportStateSnapshot` / `ExportContext`) owns instant local playback preview URLs, sanitized filename normalization, local browser download execution, and deterministic preview `ObjectUrlRegistry` cleanup (`BrowserExportManager`).
   - Never derive recording duration from `video.currentTime`, never stop camera/mic tracks or recreate the mixer destination when manipulating source media or stopping a recording, and never route live microphone audio to `AudioContext.destination`.
3. **Authentic Local Controls (Zero Fake UI)**:
   - Never ship mock/fake buttons that pretend to record or export dummy files; every studio panel is backed by verified Web API implementations across all six services.
4. **Six Core Service Contracts**:
   - All media operations cross explicit TypeScript interfaces under `src/services/interfaces/`:
     - `SourcePlayer` (Milestone 1 — Implemented via `HtmlVideoSourcePlayer`)
     - `CaptureManager` (Milestone 2 — Implemented via `BrowserCaptureManager`)
     - `SceneCompositor` (Milestone 3 — Implemented via `CanvasSceneCompositor`)
     - `AudioMixer` (Milestone 4 — Implemented via `BrowserAudioMixer`)
     - `RecordingEngine` (Milestone 5 — Implemented via `BrowserRecordingEngine`)
     - `ExportManager` (Milestone 6 — Implemented via `BrowserExportManager`)

## 3. Package Management & Tooling Conventions
- **Package Manager**: Always use `pnpm` (`pnpm install --prefer-offline`, `pnpm add`, `pnpm run`). Do not commit `package-lock.json` or `yarn.lock`.
- **Strict TypeScript**: `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, `verbatimModuleSyntax: true`. Zero `any` escapes in production code.
- **Accessibility First**: Every control must have an explicit accessible name (`<label>` or `aria-label`), visible keyboard `:focus-visible` indicator, WCAG 2.1 AA contrast (>= 4.5:1 for text), and `role="alert"` diagnostics for media errors. Automated `@axe-core/playwright` checks gate every E2E run.
- **GitHub Pages Base Path**: Production builds target `/ReactStage/` by default and honor `VITE_BASE_PATH` in CI. Always reference static public assets via relative paths (`./favicon.svg`) or `import.meta.env.BASE_URL`.

## 4. Required Verification Gate Before Completing Any Task
Every milestone or pull request must pass all five checks cleanly (`pnpm run check`):
```bash
pnpm run typecheck   # tsc -b across app, node configs, unit & E2E tests
pnpm run lint        # eslint . --max-warnings 0 (strictTypeChecked + jsx-a11y)
pnpm run test        # vitest run (unit + component + memory cleanup suites)
pnpm run build       # tsc -b && vite build (production bundle with GitHub Pages base path)
pnpm run test:e2e    # playwright test (Chromium E2E + axe-core WCAG 2.1 AA audit)
```
