import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { cfg } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { seedKitFile } from './seed-kit';

/** On boot: seed KIT_SEED_PATH when set and present. Never overwrites; logs and continues on failure. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { kitSeedPath, defaultOrgSlug } = cfg();
    if (!kitSeedPath) return;
    if (!existsSync(kitSeedPath)) {
      this.logger.warn(`KIT_SEED_PATH ${kitSeedPath} not found; skipping seed`);
      return;
    }
    try {
      const r = await seedKitFile(this.prisma, kitSeedPath, { orgSlug: defaultOrgSlug, force: false });
      this.logger.log(`kit seed ${r.action} (${r.kitId})`);
    } catch (e) {
      this.logger.error(`kit seed failed: ${(e as Error).message}`);
    }
  }
}
