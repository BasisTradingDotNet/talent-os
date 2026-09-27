/**
 * SECURITY-CRITICAL. Builds the only payload an unauthenticated request can receive.
 * Every field is assigned explicitly from an allowlisted source — never spread a DB row here.
 */
import type {
  AutoScoring,
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
  /** v1.2 */
  selfPaced: boolean;
  /** v1.2: the marking scheme for scoring 'auto'; null otherwise. */
  autoScoring: AutoScoring | null;
  /** v1.2: section-level candidate instructions; overrides the kit's when set. */
  candidateInstructions: string | null;
}

/** The only question fields the candidate view may read. Already in THIS candidate's display order. */
export interface CandidateStateQuestion {
  key: string;
  prompt: string;
  dataset: Dataset | null;
  code: CodeBlock | null;
  timeMinutes: number | null;
  /** v1.2: options in display order; null unless multiple choice. */
  choices: string[] | null;
}

/** The candidate's own typed answer / choice for the presented question (from the Response row). */
export interface CandidateStateAnswer {
  candidateAnswer: string | null;
  candidateAnswerAt: Date | null;
  /** v1.2: DISPLAY index of the selected option (already mapped from canonical); null = none. */
  displayChoice: number | null;
}

export interface CandidateStateInput {
  orgName: string;
  section: CandidateStateSection;
  candidateInstructions: string;
  status: string;
  presentedQuestionKey: string | null;
  presentedAt: Date | null;
  version: number;
  /** The section's questions in display order. */
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
  /** v1.2: display positions (1-based) the candidate has answered. */
  answeredPositions: number[];
}

export function phaseFor(status: string, presentedQuestionKey: string | null): CandidatePhase {
  if (status === 'ready') return 'waiting';
  if (status === 'completed') return 'ended';
  return presentedQuestionKey ? 'question' : 'intro';
}

export function buildCandidateState(input: CandidateStateInput): CandidateState {
  const phase = phaseFor(input.status, input.presentedQuestionKey);

  let question: CandidateQuestion | null = null;
  let presentedChoices: string[] | null = null;
  if (phase === 'question' && input.presentedQuestionKey) {
    const idx = input.sectionQuestions.findIndex((q) => q.key === input.presentedQuestionKey);
    if (idx >= 0) {
      const q = input.sectionQuestions[idx];
      const dataset: Dataset | null = q.dataset ? { format: 'csv', text: String(q.dataset.text ?? '') } : null;
      const code: CodeBlock | null = q.code
        ? { language: String(q.code.language ?? ''), text: String(q.code.text ?? '') }
        : null;
      presentedChoices = Array.isArray(q.choices) ? q.choices.map((c) => String(c)) : null;
      question = {
        position: idx + 1,
        total: input.sectionQuestions.length,
        prompt: q.prompt,
        dataset,
        code,
        timeMinutes: q.timeMinutes ?? null,
        choices: presentedChoices,
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
    const dc = input.presentedAnswer?.displayChoice;
    answer = {
      text: input.presentedAnswer?.candidateAnswer ?? '',
      savedAt: input.presentedAnswer?.candidateAnswerAt ? input.presentedAnswer.candidateAnswerAt.toISOString() : null,
      choice: presentedChoices && typeof dc === 'number' && dc >= 0 && dc < presentedChoices.length ? dc : null,
    };
  }

  const instructionsText = input.section.candidateInstructions ?? input.candidateInstructions;
  const marking = input.section.autoScoring;

  const state: CandidateState = {
    phase,
    orgName: input.orgName,
    sectionLabel: input.section.candidateLabel,
    instructions: phase === 'intro' && input.section.showInstructions ? instructionsText : null,
    question,
    presentedAt: phase === 'question' && input.presentedAt ? input.presentedAt.toISOString() : null,
    serverNow: input.now.toISOString(),
    version: input.version,
    recording,
    answer,
    sectionEndsAt: input.sectionEndsAt ? input.sectionEndsAt.toISOString() : null,
    selfPaced: !!input.section.selfPaced,
    answeredPositions: [...new Set(input.answeredPositions.filter((p) => Number.isInteger(p) && p >= 1))].sort((a, b) => a - b),
    marking: marking ? { correct: marking.correct, wrong: marking.wrong, blank: marking.blank } : null,
    market: null, // WIRE(market): CandidateMarket for market sections
  };
  return state;
}
