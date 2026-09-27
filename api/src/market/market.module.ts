import { Module } from '@nestjs/common';
import { MarketCandidateController } from './market-candidate.controller';
import { MarketController } from './market.controller';
import { MarketPeers } from './market-peers';
import { MarketService } from './market.service';

/** v1.2 make-a-market games. PrismaModule is global; AppModule services come via MarketPeers. */
@Module({
  controllers: [MarketController, MarketCandidateController],
  providers: [MarketService, MarketPeers],
  exports: [MarketService],
})
export class MarketModule {}
