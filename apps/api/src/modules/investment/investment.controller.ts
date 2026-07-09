import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { InvestmentService } from './investment.service';
import { CreateInvestmentProjectDto } from './dto/create-investment-project.dto';
import { UpdateInvestmentProjectDto } from './dto/update-investment-project.dto';
import { UpsertCashflowDto } from './dto/upsert-cashflow.dto';

// #341 parte 2 (PR E1): gate único RBAC v2 — @Roles legado removido (matriz
// Rafael, issue #623). manage fica com G.FINANCEIRO/admins (FINANCEIRO só vê);
// approve é ALÇADA exclusiva de DIRETOR/admins — quem gerencia o projeto não
// aprova o próprio investimento.

@ApiTags('investments')
@ApiBearerAuth()
@Controller('investments')
export class InvestmentController {
  constructor(private readonly service: InvestmentService) {}

  @Post()
  @RequirePermission('finance.investments.manage')
  @ApiOperation({ summary: 'Criar projeto de investimento (#399)' })
  create(@Body() dto: CreateInvestmentProjectDto, @Request() req: { user: { companyId: string } }) {
    return this.service.createProject(req.user.companyId, dto);
  }

  @Get()
  @RequirePermission('finance.investments.view')
  @ApiOperation({ summary: 'Listar projetos de investimento' })
  list(@Request() req: { user: { companyId: string } }) {
    return this.service.listProjects(req.user.companyId);
  }

  // Rota estática ANTES da paramétrica :id
  @Get('compare')
  @RequirePermission('finance.investments.view')
  @ApiOperation({ summary: 'Comparativo lado a lado (VPL, TIR, payback) de projetos' })
  @ApiQuery({ name: 'ids', required: true, description: 'IDs separados por vírgula' })
  compare(@Query('ids') ids: string, @Request() req: { user: { companyId: string } }) {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.compare(req.user.companyId, list);
  }

  @Get(':id')
  @RequirePermission('finance.investments.view')
  @ApiOperation({ summary: 'Projeto + análise (VPL, TIR, payback simples/descontado, fluxo acumulado)' })
  get(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.service.getProject(req.user.companyId, id);
  }

  @Patch(':id')
  @RequirePermission('finance.investments.manage')
  @ApiOperation({ summary: 'Atualizar projeto (nome, descrição, taxa de desconto)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvestmentProjectDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.updateProject(req.user.companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('finance.investments.manage')
  @ApiOperation({ summary: 'Remover projeto de investimento' })
  remove(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.service.deleteProject(req.user.companyId, id);
  }

  @Post(':id/cashflows')
  @RequirePermission('finance.investments.manage')
  @ApiOperation({ summary: 'Criar/atualizar fluxo de caixa de um período' })
  upsertCashflow(
    @Param('id') id: string,
    @Body() dto: UpsertCashflowDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.upsertCashflow(req.user.companyId, id, dto);
  }

  @Delete(':id/cashflows/:cashflowId')
  @RequirePermission('finance.investments.manage')
  @ApiOperation({ summary: 'Remover fluxo de caixa' })
  removeCashflow(
    @Param('id') id: string,
    @Param('cashflowId') cashflowId: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.removeCashflow(req.user.companyId, id, cashflowId);
  }

  @Post(':id/approve')
  @RequirePermission('finance.investments.approve')
  @ApiOperation({ summary: 'Aprovar investimento (alçada DIRECTOR)' })
  approve(@Param('id') id: string, @Request() req: { user: { companyId: string; sub: string } }) {
    return this.service.decide(req.user.companyId, id, req.user.sub, true);
  }

  @Post(':id/reject')
  @RequirePermission('finance.investments.approve')
  @ApiOperation({ summary: 'Reprovar investimento (alçada DIRECTOR)' })
  reject(@Param('id') id: string, @Request() req: { user: { companyId: string; sub: string } }) {
    return this.service.decide(req.user.companyId, id, req.user.sub, false);
  }
}
