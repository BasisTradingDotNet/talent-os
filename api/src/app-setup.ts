import { PayloadTooLargeException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { NextFunction, Request, Response } from 'express';

/** Only this route takes a raw body: one recording chunk of at most 8 MB. */
export const CHUNK_ROUTE = '/api/candidate/:token/recordings/:segmentId/chunks/:seq';
export const CHUNK_LIMIT = '8mb';

/**
 * Shared by main.ts and the e2e tests. Must run before app.init(): Nest registers its JSON
 * parser during init, so a raw parser registered here runs first and the JSON parser then skips
 * the already-consumed body.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  const raw = express.raw({ type: () => true, limit: CHUNK_LIMIT });
  app.use(CHUNK_ROUTE, (req: Request, res: Response, next: NextFunction) =>
    raw(req, res, (err?: unknown) => {
      // body-parser's 413 is not an HttpException; map it so it is a clean 413, not a logged crash.
      if (err && (err as { status?: number }).status === 413) return next(new PayloadTooLargeException('chunk exceeds 8 MB'));
      next(err);
    }),
  );
}
