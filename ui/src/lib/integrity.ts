/**
 * Integrity events from the candidate's browser, batched to POST /api/candidate/:token/events
 * every 3 s (≤ 50 per call). Records counts only — a paste is "412 chars", never the text.
 */
import type { CandidateEvents, IntegrityEventType } from '@contracts/api';
import { ApiError, type ApiClient } from '../api/client';

const FLUSH_MS = 3000;
const MAX_PER_CALL = 50;

export class EventBatcher {
  private queue: CandidateEvents['events'] = [];
  private timer: number | undefined;
  private sending = false;
  private pausedUntil = 0;
  private detach: (() => void) | null = null;

  constructor(
    private readonly token: string,
    private readonly client: ApiClient,
  ) {}

  push(type: IntegrityEventType, detail?: string) {
    this.queue.push(detail === undefined ? { type, clientAt: new Date().toISOString() } : { type, clientAt: new Date().toISOString(), detail });
    if (this.queue.length >= MAX_PER_CALL) void this.flush();
  }

  async flush(keepalive = false): Promise<void> {
    if (this.sending || this.queue.length === 0 || Date.now() < this.pausedUntil) return;
    this.sending = true;
    const batch = this.queue.slice(0, MAX_PER_CALL);
    try {
      await this.client.postEvents(this.token, { events: batch }, keepalive);
      this.queue.splice(0, batch.length);
    } catch (e) {
      // Keep the batch; the next tick retries. Rate-limited: wait out Retry-After first.
      if (e instanceof ApiError && e.status === 429) this.pausedUntil = Date.now() + (e.retryAfterMs ?? 1000);
      else if (e instanceof ApiError && e.status >= 400 && e.status < 500) this.queue.splice(0, batch.length); // rejected for good
    } finally {
      this.sending = false;
    }
  }

  /** Attach the window/document listeners and start the 3 s flush loop. */
  start() {
    if (this.detach) return;
    this.timer = window.setInterval(() => void this.flush(), FLUSH_MS);
    const onVisibility = () => this.push(document.visibilityState === 'hidden' ? 'tab_hidden' : 'tab_visible');
    const onBlur = () => this.push('window_blur');
    const onFocus = () => this.push('window_focus');
    const onPaste = (e: ClipboardEvent) => {
      const n = e.clipboardData?.getData('text')?.length ?? 0;
      this.push('paste', `${n} chars`);
    };
    const onCopy = () => {
      const n = window.getSelection()?.toString().length ?? 0;
      this.push('copy', `${n} chars`);
    };
    const onHide = () => void this.flush(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('copy', onCopy, true);
    window.addEventListener('pagehide', onHide);
    this.detach = () => {
      window.clearInterval(this.timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('copy', onCopy, true);
      window.removeEventListener('pagehide', onHide);
    };
  }

  stop() {
    this.detach?.();
    this.detach = null;
  }
}
