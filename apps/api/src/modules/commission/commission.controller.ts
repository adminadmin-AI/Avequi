import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PermissionService } from '../iam/permission.service';
import { CommissionService } from './commission.service';

/**
 * #341 parte 2 (PR C): gate único RBAC v2 via @RequirePermission — removidos
 * o @Roles de classe e os de rota (matriz validada pelo Rafael na issue #621).
 *
 * ── #1001-C2: quem vê a comissão dos OUTROS ────────────────────────────────
 * O recorte de privacidade era feito por enum: `user.role === 'COMMERCIAL'`
 * forçava o filtro para o próprio usuário. Isso restringia UM perfil só — o
 * espelho do enum COMMERCIAL é o VENDEDOR. Qualquer outro papel, inclusive
 * gerentes sem nenhuma responsabilidade comercial, via a comissão e o
 * PERCENTUAL de todos os vendedores.
 *
 * Agora quem manda é `sales.commissions.view-all`. Sem ela, a leitura é
 * sempre a do próprio usuário — e o `userId` que vier na query é IGNORADO,
 * não rejeitado: negar daria ao cliente um oráculo para descobrir quem existe.
 *
 * ⚠️ A checagem NÃO honra o fallback legado do #946 de propósito: o espelho
 * do enum SUPER_ADMIN é o ADMIN_GLOBAL, que TEM esta permissão — honrá-lo
 * devolveria pelo enum exatamente o recorte que este PR passa a exigir.
 *
 * O escopo empresarial não muda: `companyId` vem do JWT e continua sendo o
 * único recorte de tenant. `view-all` amplia de "só eu" para "todos DESTA
 * empresa", nunca para outras.
 */
export const COMMISSION_VIEW_ALL_PERMISSION = 'sales.commissions.view-all';

/**
 * Este usuário pode ver a comissão dos outros? (#1001-C2)
 *
 * Função de MÓDULO, não método do controller, de propósito: o
 * `pr341c.access.spec` varre o prototype e exige que só existam rotas ali —
 * é essa varredura que pega uma rota nova sem gate. Um helper privado no
 * prototype quebraria essa garantia por um detalhe de organização.
 *
 * `hasAnyPermission` resolve o RBAC v2 puro — SEM o fallback legado. Falha na
 * resolução propaga: em dado de remuneração, negar por erro de infraestrutura
 * é o lado seguro.
 */
function podeVerDeTodos(
  permissions: PermissionService,
  user: { id: string; companyId: string },
): Promise<boolean> {
  return permissions.hasAnyPermission(user.id, user.companyId, [COMMISSION_VIEW_ALL_PERMISSION]);
}

@ApiTags('commissions')
@ApiBearerAuth()
@Controller('commissions')
export class CommissionController {
  constructor(
    private readonly commissionService: CommissionService,
    private readonly permissions: PermissionService,
  ) {}

  @Get()
  @RequirePermission('sales.commissions.view')
  @ApiOperation({ summary: 'Listar comissões (#191)' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'PAID'] })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // #1001-C2: sem `view-all`, o filtro é FORÇADO para o próprio usuário e o
    // `userId` da query é ignorado — o cliente não escolhe de quem vê.
    const effectiveUserId = (await podeVerDeTodos(this.permissions, user)) ? userId : user.id;
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
  async findRules(@CurrentUser() user: any) {
    // Mesma proteção da listagem, e aqui ela pesa mais: a regra expõe o
    // PERCENTUAL de cada vendedor, que é informação de remuneração.
    const onlyUserId = (await podeVerDeTodos(this.permissions, user)) ? undefined : user.id;
    return this.commissionService.findRules(user.companyId, onlyUserId);
  }
}
