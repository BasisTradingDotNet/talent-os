// Jest setupFile: isolate tests from the developer's environment.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://talent:talent@127.0.0.1:5442/talent_os_test';
process.env.PUBLIC_BASE_URL = 'http://test.local';
process.env.DEFAULT_ORG_SLUG = 'g20';
delete process.env.DEV_USER_EMAIL;
delete process.env.KIT_SEED_PATH;
delete process.env.ACCESS_TEAM_DOMAIN;
delete process.env.ACCESS_AUD;
delete process.env.ACTIVE_KIT_SLUG;
