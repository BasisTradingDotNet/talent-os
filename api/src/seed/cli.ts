/**
 * Seed a kit from a KitSeed JSON file.
 *   node dist/seed/cli.js <file> [--force]      (built)
 *   npm run seed -- <file> [--force]            (dev, ts-node)
 * Org slug comes from DEFAULT_ORG_SLUG (default g20).
 */
import { PrismaClient } from '@prisma/client';
import { cfg } from '../common/config';
import { seedKitFile } from './seed-kit';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: seed <kit-seed.json> [--force]');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const result = await seedKitFile(prisma, file, { orgSlug: cfg().defaultOrgSlug, force });
    console.log(`kit ${result.action}: ${result.kitId}`);
  } catch (e) {
    console.error(`seed failed: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
