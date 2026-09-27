import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import type { CandidateState } from '../contracts/api';
import type { SectionSeed } from '../contracts/kit-seed';
import { Public } from '../identity/identity.guard';
import { PrismaService } from '../prisma/prisma.service';
import { buildCandidateState } from './candidate-state';

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * PUBLIC, token-gated. The only unauthenticated data endpoint: returns CandidateState and
 * nothing else. Loads only the allowlisted question columns from the database.
 */
@Public()
@Controller('candidate')
export class CandidateViewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':token/state')
  @Header('Cache-Control', 'no-store')
  async state(@Param('token') token: string): Promise<CandidateState> {
    if (!TOKEN.test(token)) throw new NotFoundException();
    const session = await this.prisma.session.findUnique({
      where: { candidateToken: token },
      select: {
        section: true,
        status: true,
        presentedQuestionKey: true,
        presentedAt: true,
        version: true,
        org: { select: { name: true } },
        kit: { select: { candidateInstructions: true, sections: true } },
      },
    });
    if (!session) throw new NotFoundException();
    const section = ((session.kit.sections as unknown as SectionSeed[]) ?? []).find((s) => s.key === session.section);
    if (!section || !section.candidateView) throw new NotFoundException();
    const questions = await this.prisma.question.findMany({
      where: { kit: { sessions: { some: { candidateToken: token } } }, section: session.section },
      select: { key: true, prompt: true, dataset: true, code: true, timeMinutes: true },
      orderBy: { number: 'asc' },
    });
    return buildCandidateState({
      orgName: session.org.name,
      section: { candidateLabel: section.candidateLabel, showInstructions: !!section.showInstructions },
      candidateInstructions: session.kit.candidateInstructions,
      status: session.status,
      presentedQuestionKey: session.presentedQuestionKey,
      presentedAt: session.presentedAt,
      version: session.version,
      sectionQuestions: questions.map((q) => ({
        key: q.key,
        prompt: q.prompt,
        dataset: (q.dataset as { format: 'csv'; text: string } | null) ?? null,
        code: (q.code as { language: string; text: string } | null) ?? null,
        timeMinutes: q.timeMinutes ?? null,
      })),
      now: new Date(),
    });
  }
}
