import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { MAX_PRESET_NAME_LENGTH } from '../services/studio-preferences';
import { useStudioPreferences } from '../state/StudioPreferencesContext';
import { BookmarkPresetIcon, CloseIcon, TrashIcon } from './StudioIcons';

export function StudioPresetsModal() {
  const {
    snapshot,
    currentLiveProfile,
    isPresetsModalOpen,
    closePresetsModal,
    saveCurrentAsPreset,
    applyPreset,
    deleteCustomPreset,
    resetStudioToDefaults,
  } = useStudioPreferences();

  const [presetNameInput, setPresetNameInput] = useState('');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isPresetsModalOpen) {
      return;
    }
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePresetsModal();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const container = dialogRef.current;
      if (!container) {
        return;
      }
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closePresetsModal, isPresetsModalOpen]);

  if (!isPresetsModalOpen) {
    return null;
  }

  const handleSaveSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = saveCurrentAsPreset(presetNameInput);
    if (saved) {
      setPresetNameInput('');
      setStatusNotice(`Saved preset "${saved.name}".`);
    }
  };

  const liveLayoutLabel =
    currentLiveProfile.layoutMode === 'pip'
      ? 'PIP'
      : currentLiveProfile.layoutMode === 'side-by-side'
        ? `${Math.round(currentLiveProfile.splitRatio * 100)}% Split`
        : currentLiveProfile.layoutMode === 'top-bottom'
          ? `${Math.round(currentLiveProfile.splitRatio * 100)}% Shorts`
          : currentLiveProfile.layoutMode === 'source-only'
            ? 'Source Only'
            : 'Webcam Only';

  return (
    <div
      data-testid="studio-presets-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close studio presets dialog backdrop"
        onClick={closePresetsModal}
        className="fixed inset-0 cursor-default bg-slate-950/80 backdrop-blur-xs"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-presets-modal-title"
        data-testid="studio-presets-modal"
        className="relative z-10 flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-2.5 border-b border-white/[0.08] px-3.5 py-3 sm:items-center sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300">
              <BookmarkPresetIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2
                id="studio-presets-modal-title"
                className="text-sm font-bold text-slate-100 sm:text-base"
              >
                Creator Presets &amp; Local Setup
              </h2>
              <p className="text-xs leading-snug text-slate-300">
                Saved locally in browser storage · Zero cloud sync or permissions
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            data-testid="close-presets-modal-button"
            aria-label="Close studio presets dialog"
            onClick={closePresetsModal}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5 sm:px-5 sm:py-4">
          {/* Active Workspace Auto-Save Card + Reset Defaults */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 sm:px-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-100">
                  Current Live Setup
                </span>
                <span
                  data-testid="workspace-persistence-badge"
                  className={
                    snapshot.hasSavedWorkspace
                      ? 'rounded-full border border-emerald-400/35 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300'
                      : 'rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300'
                  }
                >
                  {snapshot.hasSavedWorkspace ? 'Auto-Saved' : 'Factory Default'}
                </span>
              </div>
              <p
                data-testid="current-live-profile-summary"
                className="mt-1 font-mono text-[11px] leading-relaxed text-slate-300 tabular-nums break-words"
              >
                {currentLiveProfile.resolutionPreset} · {liveLayoutLabel} ·
                Video {Math.round(currentLiveProfile.sourceGain * 100)}% · Mic{' '}
                {Math.round(currentLiveProfile.microphoneGain * 100)}% ·{' '}
                {currentLiveProfile.preRollEnabled
                  ? '3s Pre-Roll'
                  : 'Instant Start'}
              </p>
            </div>

            <button
              type="button"
              data-testid="reset-studio-defaults-button"
              onClick={() => {
                resetStudioToDefaults();
                setStatusNotice('Restored factory studio defaults.');
              }}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              Reset Defaults
            </button>
          </div>

          {statusNotice && (
            <p
              role="status"
              data-testid="presets-status-notice"
              className="rounded-lg border border-emerald-400/35 bg-emerald-950/35 px-3 py-2 text-xs text-emerald-200 break-words"
            >
              {statusNotice}
            </p>
          )}

          {/* Save Current Setup as Named Preset */}
          <form
            onSubmit={handleSaveSubmit}
            className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 sm:p-3.5"
          >
            <label
              htmlFor="preset-name-input"
              className="block text-xs font-semibold text-slate-100"
            >
              Save current setup as a custom preset
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="preset-name-input"
                data-testid="preset-name-input"
                type="text"
                maxLength={MAX_PRESET_NAME_LENGTH}
                placeholder="e.g. Lecture Breakdown 1080p"
                value={presetNameInput}
                onChange={(event) => {
                  setPresetNameInput(event.currentTarget.value);
                }}
                className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              />
              <button
                type="submit"
                data-testid="save-custom-preset-button"
                disabled={presetNameInput.trim().length === 0}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 active:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400"
              >
                Save Preset
              </button>
            </div>
          </form>

          {/* User Custom Presets */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wider text-sky-300 uppercase">
                My Saved Presets
              </h3>
              <span
                data-testid="custom-presets-count"
                className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-sky-300 tabular-nums"
              >
                {snapshot.customPresets.length}
              </span>
            </div>

            {snapshot.customPresets.length === 0 ? (
              <p
                data-testid="custom-presets-empty"
                className="rounded-xl border border-dashed border-slate-800 bg-slate-950/60 px-3.5 py-3 text-xs leading-relaxed text-slate-300"
              >
                No custom presets saved yet. Adjust your layout, PIP corner,
                resolution, and audio balance, then save it above.
              </p>
            ) : (
              <ul
                aria-label="Custom studio presets"
                className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/70"
              >
                {snapshot.customPresets.map((preset, index) => (
                  <li
                    key={preset.id}
                    data-testid={`custom-preset-row-${index + 1}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs sm:px-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-100 break-words">
                        {preset.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] leading-snug text-slate-300 break-words">
                        {preset.description}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        data-testid={`apply-custom-preset-${index + 1}`}
                        onClick={() => {
                          applyPreset(preset.id);
                          setStatusNotice(`Applied preset "${preset.name}".`);
                        }}
                        className="inline-flex min-h-9 items-center justify-center rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300 active:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        data-testid={`delete-custom-preset-${index + 1}`}
                        aria-label={`Delete preset ${preset.name}`}
                        onClick={() => {
                          deleteCustomPreset(preset.id);
                          setStatusNotice(`Deleted preset "${preset.name}".`);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-400/40 hover:text-rose-300 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Built-In Starter Presets */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wider text-sky-300 uppercase">
              Built-In Starter Presets
            </h3>
            <ul
              aria-label="Built-in studio presets"
              className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/70"
            >
              {snapshot.builtInPresets.map((preset) => (
                <li
                  key={preset.id}
                  data-testid={`preset-row-${preset.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs sm:px-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-100 break-words">
                      {preset.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] leading-snug text-slate-300 break-words">
                      {preset.description}
                    </p>
                  </div>

                  <button
                    type="button"
                    data-testid={`apply-preset-${preset.id}`}
                    onClick={() => {
                      applyPreset(preset.id);
                      setStatusNotice(`Applied "${preset.name}".`);
                    }}
                    className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                  >
                    Apply
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
