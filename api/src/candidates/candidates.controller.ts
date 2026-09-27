import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { CandidateDetail, CandidateSummary, CreateCandidate, UpdateCandidate } from '../contracts/api';
import { asObject, bad, optNullableString, optString, reqString } from '../common/validate';
import { KitService } from '../kit/kit.service';
import { CandidatesService } from './candidates.service';

@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService, private readonly kits: KitService) {}

  @Get()
  async list(): Promise<CandidateSummary[]> {
    const org = await this.kits.org();
    return this.candidates.list(org.id);
  }

  @Post()
  async create(@Body() body: unknown): Promise<CandidateDetail> {
    const o = asObject(body);
    const input: CreateCandidate = {
      name: reqString(o, 'name', { max: 300 }).trim(),
      email: optString(o, 'email', 320),
      source: optString(o, 'source', 500),
      notes: optString(o, 'notes'),
    };
    const org = await this.kits.org();
    return this.candidates.create(org.id, input);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<CandidateDetail> {
    const org = await this.kits.org();
    return this.candidates.get(org.id, id);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<CandidateDetail> {
    const o = asObject(body);
    const input: UpdateCandidate = {
      name: optString(o, 'name', 300),
      email: optNullableString(o, 'email', 320),
      source: optNullableString(o, 'source', 500),
      notes: optNullableString(o, 'notes'),
      overallDecision: optNullableString(o, 'overallDecision', 200),
      level: optNullableString(o, 'level', 200),
      compNote: optNullableString(o, 'compNote'),
    };
    if (input.name !== undefined && !input.name.trim()) bad('name must not be empty');
    const org = await this.kits.org();
    return this.candidates.patch(org.id, id, input);
  }
}
