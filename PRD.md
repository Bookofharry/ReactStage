# PRD.md — Product Requirements Document: ReactStage

## 1. Product Overview
**Product Name**: ReactStage  
**License**: MIT (Free & Open-Source)  
**Deployment Model**: Static client-side web application hosted on GitHub Pages (`/ReactStage/`), executing 100% locally in modern desktop and mobile browsers.

### Vision
Creators, educators, coaches, and technical reviewers frequently record video reactions where they load a local clip, watch a segment, **pause to break down a concept**, **rewind 10 seconds to replay a subtle detail at 0.5x speed**, adjust webcam framing, balance video audio against live commentary, and export a single synchronized video. Traditional screen recorders capture noisy desktop chrome or fail to mix system audio cleanly, while cloud studios force multi-gigabyte uploads, privacy trade-offs, and subscription paywalls.

**ReactStage** solves this as a purpose-built, zero-upload browser reaction studio with strict separation between the **Source Video Clock**, **Live Scene Composition**, **Live Audio Mixing**, and the **Commentary Recording Clock**.

---

## 2. Target Personas
1. **Technical Educators & Code/Design Reviewers**: Load a student's demo video, pause frequently to explain architectural trade-offs on camera in Picture-in-Picture or Side-by-Side Split mode, rewind key transitions, and hand back a single reaction recording.
2. **Commentary & Analysis Creators**: React to trailers, talks, or gameplay clips stored locally without uploading unreleased footage to third-party servers.
3. **Sports / Performance Coaches**: Step through athlete footage at `0.5x`–`0.75x` playback speed while presenting live visual and spoken coaching feedback.

---

## 3. Core Product Principles
- **Local-First by Architecture**: Source videos never leave the user's device. Ingestion uses local `File` handles + `URL.createObjectURL` with immediate `URL.revokeObjectURL` cleanup.
- **Pause-to-Explain Native**: Pausing, seeking, or slowing down the source video holds its frame cleanly on the composed scene and silences only the source audio channel while the creator's webcam and live microphone continue uninterrupted.
- **Preview-First & Echo-Free Audio Clarity**: One dominant live composed `<canvas>` stage paired with a compact two-channel (`Video Audio` + `Microphone`) post-gain Web Audio mixer that monitors source video to speakers once and never routes live microphone audio to speakers.
- **Zero Fake UI**: Every visible control performs real media work. Upcoming pipeline stages render transparent placeholders until their underlying Web APIs are wired and verified.
- **Accessible Broadcast Ergonomics**: High-contrast dark studio theme (WCAG 2.1 AA), full keyboard and touch operability, tabular-numeral dual clocks, and responsive layouts across `375px`, `768px`, `1280px`, and `1440px`.

---

## 4. Milestone Roadmap & Scope

### Milestone 1 (Task 1 — Completed)
- **Studio Shell & Local Source Player (`HtmlVideoSourcePlayer`)**:
  - Local file picker + drag-and-drop with two-stage validation and deterministic `ObjectUrlRegistry` cleanup.
  - Play/Pause, Seek scrubber, `-10s` Rewind, Restart `0:00`, Playback Speed `0.5x`–`2x`, Volume/Mute, and separate Source vs. Recording timecodes.
  - Service contracts established (`SourcePlayer`, `CaptureManager`, `SceneCompositor`, `AudioMixer`, `RecordingEngine`, `ExportManager`) and GitHub Pages `/ReactStage/` deployment configured.

### Milestone 2 (Task 2 — Completed)
- **Creator Capture Setup (`BrowserCaptureManager` + `MicrophoneLevelMeter`)**:
  - Explicit user-triggered camera and microphone start/stop/cancel with zero unsolicited permission requests on page load.
  - Independent camera and microphone lifecycles, device enumeration, device selection, live device switching, and unexpected track-end recovery.
  - CSS-only self-check preview mirroring and zero-speaker-routing Web Audio setup microphone level meter.

### Milestone 3 (Task 3 — Completed)
- **Live Scene Compositor (`CanvasSceneCompositor` + `SceneStagePanel`)**:
  - Single dominant HTML5 Canvas 2D live scene preview targeting `30fps` at selectable `1280×720` (`720p`) and `1920×1080` (`1080p`) output resolutions.
  - Four aspect-safe layout modes: **Source Only**, **Camera Only**, **Picture-in-Picture** (normalized `[0..1]` pointer/touch/keyboard controls), and **Side-by-Side Split** (`20%`–`80%` split ratio).

### Milestone 4 (Task 4 — Completed)
- **Live Audio Mixer (`BrowserAudioMixer` + `AudioMixerPanel`)**:
  - Web Audio mixing of imported source-video audio (`WeakMap`-guarded single `MediaElementAudioSourceNode`) and live microphone commentary (`MediaStreamAudioSourceNode`) into one persistent `MediaStreamAudioDestinationNode` (`1` mixed audio track).
  - Independent `0–200%` (`0.0`–`2.0`) channel gains and mutes unified with `PlaybackControls`, post-gain RMS/peak meters with `CLIP` indicators, explicit **Enable Audio** autoplay recovery, trackless-video detection (`No Audio Track`), single source-monitor speaker connection, and zero microphone-to-speaker paths.

### Milestone 5 (Task 5 — Completed)
- **Live Recording Engine (`BrowserRecordingEngine` + `RecordingSessionPanel`)**:
  - `MediaRecorder` orchestration over `compositor.getCanvas().captureStream(30)` video + `mixer.getMixedOutputStream()` mixed audio with codec negotiation (`VP9/VP8/H.264 + Opus` WebM / MP4), start, pause, resume, stop & finalize, cancel, and discard take controls.
  - Monotonic pause-aware commentary session clock (`elapsedRecordingMs`) completely independent from `SourcePlayer` transport (pause-to-explain, seek, speed changes, replacement, and unload), plus `O(1)` header-slice streaming WebM EBML `Duration` patching for finite-duration artifacts.

### Milestone 6 (Task 6 — Completed)
- **Local Synchronized Reaction Export (`BrowserExportManager` + `ExportPanel`)**:
  - Instant local `<video>` playback review of finalized WebM/MP4 reaction takes using an isolated `ObjectUrlRegistry` preview URL.
  - Safe cross-platform filename generation (`<source-stem>-reaction-<YYYYMMDD-HHMMSS>.<ext>`), live custom filename editing + sanitization, direct browser `<a download>` saving with zero network activity, and deterministic `URL.revokeObjectURL` cleanup on replacement, discard, and unmount.

### Milestone 7 (Task 7 — Completed)
- **Studio Polish & Creator Ergonomics (`StudioShortcutsContext` + Pre-Roll Countdown + Multi-Take Session Drawer)**:
  - Optional `3–2–1` Pre-Roll countdown (`3s Pre-Roll` toggle + `Shift+R` hotkey) with a non-canvas stage HUD overlay, **Start Now**, and `Esc` cancel.
  - Multi-Take Session Drawer preserving multiple takes in memory with per-take custom filenames, download tracking, and single-active-preview Object URL discipline.
  - Global broadcast keyboard shortcuts (`Space`/`K`, `J`, `1`–`4`, `V`, `M`, `R`, `Shift+R`, `P`, `?`) + accessible reference dialog with WCAG 2.1.4 single-key turn-off control.

### Milestone 8 (Task 8 — Completed)
- **Local Persistence & Creator Presets (`StudioPreferencesStore` + `StudioPresetsModal`)**:
  - Schema-validated `localStorage` workspace persistence (`reactstage.studio-preferences.v1`) automatically saving and restoring layout mode, normalized PIP geometry, split ratio, `720p`/`1080p` resolution, `0–200%` video/mic audio gains & mutes, preview mirror, `3s Pre-Roll`, and WCAG 2.1.4 shortcut toggle across reloads with **zero** unsolicited camera/mic permission calls.
  - Built-in starter presets (**Code & Design Review**, **Podcast / Co-Watch Split**, **Trailer Reaction**) + custom user-saved presets and one-click **Reset Defaults**.

### Milestones 9 & 10 (Tasks 9 & 10 — Completed)
- **Live Stage Telestrator & Laser Pointer (`CanvasSceneCompositor` + `SceneStagePanel`)**:
  - Normalized `[0..1]` Canvas 2D Telestrator (**Pen**, **Arrow**, **Box Highlight**, and **900ms Vanishing Laser Pointer**) across 4 broadcast ink colors, composited directly into recorded reaction videos with `D` / `Z` (`Ctrl+Z`) / `C` hotkeys.
- **PIP Framing Styles & Recording Chapter Markers (`BrowserRecordingEngine` + `ExportPanel`)**:
  - Selectable PIP masks (**Rect**, **Rounded**, **Circle** creator bubble) and border accents persisted in creator presets.
  - Monotonic session-clock chapter markers (`B` hotkey + live title input) with clickable `<video>` preview seek chips, auto-`00:00 Intro` YouTube chapter formatting, clipboard copy, and local `-chapters.txt` export.

### Milestones 11–14 (Tasks 11–14 — Completed)
- **Live Screen / Window / Browser-Tab Source (`HtmlVideoSourcePlayer.startScreenShare` + `BrowserAudioMixer.attachSourceStream`)**:
  - React to live browser tabs, code windows, or desktop screens via `getDisplayMedia`, with optional shared-tab audio mixed cleanly into `MediaStreamAudioDestinationNode` (zero speaker echo), live freeze-frame (`Freeze` / `Resume`) for Telestrator drawing, and graceful native `"Stop sharing"` handling.
- **Smart Voice Auto-Ducking & Broadcast Mic Processing (`BrowserAudioMixer` + `AudioMixerPanel`)**:
  - Optional voice-activated **Auto-Duck Video** smoothly attenuating source/screen audio while the creator speaks, plus optional **Voice Clarity** (`85 Hz` rumble high-pass filter + `4:1` vocal compressor/limiter) on the microphone channel.
- **Stage Lower-Thirds & Instant Thumbnail Snapshot (`CanvasSceneCompositor` + `snapshot.ts`)**:
  - Customizable on-canvas **Lower-Third** title & subtitle banner (`L` hotkey, PIP-collision-aware) and one-click lossless **Snapshot PNG** export.
- **Installable Offline Desktop PWA (`manifest.webmanifest` + `sw.js` + `PwaContext`)**:
  - Standalone desktop Web App Manifest, build-generated `offline-manifest.json` Service Worker precache, header **Install App** prompt trigger, and 100% offline studio reloads.

### Milestones 15–19 (Tasks 15–19 — Completed in `v1.2.0`)
- **Automated CI Quality Gate & Live GitHub Pages Deployment (`.github/workflows/ci.yml` + `deploy.yml`)**:
  - Full `pnpm run check` gate (`tsc -b`, `eslint --max-warnings 0`, Vitest, Vite build, Playwright Chromium E2E + `axe-core`) on PRs and automated GitHub Pages deployment at `https://bookofharry.github.io/ReactStage/`.
- **Vertical Shorts / Reels Mode (`9:16` Portrait Output + `Top / Bottom` Layout)**:
  - `720×1280` (`720p-vertical`) and `1080×1920` (`1080p-vertical`) output presets, `Top / Bottom` vertical split layout (`5` hotkey), `9:16` stage framing, and built-in **Vertical Shorts / Reels (9:16)** preset.
- **Persistent Local IndexedDB Take Vault (`IndexedDbTakeVault`)**:
  - Crash- and reload-resilient local IndexedDB vault (`reactstage-take-vault-v1`, up to 12 takes) preserving recorded WebM/MP4 blobs, chapter markers, and custom filenames across tab refreshes with `<= 1` active preview `ObjectURL` and `0` startup hardware calls.
- **On-Stage Eye-Line Teleprompter HUD (`SceneStagePanel` + `StudioPreferencesStore`)**:
  - Pure-DOM top-center talking-points teleprompter (`T` hotkey, adjustable font size & smooth auto-scroll `1x–5x`) positioned directly below the creator's webcam while remaining 100% invisible in recorded canvas output.
- **In-Studio Trim In/Out & Companion `.wav` Audio Export (`media-trim-and-wav.ts` + `ExportPanel`)**:
  - Non-destructive `Trim In` / `Trim Out` range controls constraining preview playback, exporting trimmed `.webm` clips locally, and extracting spec-compliant `16-bit PCM` RIFF/WAVE `.wav` audio stems for podcast/DAW workflows.

---

## 5. Explicit Non-Goals
- No backend servers, accounts, telemetry, or cloud uploads.
- No cloud AI transcription, external API calls, or server-side transcoding.
- No fake/simulated recording or export buttons prior to real engine implementation.
