import { Body, Controller, Delete, Get, Param, Patch, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BudgetPlanService } from './budget-plan.service';
import { CreateBudgetPlanDto } from './dto/create-budget-plan.dto';
import { UpdateBudgetPlanDto } from './dto/update-budget-plan.dto';
import { UpsertDriverDto } from './dto/upsert-driver.dto';

// Mesmo controle de acesso do budget.controller irmão (permissão na rota).
// #341 parte 2 (PR E1): gate único RBAC v2 — @Roles legado removido (matriz
// Rafael, issue #623). manage = G.FINANCEIRO/admins; view inclui gerências.

@ApiTags('budget-plans')
@ApiBearerAuth()
@Controller('budget-plans')
export class BudgetPlanController {
  constructor(private readonly service: BudgetPlanService) {}

  @Post()
  @RequirePermission('finance.budget-plans.manage')
  @ApiOperation({ summary: 'Criar plano de orçamento dirigido por drivers (#398)' })
  create(@Body() dto: CreateBudgetPlanDto, @Request() req: { user: { companyId: string } }) {
    return this.service.createPlan(req.user.companyId, dto);
  }

  @Get()
  @RequirePermission('finance.budget-plans.view')
  @ApiOperation({ summary: 'Listar planos de orçamento' })
  list(@Request() req: { user: { companyId: string } }) {
    return this.service.listPlans(req.user.companyId);
  }

  @Get(':id/projection')
  @RequirePermission('finance.budget-plans.view')
  @ApiOperation({ summary: 'Projeção do resultado a partir dos drivers (recálculo automático)' })
  projection(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.service.project(req.user.companyId, id);
  }

  @Get(':id/sensitivity')
  @RequirePermission('finance.budget-plans.view')
  @ApiOperation({ summary: 'Análise de sensibilidade — ±10% volume, ±5% preço' })
  sensitivity(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.service.sensitivity(req.user.companyId, id);
  }

  @Get(':id/vs-realized')
  @RequirePermission('finance.budget-plans.view')
  @ApiOperation({ summary: 'Orçado vs realizado por driver (vendas faturadas do ano)' })
  vsRealized(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.service.vsRealized(req.user.companyId, id);
  }

  @Patch(':id')
  @RequirePermission('finance.budget-plans.manage')
  @ApiOperation({ summary: 'Atualizar premissas do plano (despesas var/fixas, CAPEX)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBudgetPlanDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.updatePlan(req.user.companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('finance.budget-plans.manage')
  @ApiOperation({ summary: 'Remover plano de orçamento' })
  remove(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.service.deletePlan(req.user.companyId, id);
  }

  @Post(':id/drivers')
  @RequirePermission('finance.budget-plans.manage')
  @ApiOperation({ summary: 'Criar/atualizar driver (volume, preço, custo unitário) do plano' })
  upsertDriver(
    @Param('id') id: string,
    @Body() dto: UpsertDriverDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.upsertDriver(req.user.companyId, id, dto);
  }

  @Delete(':id/drivers/:driverId')
  @RequirePermission('finance.budget-plans.manage')
  @ApiOperation({ summary: 'Remover driver do plano' })
  removeDriver(
    @Param('id') id: string,
    @Param('driverId') driverId: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.removeDriver(req.user.companyId, id, driverId);
  }
}
