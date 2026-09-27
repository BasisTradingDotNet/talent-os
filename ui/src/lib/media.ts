/**
 * Media capture behind an interface so tests can inject fake streams. The fake layer is only
 * compiled into dev / mock builds (`import.meta.env.DEV || VITE_MOCK=1`) and only used when the
 * page sets `window.__talentOsFakeMedia = true` (Playwright does this with addInitScript). A
 * production bundle never contains it, so a candidate cannot swap their screen for a canvas.
 */
import { IS_MOCK } from '../api/client';

export class NotMonitorError extends Error {
  constructor() {
    super('Please choose Entire screen');
    this.name = 'NotMonitorError';
  }
}

export interface MediaLayer {
  /** getDisplayMedia + MediaRecorder exist (Chrome / Edge on a laptop or desktop). */
  supported(): boolean;
  /** Webcam 640×360 @ 15 fps + microphone. */
  getCamera(): Promise<MediaStream>;
  /** Entire screen @ 5 fps, no audio. Rejects with NotMonitorError if the user picked a window or tab. */
  getScreen(): Promise<MediaStream>;
  /** First supported MediaRecorder mimeType for a stream with/without audio, or null. */
  mimeType(withAudio: boolean): string | null;
}

const MIME_WITH_AUDIO = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const MIME_VIDEO_ONLY = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

function pickMimeType(withAudio: boolean): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of withAudio ? MIME_WITH_AUDIO : MIME_VIDEO_ONLY) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

const realMedia: MediaLayer = {
  supported: () =>
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
    typeof MediaRecorder !== 'undefined',
  getCamera: () => navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 15 }, audio: true }),
  async getScreen() {
    const options = {
      video: { displaySurface: 'monitor', frameRate: 5 },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'include',
    } as unknown as DisplayMediaStreamOptions;
    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    const track = stream.getVideoTracks()[0];
    const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
    if (surface !== undefined && surface !== 'monitor') {
      for (const t of stream.getTracks()) t.stop();
      throw new NotMonitorError();
    }
    return stream;
  },
  mimeType: pickMimeType,
};

declare global {
  interface Window {
    __talentOsFakeMedia?: boolean;
    __talentOsFake?: { endScreen(): void; endCamera(): void };
  }
}

const FAKE_ALLOWED = import.meta.env.DEV || IS_MOCK;

/** Canvas + WebAudio oscillator streams that behave like real capture, including `ended`. */
function createFakeMedia(): MediaLayer {
  let screenStream: MediaStream | null = null;
  let cameraStream: MediaStream | null = null;
  const end = (s: MediaStream | null) => {
    for (const t of s?.getTracks() ?? []) {
      t.stop();
      t.dispatchEvent(new Event('ended'));
    }
  };
  window.__talentOsFake = { endScreen: () => end(screenStream), endCamera: () => end(cameraStream) };

  const canvasStream = (w: number, h: number, fps: number, label: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      ctx.fillStyle = label === 'screen' ? '#0f172a' : '#1d4ed8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(h / 8)}px sans-serif`;
      ctx.fillText(`${label} ${new Date().toLocaleTimeString()}`, 10, h / 2);
      requestAnimationFrame(draw);
    };
    draw();
    return canvas.captureStream(fps);
  };

  return {
    supported: () => true,
    async getCamera() {
      const stream = canvasStream(320, 180, 15, 'camera');
      try {
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        gain.gain.value = 0.01;
        const dest = ac.createMediaStreamDestination();
        osc.connect(gain).connect(dest);
        osc.start();
        for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      } catch {
        /* no audio in this environment */
      }
      cameraStream = stream;
      return stream;
    },
    async getScreen() {
      screenStream = canvasStream(640, 360, 5, 'screen');
      return screenStream;
    },
    mimeType: (withAudio) => pickMimeType(withAudio) ?? 'video/webm',
  };
}

let layer: MediaLayer | null = null;

export function getMediaLayer(): MediaLayer {
  if (!layer) layer = FAKE_ALLOWED && window.__talentOsFakeMedia ? createFakeMedia() : realMedia;
  return layer;
}
