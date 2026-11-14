import { describe, expect, it, vi } from 'vitest';
import { HtmlVideoSourcePlayer } from '../../src/services/source-player/html-video-source-player';
import { ObjectUrlRegistry } from '../../src/services/source-player/object-url-registry';
import { resolveBasePath } from '../../src/utils/base-path';

function configureVideoMetadata(
  video: HTMLVideoElement,
  {
    duration = 90,
    videoWidth = 1920,
    videoHeight = 1080,
  }: { duration?: number; videoWidth?: number; videoHeight?: number } = {},
) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => duration,
  });
  Object.defineProperty(video, 'videoWidth', {
    configurable: true,
    get: () => videoWidth,
  });
  Object.defineProperty(video, 'videoHeight', {
    configurable: true,
    get: () => videoHeight,
  });
}

function setVideoErrorCode(video: HTMLVideoElement, code: number) {
  Object.defineProperty(video, 'error', {
    configurable: true,
    get: () => ({ code, message: `MediaError ${code}` }) as MediaError,
  });
}

describe('HtmlVideoSourcePlayer', () => {
  it('loads a valid video file, reads metadata, and supports play, pause, seek, rewind, speed, and volume', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const registry = new ObjectUrlRegistry();
    const player = new HtmlVideoSourcePlayer({ urlRegistry: registry });
    const video = document.createElement('video');
    player.attachVideoElement(video);

    const file = new File(['valid-video-stream'], 'keynote.webm', {
      type: 'video/webm',
      lastModified: 1700000000000,
    });

    player.loadFile(file);
    expect(player.getState().status).toBe('loading');
    expect(registry.getActiveCount()).toBe(1);

    configureVideoMetadata(video, {
      duration: 120,
      videoWidth: 1280,
      videoHeight: 720,
    });
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(player.getState().status).toBe('ready');
    expect(player.getState().durationSec).toBe(120);
    expect(player.getState().metadata).toMatchObject({
      fileName: 'keynote.webm',
      width: 1280,
      height: 720,
      durationSec: 120,
      mimeType: 'video/webm',
    });

    // Play & Pause
    await player.play();
    expect(player.getState().status).toBe('playing');

    player.pause();
    expect(player.getState().status).toBe('paused');

    // Seek & clamping
    player.seek(45.5);
    expect(player.getState().currentTimeSec).toBe(45.5);
    expect(video.currentTime).toBe(45.5);

    player.seek(999);
    expect(player.getState().currentTimeSec).toBe(120);

    // Rewind 10s & clamp at 0
    player.seek(25);
    player.rewind(10);
    expect(player.getState().currentTimeSec).toBe(15);

    player.rewind(30);
    expect(player.getState().currentTimeSec).toBe(0);

    // Restart
    player.seek(80);
    player.restart();
    expect(player.getState().currentTimeSec).toBe(0);

    // Playback speed
    player.setPlaybackRate(1.5);
    expect(player.getState().playbackRate).toBe(1.5);
    expect(video.playbackRate).toBe(1.5);

    // Volume & mute (including auto-unmute on positive volume slider change)
    player.setVolume(0.35);
    expect(player.getState().volume).toBe(0.35);
    expect(video.volume).toBe(0.35);

    player.toggleMute();
    expect(player.getState().muted).toBe(true);
    expect(video.muted).toBe(true);

    player.setVolume(0.6);
    expect(player.getState().volume).toBe(0.6);
    expect(player.getState().muted).toBe(false);

    // Cleanup
    player.dispose();
    expect(registry.getActiveCount()).toBe(0);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('replaces an existing video safely and revokes the previous Object URL immediately', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const registry = new ObjectUrlRegistry();
    const player = new HtmlVideoSourcePlayer({ urlRegistry: registry });
    const video = document.createElement('video');
    player.attachVideoElement(video);

    player.loadFile(
      new File(['first-video'], 'first.mp4', { type: 'video/mp4' }),
    );
    const firstUrl = player.getState().objectUrl;
    configureVideoMetadata(video, { duration: 60 });
    video.dispatchEvent(new Event('loadedmetadata'));
    player.seek(30);
    player.setPlaybackRate(1.25);

    player.loadFile(
      new File(['second-video'], 'second.webm', { type: 'video/webm' }),
    );
    const secondUrl = player.getState().objectUrl;

    expect(secondUrl).not.toBe(firstUrl);
    expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
    expect(registry.getActiveCount()).toBe(1);
    expect(player.getState().currentTimeSec).toBe(0);

    configureVideoMetadata(video, { duration: 45 });
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(player.getState().status).toBe('ready');
    expect(player.getState().metadata?.fileName).toBe('second.webm');
    expect(video.playbackRate).toBe(1.25);
  });

  it('revokes Object URLs and reports structured errors on decode error, audio-only container, or unsupported replacement', () => {
    const registry = new ObjectUrlRegistry();
    const player = new HtmlVideoSourcePlayer({ urlRegistry: registry });
    const video = document.createElement('video');
    player.attachVideoElement(video);

    // 1. Corrupt container triggering HTMLMediaElement error code 4
    player.loadFile(
      new File(['corrupt-bytes'], 'corrupt.mp4', { type: 'video/mp4' }),
    );
    expect(registry.getActiveCount()).toBe(1);
    setVideoErrorCode(video, 4);
    video.dispatchEvent(new Event('error'));

    expect(player.getState().status).toBe('error');
    expect(player.getState().error?.code).toBe('BROWSER_CODEC_UNSUPPORTED');
    expect(registry.getActiveCount()).toBe(0);

    // 2. Audio-only container reporting 0x0 video dimensions
    player.loadFile(
      new File(['audio-only'], 'podcast.mp4', { type: 'video/mp4' }),
    );
    configureVideoMetadata(video, {
      duration: 120,
      videoWidth: 0,
      videoHeight: 0,
    });
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(player.getState().status).toBe('error');
    expect(player.getState().error?.code).toBe('NO_VIDEO_TRACK');
    expect(registry.getActiveCount()).toBe(0);

    // 3. Valid file replaced by unsupported .txt file revokes active URL
    configureVideoMetadata(video, {
      duration: 50,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    player.loadFile(new File(['good'], 'good.webm', { type: 'video/webm' }));
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(registry.getActiveCount()).toBe(1);

    player.loadFile(new File(['notes'], 'notes.txt', { type: 'text/plain' }));
    expect(player.getState().status).toBe('error');
    expect(player.getState().error?.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(registry.getActiveCount()).toBe(0);
  });

  it('handles play() promise rejection gracefully with PLAYBACK_FAILED', async () => {
    const player = new HtmlVideoSourcePlayer();
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockRejectedValueOnce(
      new Error('Decode pipeline stalled'),
    );
    player.attachVideoElement(video);

    player.loadFile(new File(['video'], 'clip.mp4', { type: 'video/mp4' }));
    configureVideoMetadata(video, { duration: 30 });
    video.dispatchEvent(new Event('loadedmetadata'));

    await player.play();
    expect(player.getState().status).toBe('paused');
    expect(player.getState().error?.code).toBe('PLAYBACK_FAILED');
  });
});

describe('resolveBasePath (GitHub Pages configuration)', () => {
  it('uses / in development and /ReactStage/ in production by default', () => {
    expect(resolveBasePath('development')).toBe('/');
    expect(resolveBasePath('production')).toBe('/ReactStage/');
  });

  it('normalizes custom VITE_BASE_PATH values with leading and trailing slashes', () => {
    expect(resolveBasePath('production', 'custom-repo')).toBe('/custom-repo/');
    expect(resolveBasePath('production', '/custom-repo')).toBe('/custom-repo/');
    expect(resolveBasePath('production', '/custom-repo/')).toBe('/custom-repo/');
  });
});
