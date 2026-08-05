import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LeadSource } from '@prisma/client';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Public } from '../../../common/decorators/public.decorator';
import { LeadIntakeService } from '../lead-intake.service';
import { StoreResolver } from './connectors.util';

class SiteLeadDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({ description: 'Telefone com DDD' })
  @IsString()
  @MaxLength(20)
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @ApiPropertyOptional({ description: 'Loja/cidade de interesse (cascavel, guarapuava...)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  store?: string;

  /**
   * #962 — qual SITE mandou o lead ("avecchi" = LP avecchi.ai). Decide o
   * TENANT de destino via env CRM_CONNECTOR_TENANT_ID__<SITE>; ausente = site
   * da GDR (env default). Slug curto, sem semântica de loja.
   */
  @ApiPropertyOptional({ description: 'Slug do site de origem (ex.: avecchi)' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,32}$/, { message: 'site deve ser um slug curto (a-z, 0-9, hífen)' })
  site?: string;

  /** #962 — empresa do contato (LP SaaS); vai para sourceMeta.company */
  @ApiPropertyOptional({ description: 'Empresa do contato' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({ description: 'Modelo de interesse' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  interest?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  /** Honeypot anti-spam: campo invisível no form — humano não preenche */
  @ApiPropertyOptional({ description: 'NÃO preencher (honeypot)' })
  @IsOptional()
  @IsString()
  website?: string;
}

/**
 * F1.6 (#512) — formulário do site da GDR. Público, rate-limited e com
 * honeypot: bot que preencher "website" recebe 200 e vai pro lixo em silêncio
 * (responder erro ensina o bot a contornar).
 */
@ApiTags('crm')
@Controller('crm/public')
export class SiteLeadController {
  private readonly logger = new Logger(SiteLeadController.name);

  constructor(
    private readonly leadIntake: LeadIntakeService,
    private readonly storeResolver: StoreResolver,
  ) {}

  @Post('site-lead')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(202)
  @ApiOperation({ summary: 'Lead do formulário do site (público, honeypot + rate limit)' })
  async create(@Body() dto: SiteLeadDto) {
    if (dto.website?.trim()) {
      this.logger.warn('Honeypot acionado no form do site — descartando em silêncio');
      return { ok: true };
    }
    // #962: o site de origem decide o TENANT (503 se não mapeado — nunca cai
    // no default de outro dono). Loja não resolvida → TRIAGEM na matriz do
    // próprio site (sem vendedor, como sempre).
    const tenantRoot = this.storeResolver.tenantRootId(dto.site);
    const companyId = await this.storeResolver.resolve(dto.store, tenantRoot);
    await this.leadIntake.intake(
      companyId,
      {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        source: LeadSource.SITE,
        interest: dto.interest,
        sourceMeta: {
          site: dto.site ?? null,
          store: dto.store ?? null,
          company: dto.company?.slice(0, 200) ?? null,
          message: dto.message?.slice(0, 1000) ?? null,
        },
      },
      tenantRoot,
    );
    return { ok: true };
  }
}
