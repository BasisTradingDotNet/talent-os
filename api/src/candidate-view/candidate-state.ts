/**
 * SECURITY-CRITICAL. Builds the only payload an unauthenticated request can receive.
 * Every field is assigned explicitly from an allowlisted source — never spread a DB row here.
 */
import type { CandidatePhase, CandidateQuestion, CandidateState, Dataset, CodeBlock } from '../contracts/api';

export interface CandidateStateSection {
  candidateLabel: string;
  showInstructions: boolean;
}

/** The only question fields the candidate view may read. */
export interface CandidateStateQuestion {
  key: string;
  prompt: string;
  dataset: Dataset | null;
  code: CodeBlock | null;
  timeMinutes: number | null;
}

export interface CandidateStateInput {
  orgName: string;
  section: CandidateStateSection;
  candidateInstructions: string;
  status: string;
  presentedQuestionKey: string | null;
  presentedAt: Date | null;
  version: number;
  /** The section's questions in running order. */
  sectionQuestions: CandidateStateQuestion[];
  now: Date;
}

export function phaseFor(status: string, presentedQuestionKey: string | null): CandidatePhase {
  if (status === 'ready') return 'waiting';
  if (status === 'completed') return 'ended';
  return presentedQuestionKey ? 'question' : 'intro';
}

export function buildCandidateState(input: CandidateStateInput): CandidateState {
  const phase = phaseFor(input.status, input.presentedQuestionKey);

  let question: CandidateQuestion | null = null;
  if (phase === 'question' && input.presentedQuestionKey) {
    const idx = input.sectionQuestions.findIndex((q) => q.key === input.presentedQuestionKey);
    if (idx >= 0) {
      const q = input.sectionQuestions[idx];
      const dataset: Dataset | null = q.dataset ? { format: 'csv', text: String(q.dataset.text ?? '') } : null;
      const code: CodeBlock | null = q.code
        ? { language: String(q.code.language ?? ''), text: String(q.code.text ?? '') }
        : null;
      question = {
        position: idx + 1,
        total: input.sectionQuestions.length,
        prompt: q.prompt,
        dataset,
        code,
        timeMinutes: q.timeMinutes ?? null,
      };
    }
  }

  const state: CandidateState = {
    phase,
    orgName: input.orgName,
    sectionLabel: input.section.candidateLabel,
    instructions: phase === 'intro' && input.section.showInstructions ? input.candidateInstructions : null,
    question,
    presentedAt: phase === 'question' && input.presentedAt ? input.presentedAt.toISOString() : null,
    serverNow: input.now.toISOString(),
    version: input.version,
  };
  return state;
}
