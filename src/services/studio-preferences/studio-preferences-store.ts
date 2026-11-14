import {
  DEFAULT_AUDIO_GAIN,
  MAX_AUDIO_GAIN,
  MIN_AUDIO_GAIN,
} from '../interfaces/audio-mixer';
import type { PipOverlayRect } from '../interfaces/scene-compositor';
import {
  DEFAULT_PIP_RECT,
  DEFAULT_SPLIT_RATIO,
  clampPipRect,
  clampSplitRatio,
} from '../scene-compositor';
import type {
  PipBorderStyle,
  PipFrameShape,
  SceneResolutionPreset,
  StageLayoutMode,
} from '../../types/media';

export const STUDIO_PREFERENCES_STORAGE_KEY =
  'reactstage.studio-preferences.v1';
export const STUDIO_PREFERENCES_SCHEMA_VERSION = 1;
export const MAX_CUSTOM_PRESETS = 12;
export const MAX_PRESET_NAME_LENGTH = 40;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StudioWorkspaceProfile {
  readonly layoutMode: StageLayoutMode;
  readonly resolutionPreset: SceneResolutionPreset;
  readonly pipRect: PipOverlayRect;
  readonly pipFrameShape: PipFrameShape;
  readonly pipBorderStyle: PipBorderStyle;
  readonly splitRatio: number;
  readonly sourceGain: number;
  readonly sourceMuted: boolean;
  readonly microphoneGain: number;
  readonly microphoneMuted: boolean;
  readonly mirrorPreview: boolean;
  readonly preRollEnabled: boolean;
  readonly shortcutsEnabled: boolean;
}

export interface StudioSavedPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly builtIn: boolean;
  readonly profile: StudioWorkspaceProfile;
  readonly updatedAtIso: string;
}

export interface StudioPreferencesSnapshot {
  readonly hasSavedWorkspace: boolean;
  readonly activeProfile: StudioWorkspaceProfile;
  readonly builtInPresets: readonly StudioSavedPreset[];
  readonly customPresets: readonly StudioSavedPreset[];
  readonly storageAvailable: boolean;
}

interface PersistedPreferencesEnvelope {
  readonly version: number;
  readonly activeProfile: StudioWorkspaceProfile | null;
  readonly customPresets: readonly StudioSavedPreset[];
}

export interface StudioPreferencesStoreOptions {
  readonly storage?: StorageLike | null;
  readonly storageKey?: string;
  readonly clock?: () => Date;
}

const VALID_LAYOUT_MODES: readonly StageLayoutMode[] = [
  'pip',
  'side-by-side',
  'source-only',
  'camera-only',
];

const VALID_RESOLUTION_PRESETS: readonly SceneResolutionPreset[] = [
  '720p',
  '1080p',
];

const VALID_PIP_SHAPES: readonly PipFrameShape[] = [
  'rect',
  'rounded',
  'circle',
];

const VALID_PIP_BORDERS: readonly PipBorderStyle[] = [
  'sky',
  'amber',
  'emerald',
  'subtle',
  'none',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeGain(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback;
  }
  const clamped = Math.min(MAX_AUDIO_GAIN, Math.max(MIN_AUDIO_GAIN, raw));
  return Math.round(clamped * 100) / 100;
}

function sanitizeLayoutMode(
  raw: unknown,
  fallback: StageLayoutMode,
): StageLayoutMode {
  if (
    typeof raw === 'string' &&
    (VALID_LAYOUT_MODES as readonly string[]).includes(raw)
  ) {
    return raw as StageLayoutMode;
  }
  return fallback;
}

function sanitizeResolutionPreset(
  raw: unknown,
  fallback: SceneResolutionPreset,
): SceneResolutionPreset {
  if (
    typeof raw === 'string' &&
    (VALID_RESOLUTION_PRESETS as readonly string[]).includes(raw)
  ) {
    return raw as SceneResolutionPreset;
  }
  return fallback;
}

function sanitizePipShape(
  raw: unknown,
  fallback: PipFrameShape,
): PipFrameShape {
  if (
    typeof raw === 'string' &&
    (VALID_PIP_SHAPES as readonly string[]).includes(raw)
  ) {
    return raw as PipFrameShape;
  }
  return fallback;
}

function sanitizePipBorder(
  raw: unknown,
  fallback: PipBorderStyle,
): PipBorderStyle {
  if (
    typeof raw === 'string' &&
    (VALID_PIP_BORDERS as readonly string[]).includes(raw)
  ) {
    return raw as PipBorderStyle;
  }
  return fallback;
}

function sanitizePipRect(raw: unknown): PipOverlayRect {
  if (!isRecord(raw)) {
    return DEFAULT_PIP_RECT;
  }
  return clampPipRect({
    x: typeof raw.x === 'number' ? raw.x : DEFAULT_PIP_RECT.x,
    y: typeof raw.y === 'number' ? raw.y : DEFAULT_PIP_RECT.y,
    width: typeof raw.width === 'number' ? raw.width : DEFAULT_PIP_RECT.width,
    height:
      typeof raw.height === 'number' ? raw.height : DEFAULT_PIP_RECT.height,
  });
}

export function sanitizePresetName(raw: string): string {
  // Strip control characters via codepoint filtering (avoids no-control-regex lint rule)
  let cleaned = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) {
      cleaned += ch;
    }
  }
  return cleaned
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PRESET_NAME_LENGTH);
}

export function createDefaultWorkspaceProfile(): StudioWorkspaceProfile {
  return {
    layoutMode: 'pip',
    resolutionPreset: '720p',
    pipRect: DEFAULT_PIP_RECT,
    pipFrameShape: 'rect',
    pipBorderStyle: 'sky',
    splitRatio: DEFAULT_SPLIT_RATIO,
    sourceGain: DEFAULT_AUDIO_GAIN,
    sourceMuted: false,
    microphoneGain: DEFAULT_AUDIO_GAIN,
    microphoneMuted: false,
    mirrorPreview: true,
    preRollEnabled: false,
    shortcutsEnabled: true,
  };
}

export function sanitizeWorkspaceProfile(raw: unknown): StudioWorkspaceProfile {
  const defaults = createDefaultWorkspaceProfile();
  if (!isRecord(raw)) {
    return defaults;
  }

  const splitRaw =
    typeof raw.splitRatio === 'number' && Number.isFinite(raw.splitRatio)
      ? clampSplitRatio(raw.splitRatio)
      : defaults.splitRatio;

  return {
    layoutMode: sanitizeLayoutMode(raw.layoutMode, defaults.layoutMode),
    resolutionPreset: sanitizeResolutionPreset(
      raw.resolutionPreset,
      defaults.resolutionPreset,
    ),
    pipRect: sanitizePipRect(raw.pipRect),
    pipFrameShape: sanitizePipShape(raw.pipFrameShape, defaults.pipFrameShape),
    pipBorderStyle: sanitizePipBorder(
      raw.pipBorderStyle,
      defaults.pipBorderStyle,
    ),
    splitRatio: splitRaw,
    sourceGain: sanitizeGain(raw.sourceGain, defaults.sourceGain),
    sourceMuted:
      typeof raw.sourceMuted === 'boolean'
        ? raw.sourceMuted
        : defaults.sourceMuted,
    microphoneGain: sanitizeGain(raw.microphoneGain, defaults.microphoneGain),
    microphoneMuted:
      typeof raw.microphoneMuted === 'boolean'
        ? raw.microphoneMuted
        : defaults.microphoneMuted,
    mirrorPreview:
      typeof raw.mirrorPreview === 'boolean'
        ? raw.mirrorPreview
        : defaults.mirrorPreview,
    preRollEnabled:
      typeof raw.preRollEnabled === 'boolean'
        ? raw.preRollEnabled
        : defaults.preRollEnabled,
    shortcutsEnabled:
      typeof raw.shortcutsEnabled === 'boolean'
        ? raw.shortcutsEnabled
        : defaults.shortcutsEnabled,
  };
}

export function areWorkspaceProfilesEqual(
  a: StudioWorkspaceProfile,
  b: StudioWorkspaceProfile,
): boolean {
  return (
    a.layoutMode === b.layoutMode &&
    a.resolutionPreset === b.resolutionPreset &&
    a.pipRect.x === b.pipRect.x &&
    a.pipRect.y === b.pipRect.y &&
    a.pipRect.width === b.pipRect.width &&
    a.pipRect.height === b.pipRect.height &&
    a.pipFrameShape === b.pipFrameShape &&
    a.pipBorderStyle === b.pipBorderStyle &&
    a.splitRatio === b.splitRatio &&
    a.sourceGain === b.sourceGain &&
    a.sourceMuted === b.sourceMuted &&
    a.microphoneGain === b.microphoneGain &&
    a.microphoneMuted === b.microphoneMuted &&
    a.mirrorPreview === b.mirrorPreview &&
    a.preRollEnabled === b.preRollEnabled &&
    a.shortcutsEnabled === b.shortcutsEnabled
  );
}

export const BUILT_IN_STUDIO_PRESETS: readonly StudioSavedPreset[] = [
  {
    id: 'built-in-review',
    name: 'Code & Design Review',
    description:
      '1080p Rounded PIP bottom-right · Video 70% · Mic 120% · 3s Pre-Roll',
    builtIn: true,
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    profile: {
      layoutMode: 'pip',
      resolutionPreset: '1080p',
      pipRect: clampPipRect({ x: 0.69, y: 0.69, width: 0.28, height: 0.28 }),
      pipFrameShape: 'rounded',
      pipBorderStyle: 'sky',
      splitRatio: DEFAULT_SPLIT_RATIO,
      sourceGain: 0.7,
      sourceMuted: false,
      microphoneGain: 1.2,
      microphoneMuted: false,
      mirrorPreview: true,
      preRollEnabled: true,
      shortcutsEnabled: true,
    },
  },
  {
    id: 'built-in-split',
    name: 'Side-by-Side Commentary',
    description: '720p 55/45 Split · Video 80% · Mic 115% · Instant Start',
    builtIn: true,
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    profile: {
      layoutMode: 'side-by-side',
      resolutionPreset: '720p',
      pipRect: DEFAULT_PIP_RECT,
      pipFrameShape: 'rect',
      pipBorderStyle: 'sky',
      splitRatio: 0.55,
      sourceGain: 0.8,
      sourceMuted: false,
      microphoneGain: 1.15,
      microphoneMuted: false,
      mirrorPreview: true,
      preRollEnabled: false,
      shortcutsEnabled: true,
    },
  },
  {
    id: 'built-in-trailer',
    name: 'Trailer / Gameplay Reaction',
    description:
      '1080p Circle PIP bottom-left · Video 95% · Mic 130% · 3s Pre-Roll',
    builtIn: true,
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    profile: {
      layoutMode: 'pip',
      resolutionPreset: '1080p',
      pipRect: clampPipRect({ x: 0.03, y: 0.73, width: 0.24, height: 0.24 }),
      pipFrameShape: 'circle',
      pipBorderStyle: 'amber',
      splitRatio: DEFAULT_SPLIT_RATIO,
      sourceGain: 0.95,
      sourceMuted: false,
      microphoneGain: 1.3,
      microphoneMuted: false,
      mirrorPreview: true,
      preRollEnabled: true,
      shortcutsEnabled: true,
    },
  },
];

function resolveDefaultBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function formatProfileSummary(profile: StudioWorkspaceProfile): string {
  const layoutLabel =
    profile.layoutMode === 'pip'
      ? 'PIP'
      : profile.layoutMode === 'side-by-side'
        ? `${Math.round(profile.splitRatio * 100)}% Split`
        : profile.layoutMode === 'source-only'
          ? 'Source Only'
          : 'Webcam Only';
  const srcLabel = profile.sourceMuted
    ? 'Video Muted'
    : `Video ${Math.round(profile.sourceGain * 100)}%`;
  const micLabel = profile.microphoneMuted
    ? 'Mic Muted'
    : `Mic ${Math.round(profile.microphoneGain * 100)}%`;
  return `${profile.resolutionPreset} ${layoutLabel} · ${srcLabel} · ${micLabel}`;
}

export class StudioPreferencesStore {
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly clock: () => Date;
  private readonly listeners = new Set<() => void>();

  private hasSavedWorkspace = false;
  private activeProfile: StudioWorkspaceProfile =
    createDefaultWorkspaceProfile();
  private customPresets: StudioSavedPreset[] = [];
  private storageAvailable = false;
  private presetIdSeq = 0;
  private snapshot: StudioPreferencesSnapshot;

  public constructor(options: StudioPreferencesStoreOptions = {}) {
    this.storage =
      options.storage !== undefined
        ? options.storage
        : resolveDefaultBrowserStorage();
    this.storageKey = options.storageKey ?? STUDIO_PREFERENCES_STORAGE_KEY;
    this.clock = options.clock ?? (() => new Date());

    this.loadFromStorage();
    this.snapshot = this.buildSnapshot();
  }

  public getSnapshot(): StudioPreferencesSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public saveActiveProfile(nextProfile: StudioWorkspaceProfile): void {
    const sanitized = sanitizeWorkspaceProfile(nextProfile);
    if (
      this.hasSavedWorkspace &&
      areWorkspaceProfilesEqual(this.activeProfile, sanitized)
    ) {
      return;
    }
    this.activeProfile = sanitized;
    this.hasSavedWorkspace = true;
    this.persistToStorage();
    this.emit();
  }

  public resetActiveProfileToDefaults(): StudioWorkspaceProfile {
    const defaults = createDefaultWorkspaceProfile();
    this.activeProfile = defaults;
    this.hasSavedWorkspace = false;
    this.persistToStorage();
    this.emit();
    return defaults;
  }

  public saveCustomPreset(
    rawName: string,
    profile: StudioWorkspaceProfile,
  ): StudioSavedPreset | null {
    const name = sanitizePresetName(rawName);
    if (!name) {
      return null;
    }

    const sanitizedProfile = sanitizeWorkspaceProfile(profile);
    const nowIso = this.clock().toISOString();
    const description = formatProfileSummary(sanitizedProfile);

    const existingIdx = this.customPresets.findIndex(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );

    let saved: StudioSavedPreset;
    if (existingIdx >= 0) {
      const existing = this.customPresets[existingIdx];
      if (!existing) {
        return null;
      }
      saved = {
        ...existing,
        name,
        description,
        profile: sanitizedProfile,
        updatedAtIso: nowIso,
      };
      this.customPresets = this.customPresets.map((item, idx) =>
        idx === existingIdx ? saved : item,
      );
    } else {
      this.presetIdSeq += 1;
      saved = {
        id: `custom-preset-${String(this.clock().getTime())}-${String(this.presetIdSeq)}`,
        name,
        description,
        builtIn: false,
        profile: sanitizedProfile,
        updatedAtIso: nowIso,
      };
      const nextList = [saved, ...this.customPresets];
      this.customPresets = nextList.slice(0, MAX_CUSTOM_PRESETS);
    }

    this.persistToStorage();
    this.emit();
    return saved;
  }

  public deleteCustomPreset(presetId: string): boolean {
    const before = this.customPresets.length;
    this.customPresets = this.customPresets.filter(
      (item) => item.id !== presetId,
    );
    if (this.customPresets.length === before) {
      return false;
    }
    this.persistToStorage();
    this.emit();
    return true;
  }

  public getPresetById(presetId: string): StudioSavedPreset | null {
    const builtIn = BUILT_IN_STUDIO_PRESETS.find(
      (item) => item.id === presetId,
    );
    if (builtIn) {
      return builtIn;
    }
    return this.customPresets.find((item) => item.id === presetId) ?? null;
  }

  private loadFromStorage(): void {
    if (!this.storage) {
      this.storageAvailable = false;
      return;
    }

    try {
      const rawText = this.storage.getItem(this.storageKey);
      this.storageAvailable = true;
      if (!rawText) {
        return;
      }

      const parsed: unknown = JSON.parse(rawText);
      if (!isRecord(parsed)) {
        return;
      }

      if (parsed.activeProfile !== null && parsed.activeProfile !== undefined) {
        this.activeProfile = sanitizeWorkspaceProfile(parsed.activeProfile);
        this.hasSavedWorkspace = true;
      }

      if (Array.isArray(parsed.customPresets)) {
        const sanitizedList: StudioSavedPreset[] = [];
        for (const item of parsed.customPresets) {
          if (!isRecord(item) || typeof item.name !== 'string') {
            continue;
          }
          const cleanName = sanitizePresetName(item.name);
          if (!cleanName) {
            continue;
          }
          const cleanProfile = sanitizeWorkspaceProfile(item.profile);
          const id =
            typeof item.id === 'string' && item.id.trim().length > 0
              ? item.id.trim()
              : `custom-preset-restored-${String(sanitizedList.length + 1)}`;
          const updatedAtIso =
            typeof item.updatedAtIso === 'string'
              ? item.updatedAtIso
              : '2026-01-01T00:00:00.000Z';

          sanitizedList.push({
            id,
            name: cleanName,
            description: formatProfileSummary(cleanProfile),
            builtIn: false,
            profile: cleanProfile,
            updatedAtIso,
          });
          if (sanitizedList.length >= MAX_CUSTOM_PRESETS) {
            break;
          }
        }
        this.customPresets = sanitizedList;
      }
    } catch {
      // Corrupt JSON or blocked storage: safely keep clean defaults
      this.hasSavedWorkspace = false;
      this.activeProfile = createDefaultWorkspaceProfile();
      this.customPresets = [];
    }
  }

  private persistToStorage(): void {
    if (!this.storage) {
      this.storageAvailable = false;
      return;
    }

    try {
      if (!this.hasSavedWorkspace && this.customPresets.length === 0) {
        this.storage.removeItem(this.storageKey);
        this.storageAvailable = true;
        return;
      }

      const envelope: PersistedPreferencesEnvelope = {
        version: STUDIO_PREFERENCES_SCHEMA_VERSION,
        activeProfile: this.hasSavedWorkspace ? this.activeProfile : null,
        customPresets: this.customPresets,
      };
      this.storage.setItem(this.storageKey, JSON.stringify(envelope));
      this.storageAvailable = true;
    } catch {
      // QuotaExceededError or SecurityError: degrade gracefully without throwing
      this.storageAvailable = false;
    }
  }

  private buildSnapshot(): StudioPreferencesSnapshot {
    return {
      hasSavedWorkspace: this.hasSavedWorkspace,
      activeProfile: this.activeProfile,
      builtInPresets: BUILT_IN_STUDIO_PRESETS,
      customPresets: [...this.customPresets],
      storageAvailable: this.storageAvailable,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }
}
