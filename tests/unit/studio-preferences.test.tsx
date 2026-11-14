import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import {
  STUDIO_PREFERENCES_STORAGE_KEY,
  StudioPreferencesStore,
  type StorageLike,
} from '../../src/services/studio-preferences';

describe('Task 8 StudioPreferencesStore & Creator Presets UI', () => {
  it('sanitizes out-of-bounds values, recovers from corrupt JSON, and degrades gracefully when storage throws', () => {
    const backing = new Map<string, string>();
    backing.set(
      STUDIO_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeProfile: {
          layoutMode: 'invalid-mode',
          resolutionPreset: '8k-invalid',
          pipRect: { x: 5, y: -3, width: 0.99, height: 0.01 },
          splitRatio: 99,
          sourceGain: 15,
          sourceMuted: 'not-a-bool',
          microphoneGain: -4,
          microphoneMuted: true,
          mirrorPreview: false,
          preRollEnabled: true,
          shortcutsEnabled: false,
        },
        customPresets: [
          {
            id: 'p1',
            name: '   Clean   Name   ',
            profile: { layoutMode: 'camera-only', microphoneGain: 1.5 },
          },
        ],
      }),
    );

    const memoryStorage: StorageLike = {
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => {
        backing.set(k, v);
      },
      removeItem: (k) => {
        backing.delete(k);
      },
    };

    const store = new StudioPreferencesStore({ storage: memoryStorage });
    const snap = store.getSnapshot();

    expect(snap.hasSavedWorkspace).toBe(true);
    expect(snap.activeProfile.layoutMode).toBe('pip');
    expect(snap.activeProfile.resolutionPreset).toBe('720p');
    expect(snap.activeProfile.splitRatio).toBe(0.8);
    expect(snap.activeProfile.sourceGain).toBe(2);
    expect(snap.activeProfile.sourceMuted).toBe(false);
    expect(snap.activeProfile.microphoneGain).toBe(0);
    expect(snap.activeProfile.microphoneMuted).toBe(true);
    expect(snap.activeProfile.mirrorPreview).toBe(false);
    expect(snap.activeProfile.preRollEnabled).toBe(true);
    expect(snap.activeProfile.shortcutsEnabled).toBe(false);
    expect(snap.customPresets[0]?.name).toBe('Clean Name');
    expect(snap.customPresets[0]?.profile.layoutMode).toBe('camera-only');

    // Corrupt JSON does not throw
    backing.set(STUDIO_PREFERENCES_STORAGE_KEY, '{bad-json');
    const recovered = new StudioPreferencesStore({ storage: memoryStorage });
    expect(recovered.getSnapshot().hasSavedWorkspace).toBe(false);

    // QuotaExceededError on write degrades gracefully without throwing
    const throwingStorage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const restrictedStore = new StudioPreferencesStore({
      storage: throwingStorage,
    });
    expect(() => {
      restrictedStore.saveCustomPreset(
        'Offline Preset',
        restrictedStore.getSnapshot().activeProfile,
      );
    }).not.toThrow();
    expect(restrictedStore.getSnapshot().storageAvailable).toBe(false);
  });

  it('persists live setup & custom presets across StrictMode remounts with zero permission requests on load, and supports Reset Defaults', async () => {
    const getUserMediaSpy = vi.fn();
    const enumerateDevicesSpy = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: getUserMediaSpy,
        enumerateDevices: enumerateDevicesSpy,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const user = userEvent.setup();
    const firstMount = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Adjust layout -> side-by-side, resolution -> 1080p, mic gain -> 1.35, 3s Pre-Roll -> On
    await user.click(screen.getByTestId('layout-mode-side-by-side'));
    await user.selectOptions(
      screen.getByTestId('scene-resolution-select'),
      '1080p',
    );
    fireEvent.change(screen.getByTestId('mixer-mic-gain-slider'), {
      target: { value: '1.35' },
    });
    await user.click(screen.getByTestId('preroll-countdown-toggle'));

    // Open Presets modal and save custom preset "My Lecture Setup"
    await user.click(screen.getByTestId('open-presets-modal-button'));
    expect(screen.getByTestId('studio-presets-modal')).toBeInTheDocument();
    expect(
      screen.getByTestId('workspace-persistence-badge'),
    ).toHaveTextContent('Auto-Saved');

    await user.type(
      screen.getByTestId('preset-name-input'),
      'My Lecture Setup',
    );
    await user.click(screen.getByTestId('save-custom-preset-button'));
    expect(screen.getByTestId('custom-presets-count')).toHaveTextContent('1');

    // Unmount App #1, then mount a brand-new App #2 sharing localStorage
    firstMount.unmount();

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Hydrates saved workspace without calling getUserMedia or enumerateDevices!
    expect(getUserMediaSpy).not.toHaveBeenCalled();
    expect(enumerateDevicesSpy).not.toHaveBeenCalled();

    expect(screen.getByTestId('layout-mode-side-by-side')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByTestId<HTMLSelectElement>('scene-resolution-select').value,
    ).toBe('1080p');
    expect(screen.getByTestId('mixer-mic-gain-value')).toHaveTextContent(
      '135%',
    );
    expect(screen.getByTestId('preroll-countdown-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('header-presets-count')).toHaveTextContent('1');

    // Open Presets modal -> apply built-in "Code & Design Review" -> re-apply custom -> delete custom -> Reset Defaults
    await user.click(screen.getByTestId('open-presets-modal-button'));
    await user.click(screen.getByTestId('apply-preset-built-in-review'));
    expect(screen.getByTestId('layout-mode-pip')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('mixer-source-gain-value')).toHaveTextContent(
      '70%',
    );

    await user.click(screen.getByTestId('apply-custom-preset-1'));
    expect(screen.getByTestId('layout-mode-side-by-side')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByTestId('delete-custom-preset-1'));
    expect(screen.getByTestId('custom-presets-count')).toHaveTextContent('0');

    await user.click(screen.getByTestId('reset-studio-defaults-button'));
    expect(
      screen.getByTestId('workspace-persistence-badge'),
    ).toHaveTextContent('Factory Default');
    expect(screen.getByTestId('layout-mode-pip')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByTestId<HTMLSelectElement>('scene-resolution-select').value,
    ).toBe('720p');
    expect(screen.getByTestId('mixer-mic-gain-value')).toHaveTextContent(
      '100%',
    );
  });
});
