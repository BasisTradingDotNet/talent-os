import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CandidateViewService } from '../candidate-view/candidate-view.service';
import { KitService } from '../kit/kit.service';
import { SessionsService } from '../sessions/sessions.service';

/**
 * The AppModule services this module builds on. They are AppModule providers (not exported from a
 * module), and RecordingsService — a transitive dependency — owns a named cron job, so a second
 * instance would crash the scheduler. Resolve the existing singletons lazily instead.
 */
@Injectable()
export class MarketPeers {
  constructor(private readonly ref: ModuleRef) {}

  get candidateView(): CandidateViewService {
    return this.ref.get(CandidateViewService, { strict: false });
  }

  get sessions(): SessionsService {
    return this.ref.get(SessionsService, { strict: false });
  }

  get kits(): KitService {
    return this.ref.get(KitService, { strict: false });
  }
}
