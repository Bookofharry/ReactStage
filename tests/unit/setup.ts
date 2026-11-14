import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

let syntheticBlobCounter = 0;

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class JSDOMPointerEvent extends MouseEvent {
    public readonly pointerId: number;
    public readonly pointerType: string;

    public constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: JSDOMPointerEvent,
  });
}

beforeEach(() => {
  syntheticBlobCounter = 0;
  window.localStorage.clear();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      syntheticBlobCounter += 1;
      return `blob:http://localhost:5173/mock-media-${syntheticBlobCounter}`;
    }),
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(
    (mimeType: string): CanPlayTypeResult => {
      const normalized = mimeType.toLowerCase();
      if (normalized.includes('video/mp4') || normalized.includes('video/webm')) {
        return 'probably';
      }
      if (normalized.includes('video/ogg')) {
        return 'maybe';
      }
      return '';
    },
  );

  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {
    // JSDOM stub override to avoid not-implemented console noise
  });

  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
    Promise.resolve(),
  );

  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    // JSDOM stub override
  });

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (contextId: string) => {
      if (contextId !== '2d') {
        return null;
      }
      return {
        fillStyle: '#000000',
        strokeStyle: '#000000',
        lineWidth: 1,
        lineCap: 'round',
        lineJoin: 'round',
        globalAlpha: 1,
        font: '12px sans-serif',
        textAlign: 'center',
        textBaseline: 'middle',
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        roundRect: vi.fn(),
        clip: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        clearRect: vi.fn(),
        fillText: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
