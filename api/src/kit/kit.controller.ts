import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import type { Band, Kit, Me } from '../contracts/api';
import { bad } from '../common/validate';
import { CallerEmail } from '../identity/identity.guard';
import { KitService, toKit } from './kit.service';

@Controller()
export class KitController {
  constructor(private readonly kits: KitService) {}

  @Get('me')
  async me(@CallerEmail() email: string): Promise<Me> {
    const org = await this.kits.org();
    return { email, org: { id: org.id, name: org.name } };
  }

  @Get('kit')
  async kit(): Promise<Kit> {
    const org = await this.kits.org();
    return toKit(await this.kits.activeKit(org.id));
  }

  @Put('kit/sections/:key/bands')
  async bands(@Param('key') key: string, @Body() body: unknown): Promise<Kit> {
    if (!Array.isArray(body)) bad('body must be an array of bands');
    const bands: Band[] = body.map((b: unknown) => {
      if (!b || typeof b !== 'object') bad('each band must be an object');
      const { min, label } = b as Record<string, unknown>;
      if (typeof min !== 'number' || !Number.isFinite(min) || min < 0) bad('band.min must be a number >= 0');
      if (typeof label !== 'string' || !label.trim()) bad('band.label must be a non-empty string');
      return { min, label: label.trim() };
    });
    bands.sort((a, b) => a.min - b.min);
    const org = await this.kits.org();
    return this.kits.updateBands(org.id, key, bands);
  }
}
