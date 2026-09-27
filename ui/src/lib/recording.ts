/**
 * Recording controller for the candidate page: one MediaRecorder per stream, one sequential
 * upload queue per server segment (PUT …/chunks/:seq, retry with backoff, 409 resync). Unacked
 * chunks stay in memory; the page warns when the backlog passes ~200 MB.
 */
import type { IntegrityEventType, RecordingStream } from '@contracts/api';
import { ApiError, type ApiClient } from '../api/client';
import type { MediaLayer } from './media';

const TIMESLICE_MS = 4000;
const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 30_000;
export const BACKLOG_WARN_BYTES = 200 * 1024 * 1024;

const BITRATES: Record<RecordingStream, { video: number; audio?: number }> = {
  camera: { video: 350_000, audio: 48_000 },
  screen: { video: 900_000 },
};

type Listener = () => void;

class SegmentUploader {
  private queue: { seq: number; blob: Blob }[] = [];
  private nextSeq = 0;
  private pumping = false;
  private backoff = BACKOFF_MIN;
  private finalRequested = false;
  private finished = false;
  private waiters: (() => void)[] = [];
  private recorderActive = true;
  error: string | null = null;
  lastAckAt: number | null = null;

  constructor(
    private readonly token: string,
    readonly segmentId: string,
    readonly stream: RecordingStream,
    private readonly client: ApiClient,
    private readonly onChange: Listener,
  ) {}

  get pendingBytes() {
    return this.queue.reduce((n, c) => n + c.blob.size, 0);
  }
  get pendingChunks() {
    return this.queue.length;
  }
  get done() {
    return this.finished;
  }

  enqueue(blob: Blob) {
    if (this.finished || blob.size === 0) return;
    this.queue.push({ seq: this.nextSeq++, blob });
    this.onChange();
    void this.pump();
  }

  /** No more chunks will arrive (the recorder fired `stop`): drain the queue, then POST stop. */
  finalize(): Promise<void> {
    this.finalRequested = true;
    this.recorderActive = false;
    void this.pump();
    return this.whenFinished();
  }

  /** v1.3: the link is dead. Drop every pending chunk, never talk to the server again. */
  abort() {
    this.queue = [];
    this.finalRequested = false;
    this.recorderActive = false;
    this.finished = true;
    for (const w of this.waiters) w();
    this.waiters = [];
    this.onChange();
  }

  /** Resolves once the segment is drained and stopped server-side. */
  whenFinished(): Promise<void> {
    if (this.finished) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** The recorder was told to stop; its final `dataavailable` + `stop` will call finalize(). */
  get stopping() {
    return this.finalRequested || !this.recorderActive;
  }

  private async pump() {
    if (this.pumping || this.finished) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const head = this.queue[0];
        try {
          await this.client.putChunk(this.token, this.segmentId, head.seq, head.blob);
          this.queue.shift();
          this.backoff = BACKOFF_MIN;
          this.error = null;
          this.lastAckAt = Date.now();
          this.onChange();
        } catch (e) {
          const expected = e instanceof ApiError && e.status === 409 ? (e.data as { expected?: number } | undefined)?.expected : undefined;
          if (typeof expected === 'number') {
            // Resync: the server already has everything below `expected`.
            while (this.queue.length > 0 && this.queue[0].seq < expected) this.queue.shift();
            if (this.queue.length > 0 && this.queue[0].seq > expected) {
              // A gap we cannot fill (earlier chunks were acked and dropped). Renumber from what
              // the server expects so the rest of the recording is still kept.
              let seq = expected;
              for (const c of this.queue) c.seq = seq++;
              this.nextSeq = seq;
            }
            this.onChange();
            continue;
          }
          if (e instanceof ApiError && (e.status === 404 || e.status === 413)) {
            // Segment gone or chunk refused for good: drop it rather than loop forever.
            this.queue.shift();
            this.error = e.message;
            this.onChange();
            continue;
          }
          this.error = e instanceof Error ? e.message : 'upload failed';
          this.onChange();
          // 429: honour Retry-After without growing the backoff; anything else backs off 1 s → 30 s.
          const wait = e instanceof ApiError && e.status === 429 ? Math.max(250, e.retryAfterMs ?? 1000) : this.backoff;
          await new Promise((r) => setTimeout(r, wait));
          if (!(e instanceof ApiError && e.status === 429)) this.backoff = Math.min(BACKOFF_MAX, this.backoff * 2);
        }
      }
      if (this.finalRequested) {
        for (;;) {
          try {
            await this.client.stopRecording(this.token, this.segmentId);
            break;
          } catch (e) {
            if (e instanceof ApiError && e.status < 500 && e.status !== 429) break;
            await new Promise((r) => setTimeout(r, e instanceof ApiError && e.status === 429 ? Math.max(250, e.retryAfterMs ?? 1000) : this.backoff));
            this.backoff = Math.min(BACKOFF_MAX, this.backoff * 2);
          }
        }
        this.finished = true;
        for (const w of this.waiters) w();
        this.waiters = [];
        this.onChange();
      }
    } finally {
      this.pumping = false;
      // Chunks that arrived while the stop request was in flight.
      if (!this.finished && (this.queue.length > 0 || this.finalRequested)) void this.pump();
    }
  }
}

export type StreamStatus = 'none' | 'live' | 'stopped';

export interface RecordingSnapshot {
  camera: StreamStatus;
  screen: StreamStatus;
  /** Both streams are captured and their recorders run. */
  recording: boolean;
  pendingBytes: number;
  pendingChunks: number;
  uploadError: string | null;
  /** stopAll() has run and every segment is stopped server-side. */
  finished: boolean;
  stopping: boolean;
}

interface Active {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  uploader: SegmentUploader | null;
}

export class RecordingController {
  private listeners = new Set<Listener>();
  private snapshot: RecordingSnapshot = {
    camera: 'none',
    screen: 'none',
    recording: false,
    pendingBytes: 0,
    pendingChunks: 0,
    uploadError: null,
    finished: false,
    stopping: false,
  };
  private active: Partial<Record<RecordingStream, Active>> = {};
  private uploaders: SegmentUploader[] = [];
  private stopped = false;

  constructor(
    private readonly token: string,
    private readonly client: ApiClient,
    private readonly media: MediaLayer,
    private readonly onEvent: (type: IntegrityEventType, detail?: string) => void,
  ) {}

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snapshot;

  cameraStream(): MediaStream | null {
    return this.active.camera?.stream ?? null;
  }

  private emit(patch: Partial<RecordingSnapshot> = {}) {
    const pendingBytes = this.uploaders.reduce((n, u) => n + u.pendingBytes, 0);
    const pendingChunks = this.uploaders.reduce((n, u) => n + u.pendingChunks, 0);
    const uploadError = this.uploaders.find((u) => u.error)?.error ?? null;
    const finished = this.stopped && this.uploaders.every((u) => u.done);
    this.snapshot = { ...this.snapshot, ...patch, pendingBytes, pendingChunks, uploadError, finished };
    for (const l of this.listeners) l();
  }

  private onChange = () => this.emit();

  /** Capture a stream (camera or screen). Recording starts once both are present. */
  async capture(kind: RecordingStream): Promise<void> {
    if (this.stopped) return;
    const stream = kind === 'camera' ? await this.media.getCamera() : await this.media.getScreen();
    const entry: Active = { stream, recorder: null, uploader: null };
    this.active[kind] = entry;
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => this.onTrackEnded(kind, entry), { once: true });
    }
    this.emit({ [kind]: 'live' });
    if (this.snapshot.recording || this.stopped) {
      // Re-share after a stop: new server segment straight away.
      await this.startSegment(kind, entry);
      if (kind === 'screen') this.onEvent('screen_share_resumed');
    } else if (this.active.camera && this.active.screen) {
      await Promise.all([this.startSegment('camera', this.active.camera), this.startSegment('screen', this.active.screen)]);
      this.emit({ recording: true });
      this.onEvent('devices_ready');
    }
  }

  private async startSegment(kind: RecordingStream, entry: Active) {
    if (this.stopped) return;
    const mimeType = this.media.mimeType(kind === 'camera') ?? 'video/webm';
    const { segmentId } = await this.client.startRecording(this.token, { stream: kind, mimeType });
    const uploader = new SegmentUploader(this.token, segmentId, kind, this.client, this.onChange);
    this.uploaders.push(uploader);
    const opts: MediaRecorderOptions = { mimeType, videoBitsPerSecond: BITRATES[kind].video };
    if (BITRATES[kind].audio) opts.audioBitsPerSecond = BITRATES[kind].audio;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(entry.stream, opts);
    } catch {
      recorder = new MediaRecorder(entry.stream);
    }
    recorder.ondataavailable = (e) => uploader.enqueue(e.data);
    recorder.onstop = () => void uploader.finalize();
    recorder.onerror = () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* already stopped */
      }
    };
    entry.recorder = recorder;
    entry.uploader = uploader;
    recorder.start(TIMESLICE_MS);
    this.emit();
  }

  private onTrackEnded(kind: RecordingStream, entry: Active) {
    if (this.active[kind] !== entry) return;
    this.stopEntry(entry);
    delete this.active[kind];
    this.emit({ [kind]: 'stopped' });
    if (!this.stopped) this.onEvent(kind === 'screen' ? 'screen_share_stopped' : 'camera_stopped');
  }

  /**
   * Stop an entry's recorder. Its final `dataavailable` arrives asynchronously, then `stop` →
   * uploader.finalize(); only when the recorder is already inactive do we finalize directly.
   */
  private stopEntry(entry: Active) {
    try {
      if (entry.recorder && entry.recorder.state !== 'inactive') entry.recorder.stop();
      else if (entry.uploader) void entry.uploader.finalize();
    } catch {
      if (entry.uploader) void entry.uploader.finalize();
    }
    for (const t of entry.stream.getTracks()) t.stop();
  }

  /** Session ended: stop recorders, flush every queue, POST stop per segment. Idempotent. */
  async stopAll(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.emit({ stopping: true, recording: false });
    for (const kind of ['camera', 'screen'] as RecordingStream[]) {
      const entry = this.active[kind];
      if (entry) {
        this.stopEntry(entry);
        delete this.active[kind];
      }
    }
    this.emit({ camera: 'none', screen: 'none' });
    // Wait for each segment's onstop → finalize → drained + stopped. A recorder that never
    // fires `stop` (edge case) is finalized after a grace period so the page can finish.
    const grace = window.setTimeout(() => {
      for (const u of this.uploaders) if (!u.done) void u.finalize();
    }, 5000);
    await Promise.all(this.uploaders.map((u) => u.whenFinished()));
    window.clearTimeout(grace);
    this.emit({ stopping: false });
  }

  /**
   * v1.3: the link stopped being valid (the interviewer cancelled it). Stop recorders and tracks,
   * drop every pending chunk and make no further request. Idempotent; stopAll() afterwards is a no-op.
   */
  abort(): void {
    this.stopped = true;
    for (const kind of ['camera', 'screen'] as RecordingStream[]) {
      const entry = this.active[kind];
      if (!entry) continue;
      delete this.active[kind];
      try {
        if (entry.recorder) {
          entry.recorder.ondataavailable = null;
          entry.recorder.onstop = null;
          if (entry.recorder.state !== 'inactive') entry.recorder.stop();
        }
      } catch {
        /* already stopped */
      }
      for (const t of entry.stream.getTracks()) t.stop();
    }
    for (const u of this.uploaders) u.abort();
    this.emit({ camera: 'none', screen: 'none', recording: false, stopping: false });
  }

  /** True while the page should warn before unload. */
  busy(): boolean {
    return this.snapshot.recording || this.snapshot.pendingChunks > 0 || (this.stopped && !this.snapshot.finished);
  }
}

export function fmtMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
