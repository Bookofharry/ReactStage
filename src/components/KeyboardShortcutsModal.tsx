import { useEffect, useRef } from 'react';
import { useStudioShortcuts } from '../state/StudioShortcutsContext';
import { CloseIcon, KeyboardIcon } from './StudioIcons';

interface ShortcutRow {
  readonly keys: readonly string[];
  readonly description: string;
}

interface ShortcutGroup {
  readonly title: string;
  readonly items: readonly ShortcutRow[];
}

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Source Video & Audio Mix',
    items: [
      { keys: ['Space', 'K'], description: 'Play or pause imported video' },
      { keys: ['J'], description: 'Rewind imported video by 10 seconds' },
      { keys: ['V'], description: 'Mute or unmute imported video audio' },
      { keys: ['M'], description: 'Mute or unmute live microphone' },
    ],
  },
  {
    title: 'Live Scene Layouts & Telestrator',
    items: [
      { keys: ['1'], description: 'Picture-in-Picture (PIP) layout' },
      { keys: ['2'], description: 'Side-by-Side Split layout' },
      { keys: ['3'], description: 'Source Video Only layout' },
      { keys: ['4'], description: 'Webcam Only layout' },
      { keys: ['5'], description: 'Top / Bottom Vertical Shorts layout' },
      { keys: ['D'], description: 'Toggle stage Telestrator freehand pen' },
      { keys: ['L'], description: 'Toggle on-canvas Lower-Third title banner' },
      {
        keys: ['T'],
        description: 'Toggle non-recorded Eye-Line Teleprompter HUD',
      },
      { keys: ['Z', 'Ctrl+Z'], description: 'Undo last stage annotation' },
      { keys: ['C'], description: 'Clear all stage annotations' },
    ],
  },
  {
    title: 'Reaction Recording, Chapters & Countdown',
    items: [
      {
        keys: ['R'],
        description: 'Start recording (or Stop & Finalize when recording)',
      },
      {
        keys: ['Shift', 'R'],
        description: 'Start recording with 3-2-1 pre-roll countdown',
      },
      {
        keys: ['P'],
        description: 'Pause or resume active recording session',
      },
      {
        keys: ['B'],
        description: 'Drop timestamped chapter marker while recording',
      },
      {
        keys: ['Esc'],
        description: 'Cancel active pre-roll countdown or close dialog',
      },
      {
        keys: ['?'],
        description: 'Open or close keyboard shortcuts reference',
      },
    ],
  },
];

export function KeyboardShortcutsModal() {
  const {
    isModalOpen,
    shortcutsEnabled,
    closeShortcutsModal,
    toggleShortcutsEnabled,
  } = useStudioShortcuts();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }
    closeButtonRef.current?.focus();

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
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

    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isModalOpen]);

  if (!isModalOpen) {
    return null;
  }

  return (
    <div
      data-testid="keyboard-shortcuts-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close keyboard shortcuts dialog backdrop"
        onClick={closeShortcutsModal}
        className="fixed inset-0 cursor-default bg-slate-950/80 backdrop-blur-xs"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        data-testid="keyboard-shortcuts-modal"
        className="relative z-10 flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-2.5 border-b border-white/[0.08] px-3.5 py-3 sm:items-center sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300">
              <KeyboardIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2
                id="shortcuts-modal-title"
                className="text-sm font-bold text-slate-100 sm:text-base"
              >
                Studio Keyboard Shortcuts
              </h2>
              <p className="text-xs leading-snug text-slate-300">
                Automatically paused whenever typing in text inputs or selects
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            data-testid="close-shortcuts-modal-button"
            aria-label="Close keyboard shortcuts dialog"
            onClick={closeShortcutsModal}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5 sm:px-5 sm:py-4">
          {/* WCAG 2.1.4 Single-Key Shortcut Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 sm:px-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-100">
                Single-key studio shortcuts
              </p>
              <p className="text-[11px] leading-snug text-slate-300">
                Turn off single-character hotkeys if you use speech or switch
                navigation (WCAG 2.1.4).
              </p>
            </div>

            <button
              type="button"
              data-testid="toggle-global-shortcuts-button"
              aria-pressed={shortcutsEnabled}
              onClick={toggleShortcutsEnabled}
              className={
                shortcutsEnabled
                  ? 'inline-flex min-h-9 items-center justify-center rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300 active:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
                  : 'inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
              }
            >
              {shortcutsEnabled ? 'Shortcuts Enabled' : 'Shortcuts Disabled'}
            </button>
          </div>

          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wider text-sky-300 uppercase">
                {group.title}
              </h3>
              <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/70">
                {group.items.map((item) => (
                  <div
                    key={item.description}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 text-xs sm:px-3.5"
                  >
                    <span className="min-w-0 flex-1 text-slate-200 break-words">
                      {item.description}
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-1">
                      {item.keys.map((k, idx) => (
                        <span key={k} className="inline-flex items-center gap-1">
                          {idx > 0 && (
                            <span className="text-[10px] text-slate-400">
                              /
                            </span>
                          )}
                          <kbd className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-200">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
