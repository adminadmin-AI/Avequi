import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BudgetService } from './budget.service';

/**
 * #341 parte 2 (PR E1): gate único RBAC v2 — @Roles legado removido (matriz
 * Rafael, issue #623). Escrita de orçamento fica com FINANCEIRO/G.FINANCEIRO
 * (G.GERAL e DIRETOR só leitura — decisões #623).
 */
@ApiTags('Orçamento')
@ApiBearerAuth()
@Controller('finance/budget')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Post()
  @RequirePermission('finance.budget.create')
  @ApiOperation({ summary: 'Criar/atualizar linha de orçamento' })
  upsert(@Body() dto: any, @CurrentUser() user: any) {
    return this.budgetService.upsert(user.companyId, dto);
  }

  @Get()
  @RequirePermission('finance.budget.view')
  @ApiOperation({ summary: 'Listar orçamento por ano' })
  @ApiQuery({ name: 'year', type: Number })
  findAll(@CurrentUser() user: any, @Query('year') year: string) {
    return this.budgetService.findAll(user.companyId, parseInt(year) || new Date().getFullYear());
  }

  @Get('variance')
  @RequirePermission('finance.budget.view')
  @ApiOperation({ summary: 'Budget vs Actual — variância por mês' })
  @ApiQuery({ name: 'year', type: Number })
  @ApiQuery({ name: 'costCenterId', required: false })
  getVariance(
    @CurrentUser() user: any,
    @Query('year') year: string,
    @Query('costCenterId') costCenterId?: string,
  ) {
    return this.budgetService.getVariance(user.companyId, parseInt(year) || new Date().getFullYear(), costCenterId);
  }

  @Delete(':id')
  @RequirePermission('finance.budget.delete')
  @ApiOperation({ summary: 'Excluir linha de orçamento' })
  delete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.budgetService.delete(id, user.companyId);
  }
}
