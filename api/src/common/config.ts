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
  };
}
