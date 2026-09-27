import { resolve } from 'node:path';

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Environment, read lazily so tests can set variables before the first call. */
export function cfg() {
  const env = process.env;
  return {
    port: Number(env.PORT ?? 4310),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:8170').replace(/\/+$/, ''),
    defaultOrgSlug: env.DEFAULT_ORG_SLUG || 'g20',
    devUserEmail: env.DEV_USER_EMAIL || null,
    accessTeamDomain: env.ACCESS_TEAM_DOMAIN || null,
    accessAud: env.ACCESS_AUD || null,
    kitSeedPath: env.KIT_SEED_PATH || null,
    activeKitSlug: env.ACTIVE_KIT_SLUG || null,
    /** v1: where candidate recordings are stored (a volume in production). Absolute. */
    recordingsDir: resolve(env.RECORDINGS_DIR || 'recordings'),
    /**
     * The name candidates see (page header, consent notice) when it must differ from the internal
     * org name — e.g. hiring under the BTNET brand without disclosing the parent group.
     */
    candidateBrand: (env.CANDIDATE_BRAND ?? '').trim() || null,
    /** v1: recordings are deleted this many days after the hiring decision. */
    recordingRetentionDays: int(env.RECORDING_RETENTION_DAYS, 90),
    /** v1: per-token rate limit on /api/candidate/* (token bucket). */
    candidateRateBurst: int(env.CANDIDATE_RATE_BURST, 20),
    candidateRatePerSecond: int(env.CANDIDATE_RATE_PER_SECOND, 20),
  };
}
