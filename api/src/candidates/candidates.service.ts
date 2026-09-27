import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CandidateDetail, CandidateSummary, CreateCandidate, SessionSummary, UpdateCandidate } from '../contracts/api';
import { KitService } from '../kit/kit.service';
import { PrismaService } from '../prisma/prisma.service';
import { KitCache, SESSION_INCLUDE, SessionRow, toSummary } from '../sessions/sessions.service';

const CANDIDATE_INCLUDE = {
  apps: { include: { sessions: { include: SESSION_INCLUDE } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CandidateInclude;

type CandidateRow = Prisma.CandidateGetPayload<{ include: typeof CANDIDATE_INCLUDE }>;

@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService, private readonly kits: KitService) {}

  /** Every session of the candidate across applications, newest first. */
  static sessionsOf(c: CandidateRow): SessionRow[] {
    return c.apps
      .flatMap((a) => a.sessions)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  }

  async toDetail(c: CandidateRow, cache: KitCache): Promise<CandidateDetail> {
    const rows = CandidatesService.sessionsOf(c);
    const seen = new Set<string>();
    const sessions: SessionSummary[] = [];
    const latest: Record<string, SessionSummary> = {};
    let stageReached = 0;
    for (const row of rows) {
      const kit = await cache.get(row.kitId);
      const superseded = seen.has(row.section);
      seen.add(row.section);
      const summary = toSummary(row, kit, superseded);
      sessions.push(summary);
      if (!superseded) latest[row.section] = summary;
      const stage = kit.sections.find((s) => s.key === row.section)?.stage ?? 0;
      if (stage > stageReached) stageReached = stage;
    }
    return {
      id: c.id,
      applicationId: c.apps[0]?.id ?? '',
      name: c.name,
      email: c.email ?? null,
      source: c.source ?? null,
      createdAt: c.createdAt.toISOString(),
      stageReached,
      latest,
      overallDecision: c.overallDecision ?? null,
      notes: c.notes ?? null,
      level: c.level ?? null,
      compNote: c.compNote ?? null,
      sessions,
    };
  }

  static toSummary(d: CandidateDetail): CandidateSummary {
    return {
      id: d.id,
      applicationId: d.applicationId,
      name: d.name,
      email: d.email,
      source: d.source,
      createdAt: d.createdAt,
      stageReached: d.stageReached,
      latest: d.latest,
      overallDecision: d.overallDecision,
    };
  }

  async listDetails(orgId: string): Promise<CandidateDetail[]> {
    const rows = await this.prisma.candidate.findMany({
      where: { orgId },
      include: CANDIDATE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const cache = new KitCache(this.kits, orgId);
    const out: CandidateDetail[] = [];
    for (const c of rows) out.push(await this.toDetail(c, cache));
    return out;
  }

  async list(orgId: string): Promise<CandidateSummary[]> {
    return (await this.listDetails(orgId)).map(CandidatesService.toSummary);
  }

  async rowOf(orgId: string, id: string): Promise<CandidateRow> {
    const c = await this.prisma.candidate.findFirst({ where: { id, orgId }, include: CANDIDATE_INCLUDE });
    if (!c) throw new NotFoundException('candidate not found');
    return c;
  }

  async get(orgId: string, id: string): Promise<CandidateDetail> {
    return this.toDetail(await this.rowOf(orgId, id), new KitCache(this.kits, orgId));
  }

  async create(orgId: string, body: CreateCandidate): Promise<CandidateDetail> {
    const kit = await this.kits.activeKit(orgId);
    const c = await this.prisma.candidate.create({
      data: {
        orgId,
        name: body.name,
        email: body.email ?? null,
        source: body.source ?? null,
        notes: body.notes ?? null,
        apps: { create: { orgId, jobId: kit.row.jobId } },
      },
    });
    return this.get(orgId, c.id);
  }

  async patch(orgId: string, id: string, body: UpdateCandidate): Promise<CandidateDetail> {
    await this.rowOf(orgId, id);
    const data: Prisma.CandidateUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = body.email;
    if (body.source !== undefined) data.source = body.source;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.overallDecision !== undefined) data.overallDecision = body.overallDecision;
    if (body.level !== undefined) data.level = body.level;
    if (body.compNote !== undefined) data.compNote = body.compNote;
    await this.prisma.candidate.update({ where: { id }, data });
    return this.get(orgId, id);
  }
}
