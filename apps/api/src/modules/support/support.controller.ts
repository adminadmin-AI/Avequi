import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateDiagnosisDto } from './dto/update-diagnosis.dto';
import { SupportService } from './support.service';
import { GithubIssueService } from './github-issue.service';

/**
 * Suporte (épico #764). Reportar e ver os PRÓPRIOS chamados é self-service —
 * sem @RequirePermission de propósito: bloquear reporte de bug por falta de
 * permissão seria errado. As duas rotas estão em SELF_SERVICE_OK no
 * route-gate-coverage.spec (autenticado-por-design). Rotas de gestão/triagem
 * (ver todos os chamados) virão com permissão própria em WPs futuros.
 */
@Controller('support')
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly config: ConfigService,
    private readonly githubIssues: GithubIssueService,
  ) {}

  @Post('incidents')
  create(
    @Request() req: { user: { companyId: string; id: string } },
    @Body() dto: CreateIncidentDto,
  ) {
    return this.supportService.createIncident(req.user.companyId, dto, req.user.id);
  }

  @Get('incidents')
  listMine(@Request() req: { user: { companyId: string; id: string } }) {
    return this.supportService.listMine(req.user.companyId, req.user.id);
  }

  /**
   * WP4 (#768) — write-back assinado do runner (máquina→máquina, sem JWT).
   * Segurança copiada do webhook Focus (#159): @Public + HMAC-SHA256 do corpo
   * BRUTO no header `x-triage-signature`, `timingSafeEqual`, FAIL-CLOSED — sem
   * `SUPPORT_TRIAGE_HMAC_SECRET` configurado, rejeita SEMPRE (401). Está na
   * PUBLIC_ALLOWLIST do route-gate por validar a si próprio via assinatura.
   *
   * Rota depois das estáticas (`incidents`) — o parâmetro fica em `:id` sem
   * capturar as demais.
   */
  @Patch('incidents/:id/diagnosis')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  async updateDiagnosis(
    @Req() req: RawBodyRequest<ExpressRequest>,
    @Param('id') id: string,
    @Body() dto: UpdateDiagnosisDto,
    @Headers('x-triage-signature') signature?: string,
  ) {
    this.verifySignature(req.rawBody, signature);

    const incident = await this.supportService.applyDiagnosis(id, dto);

    // Espelha o diagnóstico na issue do time (fail-safe: nunca quebra o write).
    if (incident.githubIssueNumber != null) {
      await this.githubIssues.commentDiagnosis(incident.githubIssueNumber, dto);
    }
    return { ok: true, protocol: incident.protocol };
  }

  /** HMAC-SHA256 do corpo bruto, fail-closed. Lança 401 em qualquer desvio. */
  private verifySignature(rawBody: Buffer | undefined, signature?: string): void {
    const secret = this.config.get<string>('SUPPORT_TRIAGE_HMAC_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Triage HMAC secret not configured');
    }
    if (!signature || !rawBody) {
      throw new UnauthorizedException('Missing triage signature');
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid triage signature');
    }
  }
}
