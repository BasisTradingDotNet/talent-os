import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CandidateDetail, CandidateSummary, CreateCandidate, SessionSummary, UpdateCandidate } from '../contracts/api';
import { KitService } from '../kit/kit.service';
import { PrismaService } from '../prisma/prisma.service';
import { KitCache, SESSION_SUMMARY_INCLUDE, SessionSummaryRow, toSummary } from '../sessions/sessions.service';

const CANDIDATE_INCLUDE = {
  apps: { include: { sessions: { include: SESSION_SUMMARY_INCLUDE } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CandidateInclude;

type CandidateRow = Prisma.CandidateGetPayload<{ include: typeof CANDIDATE_INCLUDE }>;

@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService, private readonly kits: KitService) {}

  /** Every session of the candidate across applications, newest first. */
  static sessionsOf(c: CandidateRow): SessionSummaryRow[] {
    return c.apps
      .flatMap((a) => a.sessions)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  }

  async toDetail(c: CandidateRow, cache: KitCache): Promise<CandidateDetail> {
    const rows = CandidatesService.sessionsOf(c); // newest first
    // A section's result is its newest session that actually ran (live or completed). A link that
    // was never started only stands in while nothing has run, so an unused link — say, Start
    // clicked twice — can never hide a real result. Sessions older than the result are superseded;
    // an unused link newer than the result is simply pending. Cancelled sessions (v1.3) are listed
    // but never a result, never superseding, and don't count towards the stage.
    const ran = (r: { status: string }) => r.status === 'live' || r.status === 'completed';
    const resultOf = new Map<string, { id: string; at: number }>();
    for (const row of rows) {
      if (ran(row) && !resultOf.has(row.section)) resultOf.set(row.section, { id: row.id, at: row.createdAt.getTime() });
    }
    for (const row of rows) {
      if (row.status === 'ready' && !resultOf.has(row.section)) resultOf.set(row.section, { id: row.id, at: row.createdAt.getTime() });
    }
    const sessions: SessionSummary[] = [];
    const latest: Record<string, SessionSummary> = {};
    let stageReached = 0;
    for (const row of rows) {
      const kit = await cache.get(row.kitId);
      const cancelled = row.status === 'cancelled';
      const result = resultOf.get(row.section);
      const superseded = !cancelled && !!result && row.id !== result.id && row.createdAt.getTime() <= result.at;
      const summary = toSummary(row, kit, superseded);
      sessions.push(summary);
      if (cancelled) continue;
      if (result && row.id === result.id) latest[row.section] = summary;
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
      decisionAt: c.decisionAt ? c.decisionAt.toISOString() : null,
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
    const current = await this.rowOf(orgId, id);
    const data: Prisma.CandidateUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = body.email;
    if (body.source !== undefined) data.source = body.source;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.overallDecision !== undefined && body.overallDecision !== (current.overallDecision ?? null)) {
      // v1: the decision starts the recording retention clock; clearing it stops the clock.
      data.overallDecision = body.overallDecision;
      data.decisionAt = body.overallDecision === null ? null : new Date();
    }
    if (body.level !== undefined) data.level = body.level;
    if (body.compNote !== undefined) data.compNote = body.compNote;
    await this.prisma.candidate.update({ where: { id }, data });
    return this.get(orgId, id);
  }
}
