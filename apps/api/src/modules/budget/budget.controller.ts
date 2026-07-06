import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { BudgetService } from './budget.service';

@ApiTags('Orçamento')
@ApiBearerAuth()
@Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL')
@Controller('finance/budget')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'MANAGER', 'FINANCIAL')
  @ApiOperation({ summary: 'Criar/atualizar linha de orçamento' })
  upsert(@Body() dto: any, @CurrentUser() user: any) {
    return this.budgetService.upsert(user.companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar orçamento por ano' })
  @ApiQuery({ name: 'year', type: Number })
  findAll(@CurrentUser() user: any, @Query('year') year: string) {
    return this.budgetService.findAll(user.companyId, parseInt(year) || new Date().getFullYear());
  }

  @Get('variance')
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
  @Roles('SUPER_ADMIN', 'MANAGER', 'FINANCIAL')
  @ApiOperation({ summary: 'Excluir linha de orçamento' })
  delete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.budgetService.delete(id, user.companyId);
  }
}
