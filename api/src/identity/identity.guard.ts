import {
  CanActivate,
  createParamDecorator,
  CustomDecorator,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cfg } from '../common/config';

export const IS_PUBLIC = 'talent-os:public';
/** Marks a handler/controller as reachable without an interviewer identity. Use sparingly. */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC, true);

const EMAIL_HEADER = 'cf-access-authenticated-user-email';
const JWT_HEADER = 'cf-access-jwt-assertion';

type JWKS = ReturnType<typeof createRemoteJWKSet>;
let jwks: { team: string; set: JWKS } | null = null;

function jwksFor(team: string): JWKS {
  if (!jwks || jwks.team !== team) {
    jwks = { team, set: createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)) };
  }
  return jwks.set;
}

function header(req: Request, name: string): string | null {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

/** Resolves the caller's email or throws 401. Exported for testing. */
export async function resolveEmail(req: Request): Promise<string> {
  const { accessTeamDomain, accessAud, devUserEmail } = cfg();
  if (accessTeamDomain && accessAud) {
    const token = header(req, JWT_HEADER);
    if (!token) throw new UnauthorizedException('missing access token');
    try {
      const { payload } = await jwtVerify(token, jwksFor(accessTeamDomain), {
        issuer: `https://${accessTeamDomain}`,
        audience: accessAud,
      });
      const email = payload.email;
      if (typeof email !== 'string' || !email) throw new Error('no email claim');
      return email.toLowerCase();
    } catch (e) {
      throw new UnauthorizedException('invalid access token');
    }
  }
  const fromHeader = header(req, EMAIL_HEADER);
  if (fromHeader) return fromHeader.toLowerCase();
  if (devUserEmail) return devUserEmail.toLowerCase();
  throw new UnauthorizedException('no identity');
}

@Injectable()
export class IdentityGuard implements CanActivate {
  private readonly logger = new Logger(IdentityGuard.name);
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request & { userEmail?: string }>();
    req.userEmail = await resolveEmail(req);
    return true;
  }
}

/** The authenticated interviewer's email (set by IdentityGuard). */
export const CallerEmail = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request & { userEmail?: string }>();
  if (!req.userEmail) throw new UnauthorizedException('no identity');
  return req.userEmail;
});
