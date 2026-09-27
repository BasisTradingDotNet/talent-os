import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { CandidateDetail, CandidateScorecard } from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';
import { CandidatesService } from '../candidates/candidates.service';
import { KitService } from '../kit/kit.service';
import { PrismaService } from '../prisma/prisma.service';
import { KitCache, SESSION_INCLUDE, toSession } from '../sessions/sessions.service';

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per candidate; per-section columns derived from the kit's sections. */
export function buildCandidatesCsv(sections: SectionSeed[], candidates: CandidateDetail[]): string {
  const header = ['id', 'name', 'email', 'source', 'created_at', 'stage_reached', 'overall_decision', 'level'];
  const cols: Array<(c: CandidateDetail) => unknown> = [
    (c) => c.id,
    (c) => c.name,
    (c) => c.email,
    (c) => c.source,
    (c) => c.createdAt,
    (c) => c.stageReached,
    (c) => c.overallDecision,
    (c) => c.level,
  ];
  for (const s of sections) {
    const k = s.key;
    if (s.scoring === 'rubric') {
      header.push(`${k}_total`);
      cols.push((c) => c.latest[k]?.verdict?.total);
      for (const g of s.domainGroups ?? []) {
        header.push(`${k}_${g.domain}`);
        cols.push((c) => c.latest[k]?.verdict?.subtotals.find((x) => x.domain === g.domain)?.total);
      }
      header.push(`${k}_traps`, `${k}_bonuses`, `${k}_result`);
      cols.push((c) => c.latest[k]?.trapsNoticed);
      cols.push((c) => c.latest[k]?.bonusesGiven);
      cols.push((c) => (c.latest[k]?.verdict?.complete ? c.latest[k].verdict?.result : undefined));
    } else {
      for (const d of s.dimensionIds ?? []) {
        header.push(`${k}_dim${d}`);
        cols.push((c) => c.latest[k]?.ratings.find((r) => r.dimensionId === d)?.rating);
      }
    }
    if ((s.recommendationOptions ?? []).length > 0) {
      header.push(`${k}_recommendation`);
      cols.push((c) => c.latest[k]?.recommendation);
    }
  }
  const lines = [header.map(csvCell).join(',')];
  for (const c of candidates) lines.push(cols.map((f) => csvCell(f(c))).join(','));
  return lines.join('\r\n') + '\r\n';
}

@Controller('export')
export class ExportsController {
  constructor(
    private readonly kits: KitService,
    private readonly candidates: CandidatesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('candidates.csv')
  async csv(@Res() res: Response): Promise<void> {
    const org = await this.kits.org();
    const kit = await this.kits.activeKit(org.id);
    const csv = buildCandidatesCsv(kit.sections, await this.candidates.listDetails(org.id));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="candidates.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }

  @Get('candidates/:id.json')
  async json(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const org = await this.kits.org();
    const kit = await this.kits.activeKit(org.id);
    const candidate = await this.candidates.get(org.id, id);
    const rows = await this.prisma.session.findMany({
      where: { orgId: org.id, application: { candidateId: id } },
      include: SESSION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const cache = new KitCache(this.kits, org.id);
    const now = new Date();
    const sessions = [];
    for (const row of rows) sessions.push(toSession(row, await cache.get(row.kitId), now));
    const scorecard: CandidateScorecard = {
      exportedAt: now.toISOString(),
      kit: { slug: kit.row.slug, version: kit.row.version, title: kit.row.title },
      candidate,
      sessions,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="candidate-${id}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(scorecard, null, 2));
  }
}
