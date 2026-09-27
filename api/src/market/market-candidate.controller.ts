import { Body, Controller, Header, Param, Put, UseGuards } from '@nestjs/common';
import type { CandidateState } from '../contracts/api';
import { CandidateRateLimitGuard } from '../candidate-view/rate-limit';
import { asObject, bad } from '../common/validate';
import { Public } from '../identity/identity.guard';
import { MarketPeers } from './market-peers';
import { MarketService } from './market.service';

export const QUOTE_SIZE_MAX = 100;

/**
 * PUBLIC, token-gated, rate-limited per token (same guard and limits as the candidate view). The
 * only thing it returns is CandidateState with the allowlisted CandidateMarket.
 */
@Public()
@UseGuards(CandidateRateLimitGuard)
@Controller('candidate')
export class MarketCandidateController {
  constructor(private readonly market: MarketService, private readonly peers: MarketPeers) {}

  /** 400 unless bid < ask, both finite, size an integer 1–100; 409 when no game is open. */
  @Put(':token/quote')
  @Header('Cache-Control', 'no-store')
  async quote(@Param('token') token: string, @Body() body: unknown): Promise<CandidateState> {
    const o = asObject(body);
    const { bid, ask, size } = o;
    if (typeof bid !== 'number' || !Number.isFinite(bid)) bad('bid must be a finite number');
    if (typeof ask !== 'number' || !Number.isFinite(ask)) bad('ask must be a finite number');
    if (!(bid < ask)) bad('bid must be below ask');
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > QUOTE_SIZE_MAX) {
      bad(`size must be an integer between 1 and ${QUOTE_SIZE_MAX}`);
    }
    const view = this.peers.candidateView;
    const ts = await view.load(token);
    await this.market.quote(ts, bid, ask, size);
    const state = await view.state(await view.load(token));
    return { ...state, market: await this.market.candidateMarket(ts.session.id) };
  }
}
