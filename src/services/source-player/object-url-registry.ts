export interface UrlObjectAdapter {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

const defaultUrlAdapter: UrlObjectAdapter = {
  createObjectURL: (blob: Blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url: string) => URL.revokeObjectURL(url),
};

/**
 * Tracks all local Object URLs created by ReactStage so every replaced,
 * errored, unloaded, or unmounted media blob is deterministically revoked.
 */
export class ObjectUrlRegistry {
  private readonly activeUrls = new Set<string>();
  private currentPrimaryUrl: string | null = null;
  private readonly adapter: UrlObjectAdapter;

  public constructor(adapter: UrlObjectAdapter = defaultUrlAdapter) {
    this.adapter = adapter;
  }

  /**
   * Creates a new primary Object URL and immediately revokes any previous primary URL.
   */
  public replacePrimary(blob: Blob): string {
    const previousUrl = this.currentPrimaryUrl;
    const nextUrl = this.adapter.createObjectURL(blob);
    this.activeUrls.add(nextUrl);
    this.currentPrimaryUrl = nextUrl;

    if (previousUrl !== null && previousUrl !== nextUrl) {
      this.revoke(previousUrl);
    }

    return nextUrl;
  }

  /**
   * Revokes a specific tracked Object URL if still active.
   */
  public revoke(url: string | null | undefined): void {
    if (!url || !this.activeUrls.has(url)) {
      return;
    }

    this.activeUrls.delete(url);
    if (this.currentPrimaryUrl === url) {
      this.currentPrimaryUrl = null;
    }
    this.adapter.revokeObjectURL(url);
  }

  /**
   * Revokes all currently tracked Object URLs.
   */
  public revokeAll(): void {
    for (const url of Array.from(this.activeUrls)) {
      this.adapter.revokeObjectURL(url);
    }
    this.activeUrls.clear();
    this.currentPrimaryUrl = null;
  }

  public getCurrentPrimaryUrl(): string | null {
    return this.currentPrimaryUrl;
  }

  public getActiveCount(): number {
    return this.activeUrls.size;
  }

  public getActiveUrls(): ReadonlySet<string> {
    return this.activeUrls;
  }
}
