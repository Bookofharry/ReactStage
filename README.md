# ReactStage

**Free, open-source, 100% local-first video reaction studio.**

- **Live Studio (GitHub Pages)**: https://bookofharry.github.io/ReactStage/
- **Repository**: https://github.com/Bookofharry/ReactStage

ReactStage lets creators import a local video (or share a live screen/tab), watch and pause to explain, rewind or slow down key moments, frame their live webcam across five real-time Canvas 2D scene layouts (`Picture-in-Picture`, `Side-by-Side Split`, `Top / Bottom Shorts`, `Source Only`, `Camera Only`) in `16:9` (`720p`/`1080p`) or `9:16` vertical Shorts (`720×1280`/`1080×1920`), read talking points from a non-recorded eye-line teleprompter, balance imported video audio (`0–200%` + Auto-Duck) against live microphone commentary (`0–200%` + Voice Clarity) through a real-time Web Audio mixer, record synchronized takes persisted in a local IndexedDB vault, and instantly trim and download `.webm`/`.mp4` videos, `.wav` audio stems, `.png` thumbnails, and YouTube `.txt` chapters — with **zero backend servers and zero cloud uploads**.

## Current Status: Tasks 1–19 Completed (v1.2.0 Full Local-First Broadcast, Vertical Shorts, Vault & Offline PWA Studio)
- **Local Video & Live Screen/Tab Ingestion (Tasks 1 & 11)**: File picker + drag-and-drop onto stage using zero-copy browser `ObjectURL`s with deterministic `URL.revokeObjectURL` cleanup, plus **Share Screen / Tab** (`getDisplayMedia`) with echo-free shared-tab audio mixing and live freeze-frame (`Freeze` / `Resume`); play, pause, seek scrubber, `Rewind 10s`, `Restart`, playback speed (`0.5x`–`2x`), and unified `0–200%` volume/mute.
- **Webcam & Microphone Capture Setup (Task 2)**:
  - Explicit user-action camera and microphone start/stop/cancel (zero permission requests on page load).
  - Independent camera and microphone lifecycles, device enumeration, source selection, live device switching, and unexpected track termination recovery (`BrowserCaptureManager`).
  - Compact self-check webcam thumbnail with CSS-only preview mirroring and pre-fader setup microphone input meter (`MicrophoneLevelMeter`).
- **Live Scene Compositor (Task 3)**:
  - Single dominant HTML5 Canvas 2D preview stage (`CanvasSceneCompositor` + `SceneStagePanel`) rendering at selectable `1280×720` (`720p`) and `1920×1080` (`1080p`) output resolutions targeting `30fps`.
  - Four aspect-safe layout modes: **Picture-in-Picture**, **Side-by-Side Split**, **Source Only**, and **Camera Only**, with full pause-to-explain source playback independence.
- **Live Audio Mixer (Task 4)**:
  - Compact two-channel Web Audio mixer (`BrowserAudioMixer` + `AudioMixerPanel`) combining imported video audio and live microphone commentary into one stable `MediaStreamAudioDestinationNode` (`1` audio track).
  - Independent `0–200%` gain sliders + mute toggles unified with `PlaybackControls` (holding `<video>` at unity so sliders never double-attenuate), post-gain RMS/peak meters + `CLIP` indicators, explicit **Enable Audio** autoplay-suspension recovery, `No Audio Track` detection for silent containers, single speaker monitor path for source video, and **zero** microphone-to-speaker paths.
- **Live Recording Engine (Task 5)**:
  - Synchronized local `MediaRecorder` engine (`BrowserRecordingEngine` + `RecordingSessionPanel`) recording `compositor.getCanvas().captureStream(30)` video + `mixer.getMixedOutputStream()` mixed audio with start, pause, resume, stop & finalize, cancel, and discard take controls.
  - Monotonic pause-aware commentary session clock (`elapsedRecordingMs`) completely decoupled from source video transport, ephemeral canvas track cleanup that leaves live camera/mic/scene/mixer untouched, and `O(1)` streaming WebM EBML `Duration` patching.
- **Synchronized Local Export (Task 6)**:
  - Instant on-device `<video>` playback review (`BrowserExportManager` + `ExportPanel`), cross-platform custom filename editing & sanitization, direct browser download, and deterministic `ObjectUrlRegistry` preview URL revocation on replacement, discard, and unmount.
- **Studio Polish & Creator Ergonomics (Task 7)**:
  - Optional `3–2–1` Pre-Roll countdown (`3s Pre-Roll` toggle & `Shift+R` hotkey) with a non-canvas stage HUD overlay, **Start Now**, and `Esc` cancel.
  - **Multi-Take Session Drawer** keeping multiple recorded takes accessible for comparison, per-take custom filename editing, and download while holding at most `1` active preview `blob:` Object URL.
  - **Global Studio Keyboard Shortcuts** (`Space`/`K`, `J`, `1`–`4`, `V`, `M`, `R`, `Shift+R`, `P`, `?`) with an accessible shortcuts modal and WCAG 2.1.4 single-key disable toggle.
- **Local Persistence & Creator Presets (Task 8)**:
  - Automatic schema-validated `localStorage` persistence (`StudioPreferencesStore`) saving and restoring scene layout, PIP geometry, split ratio, `720p`/`1080p` resolution, `0–200%` video/mic gains & mutes, preview mirror, `3s Pre-Roll`, and WCAG 2.1.4 shortcut state across reloads with **zero** unsolicited camera/mic permission calls.
  - Accessible **Creator Presets** dialog (`StudioPresetsModal`) with 3 built-in starter presets, up to 12 custom user-saved presets, and one-click **Reset Defaults**.
- **Live Stage Telestrator & Laser Pointer (Task 9)**:
  - Normalized `[0..1]` Canvas 2D **Pen**, **Arrow**, **Box Highlight**, and **900ms Vanishing Laser Pointer** (`Coral Red`, `Broadcast Gold`, `Studio Cyan`, `Signal Green`) rendered directly onto the live & recorded scene with `D`, `Z` (`Ctrl+Z`), and `C` hotkeys.
- **PIP Webcam Framing & Recording Chapter Markers (Task 10)**:
  - **Rect**, **Rounded**, and **Circle** creator PIP masks + selectable accent borders persisted across sessions.
  - Live recording chapter markers (`B` hotkey + title input) mapped to the monotonic commentary clock, with one-click `<video>` preview seeking, auto-`00:00 Intro` YouTube chapter copy, and local `-chapters.txt` download.
- **Smart Voice Auto-Ducking & Broadcast Vocal Processing (Task 12)**:
  - Optional voice-activated **Auto-Duck Video** smoothly dipping source/screen audio while speaking, plus **Voice Clarity** (`85 Hz` rumble high-pass filter + `4:1` vocal compressor/limiter) on the microphone channel.
- **Stage Lower-Thirds & Instant PNG Snapshots (Task 13)**:
  - Customizable on-canvas **Lower-Third** headline & subtitle banner (`L` hotkey, PIP-collision-aware) and one-click lossless **Snapshot PNG** thumbnail export.
- **Installable Offline Desktop PWA (Task 14)**:
  - Standalone Web App Manifest (`manifest.webmanifest`), build-generated `offline-manifest.json` Service Worker precache (`sw.js`), **Install App** button, and verified 100% offline studio reloads.
- **Automated GitHub Actions CI & Live GitHub Pages Deployment (Task 15)**:
  - Continuous verification (`ci.yml` running `pnpm run check`) and automated static deployment (`deploy.yml`) to https://bookofharry.github.io/ReactStage/.
- **Vertical Shorts / Reels `9:16` Mode (`720×1280` & `1080×1920`) (Task 16)**:
  - Portrait `9:16` output presets, `Top / Bottom` vertical split layout (`5` hotkey), `9:16` stage framing, and built-in **Vertical Shorts / Reels (9:16)** starter preset.
- **Persistent IndexedDB Take Vault & Crash/Reload Recovery (Task 17)**:
  - Local `IndexedDbTakeVault` (`reactstage-take-vault-v1`, up to 12 takes) restoring recorded reaction blobs, chapter markers, and custom filenames across browser reloads with `<= 1` active preview `ObjectURL` and `0` unsolicited hardware calls.
- **On-Stage Eye-Line Teleprompter HUD (Task 18)**:
  - Pure-DOM talking-points teleprompter (`T` hotkey, adjustable font size & smooth `1x–5x` auto-scroll) kept 100% excluded from `canvas.captureStream(30)` video output.
- **In-Studio Trim In/Out & Companion `.wav` Audio Export (Task 19)**:
  - Non-destructive `Trim In` / `Trim Out` controls, client-side trimmed `.webm` clip saving, and spec-compliant 44-byte RIFF/WAVE `16-bit PCM` `.wav` audio extraction.

## Quick Start

```bash
# Install dependencies
pnpm install --prefer-offline

# Start local development server
pnpm run dev

# Run full verification gate (typecheck + lint + unit tests + build + Chromium E2E)
pnpm run check
```

## Documentation
- [AGENTS.md](./AGENTS.md) — Engineering conventions, strict invariants, and verification gates
- [PRD.md](./PRD.md) — Product vision, personas, milestone scope, and non-goals
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Isolated state/clock topology, Web Audio graph ownership, compositor geometry, and hardware limitations
- [TASKS.md](./TASKS.md) — Milestone checklist and verified Tasks 1–19 test/build metrics
- [DECISIONS.md](./DECISIONS.md) — Architectural Decision Records (ADR-001 through ADR-027)

## License
[MIT](./LICENSE)
