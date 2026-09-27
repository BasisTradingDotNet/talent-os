import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CandidateViewController } from './candidate-view/candidate-view.controller';
import { CandidatesController } from './candidates/candidates.controller';
import { CandidatesService } from './candidates/candidates.service';
import { ExportsController } from './exports/exports.controller';
import { IdentityGuard, Public } from './identity/identity.guard';
import { KitController } from './kit/kit.controller';
import { KitService } from './kit/kit.service';
import { PrismaModule } from './prisma/prisma.module';
import { SeedService } from './seed/seed.service';
import { SessionsController } from './sessions/sessions.controller';
import { SessionsService } from './sessions/sessions.service';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  health(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [
    HealthController,
    KitController,
    CandidatesController,
    SessionsController,
    ExportsController,
    CandidateViewController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: IdentityGuard },
    KitService,
    CandidatesService,
    SessionsService,
    SeedService,
  ],
})
export class AppModule {}
