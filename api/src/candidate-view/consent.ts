import type { IntegrityEventType } from '../contracts/api';

/** Bump when the wording changes; stored on the session as consentVersion. */
export const CONSENT_VERSION = 'rec-consent-v1';

/** The plain-text notice the candidate accepts. Interpolates only the org name and retention days. */
export function consentText(orgName: string, retentionDays: number): string {
  return (
    'This part of your interview is recorded. If you continue, we will record your camera, your ' +
    'microphone and your entire screen from now until the test ends, and save the answers you type ' +
    'here. We use the recording only to review your test fairly and to check that the work is your ' +
    `own. Only the ${orgName} hiring team can see it, and it is deleted ${retentionDays} days after a ` +
    "hiring decision is made. If you can't be recorded or need an adjustment, tell your interviewer " +
    'before you continue.'
  );
}

/** Runtime mirror of the contract's IntegrityEventType union (the contract is types-only). */
export const INTEGRITY_EVENT_TYPES = [
  'page_loaded',
  'consent_given',
  'devices_ready',
  'screen_share_stopped',
  'screen_share_resumed',
  'camera_stopped',
  'tab_hidden',
  'tab_visible',
  'window_blur',
  'window_focus',
  'paste',
  'copy',
] as const satisfies readonly IntegrityEventType[];

// Compile-time check that the list above is exhaustive.
type MissingEventType = Exclude<IntegrityEventType, (typeof INTEGRITY_EVENT_TYPES)[number]>;
const _exhaustive: MissingEventType extends never ? true : never = true;
void _exhaustive;

/** Event types counted as SessionSummary.integrityFlags. */
export const INTEGRITY_FLAG_TYPES: readonly IntegrityEventType[] = [
  'tab_hidden',
  'window_blur',
  'paste',
  'screen_share_stopped',
  'camera_stopped',
];

export const EVENT_DETAIL_MAX = 100;
export const EVENTS_PER_CALL_MAX = 50;
export const EVENTS_PER_SESSION_MAX = 5000;
export const ANSWER_MAX_CHARS = 20000;
/** Final autosave window after the interviewer ends the session. */
export const ANSWER_GRACE_AFTER_END_MS = 60_000;
/** v1.1: grace after sectionEndsAt for the final autosave. */
export const ANSWER_GRACE_AFTER_TIME_UP_MS = 15_000;
/** Final upload window after the interviewer ends the session. */
export const CHUNK_GRACE_AFTER_END_MS = 10 * 60_000;
export const SEGMENTS_PER_SESSION_MAX = 200;
export const BYTES_PER_SESSION_MAX = 6n * 1024n * 1024n * 1024n;

export function isEventType(v: unknown): v is IntegrityEventType {
  return typeof v === 'string' && (INTEGRITY_EVENT_TYPES as readonly string[]).includes(v);
}
