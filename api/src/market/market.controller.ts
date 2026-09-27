import { Body, Controller, Param, Post } from '@nestjs/common';
import type { Session } from '../contracts/api';
import { asObject, bad, reqString } from '../common/validate';
import { MarketPeers } from './market-peers';
import { MarketService } from './market.service';

/** INTERVIEWER endpoints (behind IdentityGuard). Every call returns the full Session. */
@Controller('sessions/:id/market')
export class MarketController {
  constructor(private readonly market: MarketService, private readonly peers: MarketPeers) {}

  @Post('games')
  async start(@Param('id') id: string, @Body() body: unknown): Promise<Session> {
    const questionKey = reqString(asObject(body), 'questionKey', { max: 50 });
    const org = await this.peers.kits.org();
    await this.market.start(org.id, id, questionKey);
    return this.session(org.id, id);
  }

  @Post('games/:gameId/trade')
  async trade(@Param('id') id: string, @Param('gameId') gameId: string, @Body() body: unknown): Promise<Session> {
    const o = asObject(body);
    const side = o.side;
    if (side !== 'buy' && side !== 'sell') bad('side must be buy or sell');
    const size = o.size;
    if (size !== undefined && (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 100)) {
      bad('size must be an integer between 1 and 100');
    }
    const org = await this.peers.kits.org();
    await this.market.trade(org.id, id, gameId, side, size as number | undefined);
    return this.session(org.id, id);
  }

  @Post('games/:gameId/reveal')
  async reveal(@Param('id') id: string, @Param('gameId') gameId: string): Promise<Session> {
    const org = await this.peers.kits.org();
    await this.market.reveal(org.id, id, gameId);
    return this.session(org.id, id);
  }

  @Post('games/:gameId/settle')
  async settle(@Param('id') id: string, @Param('gameId') gameId: string): Promise<Session> {
    const org = await this.peers.kits.org();
    await this.market.settle(org.id, id, gameId);
    return this.session(org.id, id);
  }

  private async session(orgId: string, id: string): Promise<Session> {
    const session = await this.peers.sessions.get(orgId, id);
    return { ...session, market: await this.market.sessionMarket(id) };
  }
}
