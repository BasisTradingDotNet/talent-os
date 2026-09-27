/**
 * SECURITY-CRITICAL. Builds the only payload an unauthenticated request can receive.
 * Every field is assigned explicitly from an allowlisted source — never spread a DB row here.
 */
import type {
  CandidateAnswer,
  CandidatePhase,
  CandidateQuestion,
  CandidateRecording,
  CandidateState,
  CodeBlock,
  Dataset,
} from '../contracts/api';
import { consentText } from './consent';

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

/** The candidate's own typed answer for the presented question (from the Response row). */
export interface CandidateStateAnswer {
  candidateAnswer: string | null;
  candidateAnswerAt: Date | null;
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
  /** v1 */
  recordingRequired: boolean;
  consentAt: Date | null;
  retentionDays: number;
  /** v1: the Response row of the presented question, or null when none. */
  presentedAnswer: CandidateStateAnswer | null;
  /** v1.1: section countdown target (already computed from startedAt + minutes). */
  sectionEndsAt: Date | null;
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

  const recording: CandidateRecording = {
    required: !!input.recordingRequired,
    consentGiven: !!input.consentAt,
    consentText: input.recordingRequired ? consentText(input.orgName, input.retentionDays) : null,
  };

  let answer: CandidateAnswer | null = null;
  if (phase === 'question') {
    answer = {
      text: input.presentedAnswer?.candidateAnswer ?? '',
      savedAt: input.presentedAnswer?.candidateAnswerAt ? input.presentedAnswer.candidateAnswerAt.toISOString() : null,
    };
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
    recording,
    answer,
    sectionEndsAt: input.sectionEndsAt ? input.sectionEndsAt.toISOString() : null,
  };
  return state;
}
