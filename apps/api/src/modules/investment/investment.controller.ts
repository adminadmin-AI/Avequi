import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { InvestmentService } from './investment.service';
import { CreateInvestmentProjectDto } from './dto/create-investment-project.dto';
import { UpdateInvestmentProjectDto } from './dto/update-investment-project.dto';
import { UpsertCashflowDto } from './dto/upsert-cashflow.dto';

const READ_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL'] as const;
const WRITE_ROLES = ['SUPER_ADMIN', 'MANAGER', 'FINANCIAL'] as const;
const APPROVE_ROLES = ['SUPER_ADMIN', 'DIRECTOR'] as const; // alçada de aprovação

@ApiTags('investments')
@ApiBearerAuth()
@Controller('investments')
@Roles(...READ_ROLES)
export class InvestmentController {
  constructor(private readonly service: InvestmentService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Criar projeto de investimento (#399)' })
  create(@Body() dto: CreateInvestmentProjectDto, @Request() req: { user: { companyId: string } }) {
    return this.service.createProject(req.user.companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar projetos de investimento' })
  list(@Request() req: { user: { companyId: string } }) {
    return this.service.listProjects(req.user.companyId);
  }

  // Rota estática ANTES da paramétrica :id
  @Get('compare')
  @ApiOperation({ summary: 'Comparativo lado a lado (VPL, TIR, payback) de projetos' })
  @ApiQuery({ name: 'ids', required: true, description: 'IDs separados por vírgula' })
  compare(@Query('ids') ids: string, @Request() req: { user: { companyId: string } }) {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.compare(req.user.companyId, list);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Projeto + análise (VPL, TIR, payback simples/descontado, fluxo acumulado)' })
  get(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.service.getProject(req.user.companyId, id);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Atualizar projeto (nome, descrição, taxa de desconto)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvestmentProjectDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.updateProject(req.user.companyId, id, dto);
  }

  @Delete(':id')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Remover projeto de investimento' })
  remove(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.service.deleteProject(req.user.companyId, id);
  }

  @Post(':id/cashflows')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Criar/atualizar fluxo de caixa de um período' })
  upsertCashflow(
    @Param('id') id: string,
    @Body() dto: UpsertCashflowDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.upsertCashflow(req.user.companyId, id, dto);
  }

  @Delete(':id/cashflows/:cashflowId')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Remover fluxo de caixa' })
  removeCashflow(
    @Param('id') id: string,
    @Param('cashflowId') cashflowId: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.service.removeCashflow(req.user.companyId, id, cashflowId);
  }

  @Post(':id/approve')
  @Roles(...APPROVE_ROLES)
  @ApiOperation({ summary: 'Aprovar investimento (alçada DIRECTOR)' })
  approve(@Param('id') id: string, @Request() req: { user: { companyId: string; sub: string } }) {
    return this.service.decide(req.user.companyId, id, req.user.sub, true);
  }

  @Post(':id/reject')
  @Roles(...APPROVE_ROLES)
  @ApiOperation({ summary: 'Reprovar investimento (alçada DIRECTOR)' })
  reject(@Param('id') id: string, @Request() req: { user: { companyId: string; sub: string } }) {
    return this.service.decide(req.user.companyId, id, req.user.sub, false);
  }
}
