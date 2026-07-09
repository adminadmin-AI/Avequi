import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CommissionService } from './commission.service';

/**
 * #341 parte 2 (PR C): gate único RBAC v2 via @RequirePermission — removidos
 * o @Roles de classe e os de rota (matriz validada pelo Rafael na issue #621).
 *
 * O recorte "COMMERCIAL só vê a própria comissão/regra" continua feito por
 * enum DENTRO dos handlers — é escopo de DADOS (privacidade), não gate de
 * rota; migra para o modelo v2 quando o enum for aposentado (mesmo interino
 * documentado no escopo de company, PR B).
 */
@ApiTags('commissions')
@ApiBearerAuth()
@Controller('commissions')
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  @Get()
  @RequirePermission('sales.commissions.view')
  @ApiOperation({ summary: 'Listar comissões (#191)' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'PAID'] })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  findAll(
    @CurrentUser() user: any,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Vendedor (COMMERCIAL) só vê as próprias comissões — o filtro userId da
    // query é ignorado e forçado para o usuário logado (decisão Rafael 04/07/2026)
    const effectiveUserId = user.role === 'COMMERCIAL' ? user.id : userId;
    return this.commissionService.findAll(user.companyId, {
      userId: effectiveUserId,
      status,
      from,
      to,
    });
  }

  @Post('approve-batch')
  @RequirePermission('sales.commissions.approve')
  @ApiOperation({ summary: 'Aprovar comissões em lote → gera payables (#191)' })
  approveBatch(
    @Body() body: { commissionIds: string[] },
    @CurrentUser() user: any,
  ) {
    return this.commissionService.approveBatch(user.companyId, body.commissionIds, user.id);
  }

  @Post('rules')
  @RequirePermission('sales.commissions.configure')
  @ApiOperation({ summary: 'Criar regra de comissão (#191)' })
  createRule(@Body() body: any, @CurrentUser() user: any) {
    // companyId SEMPRE do JWT (padrão anti-IDOR do #450), nunca do body
    return this.commissionService.createRule({ ...body, companyId: user.companyId });
  }

  @Get('rules')
  @RequirePermission('sales.commissions.view')
  @ApiOperation({ summary: 'Listar regras de comissão' })
  findRules(@CurrentUser() user: any) {
    // Mesma privacidade: COMMERCIAL só vê a própria regra (percentuais dos
    // demais vendedores são sensíveis)
    const onlyUserId = user.role === 'COMMERCIAL' ? user.id : undefined;
    return this.commissionService.findRules(user.companyId, onlyUserId);
  }
}
