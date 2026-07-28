import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FinanceService } from './finance.service';
import { FinanceKpiService } from './finance-kpi.service';
import { ProvisionService } from './provision.service';
import { SupplierAdvanceService } from './supplier-advance.service';
import { CreateSupplierAdvanceDto } from './dto/supplier-advance.dto';
import { DebtService } from './debt.service';
import { ManagementBookService } from './management-book.service';
import { CreateDebtDto } from './dto/debt.dto';
import { UpdateProvisionRuleDto, WriteOffDto } from './dto/provision.dto';
import { PayEntryDto } from './dto/pay-entry.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateInstallmentsDto } from './dto/create-installments.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { CreateManualEntryDto } from './dto/create-manual-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';

/**
 * #341 parte 2 (PR E1): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #623, 09/07/2026).
 * Separação central: FINANCEIRO opera o dia a dia; GERENTE_FINANCEIRO configura
 * e faz o sensível (write-off, provisões); DIRETOR vê/aprova sem operar
 * (o legado dava DIRECTOR em write-off/lançamentos — o v2 tira).
 */
@ApiTags('Finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly kpiService: FinanceKpiService,
    private readonly provisionService: ProvisionService,
    private readonly advanceService: SupplierAdvanceService,
    private readonly debtService: DebtService,
    private readonly bookService: ManagementBookService,
  ) {}

  // ─── Lançamentos financeiros ──────────────────────────────────────────────

  @Get()
  @RequirePermission('finance.entries.view')
  @ApiOperation({ summary: 'Listar lançamentos com filtros' })
  @ApiQuery({ name: 'type', required: false, enum: FinancialEntryType })
  @ApiQuery({ name: 'status', required: false, enum: FinancialEntryStatus })
  @ApiQuery({ name: 'dueDateFrom', required: false })
  @ApiQuery({ name: 'dueDateTo', required: false })
  findAll(
    @Request() req: { user: { companyId: string } },
    @Query('type') type?: FinancialEntryType,
    @Query('status') status?: FinancialEntryStatus,
    @Query('dueDateFrom') dueDateFrom?: string,
    @Query('dueDateTo') dueDateTo?: string,
  ) {
    return this.financeService.findAll(req.user.companyId, { type, status, dueDateFrom, dueDateTo });
  }

  @Post('entries/manual')
  @RequirePermission('finance.entries.create')
  @ApiOperation({ summary: 'Criar lançamento manual (avulso)' })
  createManualEntry(
    @Body() dto: CreateManualEntryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createManualEntry(req.user.companyId, dto);
  }

  // Rota com prefixo estático `entries/` — NÃO colide com `@Get(':id')` (método
  // diferente) nem com `@Patch(':id/pay')`/`@Patch(':id/cancel')` (3 segmentos).
  @Patch('entries/:id')
  @RequirePermission('finance.entries.update')
  @ApiOperation({ summary: 'Editar lançamento em aberto (OPEN/OVERDUE)' })
  updateEntry(
    @Param('id') id: string,
    @Body() dto: UpdateFinancialEntryDto,
    @Request() req: { user: { id?: string; companyId: string } },
  ) {
    return this.financeService.updateEntry(id, req.user.companyId, dto, req.user.id);
  }

  // Fase 2 do detalhe — timeline "quem fez o quê, quando" do título, a partir
  // do AuditLog. Mesma permissão de leitura da carteira (sem código novo no
  // catálogo → publicar não exige seed IAM). 3 segmentos: não colide com
  // `@Get(':id')`.
  @Get('entries/:id/history')
  @RequirePermission('finance.entries.view')
  @ApiOperation({ summary: 'Histórico de auditoria do lançamento' })
  entryHistory(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.financeService.entryHistory(id, req.user.companyId);
  }

  @Get('kpis')
  @RequirePermission('finance.reports.view')
  @ApiOperation({ summary: 'KPIs financeiros: PMP, PMR, ciclo, cash runway, liquidez (#382/#387)' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD (default: 90 dias atrás)' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD (default: hoje)' })
  getKpis(
    @Request() req: { user: { companyId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.kpiService.getKpis(req.user.companyId, { from, to });
  }

  @Get('margin-by-sku')
  @RequirePermission('finance.reports.view')
  @ApiOperation({ summary: 'Margem de contribuição por SKU — receita × custo × impostos (#386)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getMarginBySku(
    @Request() req: { user: { companyId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.kpiService.getMarginBySku(req.user.companyId, { from, to });
  }

  @Get('pdd')
  @RequirePermission('finance.provisions.view')
  @ApiOperation({ summary: 'PDD — provisão para devedores duvidosos por faixa de atraso (#389)' })
  getPdd(@Request() req: { user: { companyId: string } }) {
    return this.provisionService.getPdd(req.user.companyId);
  }

  @Get('provision-rules')
  @RequirePermission('finance.provisions.view')
  @ApiOperation({ summary: 'Faixas de provisão do PDD (#389)' })
  listProvisionRules(@Request() req: { user: { companyId: string } }) {
    return this.provisionService.findRules(req.user.companyId);
  }

  @Post('provision-rules/seed-defaults')
  @RequirePermission('finance.provisions.configure')
  @ApiOperation({ summary: 'Criar as 6 faixas padrão do PDD (idempotente) (#389)' })
  seedProvisionDefaults(@Request() req: { user: { companyId: string } }) {
    return this.provisionService.seedDefaults(req.user.companyId);
  }

  @Patch('provision-rules/:id')
  @RequirePermission('finance.provisions.configure')
  @ApiOperation({ summary: 'Ajustar uma faixa de provisão (#389)' })
  updateProvisionRule(
    @Param('id') id: string,
    @Body() dto: UpdateProvisionRuleDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.provisionService.updateRule(id, req.user.companyId, dto);
  }

  @Post('entries/:id/write-off')
  @RequirePermission('finance.entries.write-off')
  @ApiOperation({ summary: 'Write-off — baixa por perda com justificativa auditada (#389)' })
  writeOff(
    @Param('id') id: string,
    @Body() dto: WriteOffDto,
    @Request() req: { user: { id?: string; companyId: string } },
  ) {
    return this.provisionService.writeOff(id, req.user.companyId, dto.reason, req.user.id);
  }

  // ─── Adiantamentos a fornecedor (#393) ────────────────────────────────────

  @Get('supplier-advances')
  @RequirePermission('finance.advances.view')
  @ApiOperation({ summary: 'Adiantamentos + saldo aberto por fornecedor (#393)' })
  listAdvances(@Request() req: { user: { companyId: string } }) {
    return this.advanceService.report(req.user.companyId);
  }

  @Post('supplier-advances')
  @RequirePermission('finance.advances.create')
  @ApiOperation({ summary: 'Criar adiantamento a fornecedor (#393)' })
  createAdvance(
    @Body() dto: CreateSupplierAdvanceDto,
    @Request() req: { user: { id?: string; companyId: string } },
  ) {
    return this.advanceService.create(req.user.companyId, dto, req.user.id);
  }

  @Post('supplier-advances/:id/cancel')
  @RequirePermission('finance.advances.cancel')
  @ApiOperation({ summary: 'Cancelar adiantamento não aplicado (#393)' })
  cancelAdvance(@Param('id') id: string, @Request() req: { user: { id?: string; companyId: string } }) {
    return this.advanceService.cancel(id, req.user.companyId, req.user.id);
  }

  // ─── Gestão de dívida (#392) ──────────────────────────────────────────────

  @Get('debts/dashboard')
  @RequirePermission('finance.debts.view')
  @ApiOperation({ summary: 'Endividamento: saldo por tipo + próximos vencimentos (#392)' })
  debtDashboard(@Request() req: { user: { companyId: string } }) {
    return this.debtService.dashboard(req.user.companyId);
  }

  @Get('debts')
  @RequirePermission('finance.debts.view')
  @ApiOperation({ summary: 'Listar dívidas/financiamentos (#392)' })
  listDebts(@Request() req: { user: { companyId: string } }) {
    return this.debtService.findAll(req.user.companyId);
  }

  @Post('debts')
  @RequirePermission('finance.debts.create')
  @ApiOperation({ summary: 'Contratar dívida — gera cronograma PRICE/SAC (#392)' })
  createDebt(@Body() dto: CreateDebtDto, @Request() req: { user: { id?: string; companyId: string } }) {
    return this.debtService.create(req.user.companyId, dto, req.user.id);
  }

  @Get('debts/:id')
  @RequirePermission('finance.debts.view')
  @ApiOperation({ summary: 'Dívida com cronograma completo (#392)' })
  getDebt(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.debtService.findOne(id, req.user.companyId);
  }

  @Post('debts/:id/installments/:number/pay')
  @RequirePermission('finance.debts.pay')
  @ApiOperation({ summary: 'Baixar parcela do financiamento (#392)' })
  payDebtInstallment(
    @Param('id') id: string,
    @Param('number') number: string,
    @Request() req: { user: { id?: string; companyId: string } },
  ) {
    return this.debtService.payInstallment(id, parseInt(number, 10), req.user.companyId, req.user.id);
  }

  @Get('management-book')
  @RequirePermission('finance.reports.export')
  @ApiOperation({ summary: 'Book gerencial mensal consolidado — JSON ou xlsx (#394)' })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM (default: mês anterior)' })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'xlsx'] })
  async managementBook(
    @Request() req: { user: { companyId: string } },
    @Res({ passthrough: true }) res: Response,
    @Query('month') month?: string,
    @Query('format') format?: string,
  ) {
    if (format === 'xlsx') {
      const buffer = await this.bookService.getBookXlsx(req.user.companyId, month);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="book-gerencial-${month ?? 'mes-anterior'}.xlsx"`,
      });
      return new StreamableFile(buffer);
    }
    return this.bookService.getBook(req.user.companyId, month);
  }

  @Get('reports/dre')
  @RequirePermission('finance.reports.view')
  @ApiOperation({ summary: 'DRE gerencial por período' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'costCenterId', required: false })
  getDre(
    @Request() req: { user: { companyId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('costCenterId') costCenterId?: string,
  ) {
    return this.financeService.getDre(req.user.companyId, { from, to, costCenterId });
  }

  @Get('cash-flow/projection')
  @RequirePermission('finance.reports.view')
  @ApiOperation({ summary: 'Fluxo de caixa projetado dia-a-dia' })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'bankAccountId', required: false })
  getCashFlowProjection(
    @Request() req: { user: { companyId: string } },
    @Query('days') days?: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.financeService.getCashFlowProjection(req.user.companyId, {
      days: days ? parseInt(days, 10) : undefined,
      bankAccountId,
    });
  }

  @Get('cashflow')
  @RequirePermission('finance.entries.view')
  @ApiOperation({ summary: 'Fluxo de caixa previsto (OPEN + OVERDUE)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getCashFlow(
    @Request() req: { user: { companyId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.getCashFlow(req.user.companyId, { from, to });
  }

  // NOTA: o handler `@Get(':id')` (findOne) fica no FIM da classe de propósito.
  // No NestJS a ordem de declaração define a ordem de match das rotas; um
  // `@Get(':id')` declarado antes de rotas GET estáticas (bank-accounts,
  // categories, cost-centers) as engoliria — "categories" viraria um :id e
  // devolveria 404 "lançamento não encontrado". Não mover para cima. (#787)

  @Patch(':id/pay')
  @RequirePermission('finance.entries.pay')
  @ApiOperation({ summary: 'Registrar pagamento/recebimento' })
  pay(
    @Param('id') id: string,
    @Body() dto: PayEntryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.pay(id, req.user.companyId, dto);
  }

  @Post(':id/installments')
  @RequirePermission('finance.entries.installment')
  @ApiOperation({ summary: 'Parcelar lançamento em N parcelas' })
  createInstallments(
    @Param('id') id: string,
    @Body() dto: CreateInstallmentsDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createInstallments(id, req.user.companyId, dto);
  }

  @Patch(':id/cancel')
  @RequirePermission('finance.entries.cancel')
  @ApiOperation({ summary: 'Cancelar lançamento' })
  cancel(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.financeService.cancel(id, req.user.companyId);
  }

  // ─── Contas bancárias ─────────────────────────────────────────────────────

  @Post('bank-accounts')
  @RequirePermission('finance.bank-accounts.create')
  @ApiOperation({ summary: 'Criar conta bancária' })
  createBankAccount(
    @Body() dto: CreateBankAccountDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createBankAccount(req.user.companyId, dto);
  }

  @Get('bank-accounts')
  @RequirePermission('finance.bank-accounts.view')
  @ApiOperation({ summary: 'Listar contas bancárias ativas' })
  findAllBankAccounts(@Request() req: { user: { companyId: string } }) {
    return this.financeService.findAllBankAccounts(req.user.companyId);
  }

  @Patch('bank-accounts/:id')
  @RequirePermission('finance.bank-accounts.update')
  @ApiOperation({ summary: 'Atualizar conta bancária' })
  updateBankAccount(
    @Param('id') id: string,
    @Body() dto: CreateBankAccountDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.updateBankAccount(id, req.user.companyId, dto);
  }

  @Delete('bank-accounts/:id')
  @RequirePermission('finance.bank-accounts.delete')
  @ApiOperation({ summary: 'Desativar conta bancária' })
  deactivateBankAccount(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.deactivateBankAccount(id, req.user.companyId);
  }

  @Get('bank-accounts/consolidated')
  @RequirePermission('finance.bank-accounts.view')
  @ApiOperation({ summary: 'Saldo consolidado de todas as contas' })
  getConsolidatedBalance(@Request() req: { user: { companyId: string } }) {
    return this.financeService.getConsolidatedBalance(req.user.companyId);
  }

  @Get('bank-accounts/:id/statement')
  @RequirePermission('finance.bank-accounts.view')
  @ApiOperation({ summary: 'Extrato por conta bancária' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getBankStatement(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.getBankStatement(id, req.user.companyId, { from, to });
  }

  // ─── Categorias gerenciais ───────────────────────────────────────────────

  @Post('categories')
  @RequirePermission('finance.categories.create')
  @ApiOperation({ summary: 'Criar categoria financeira' })
  createCategory(
    @Body() dto: CreateCategoryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createCategory(req.user.companyId, dto);
  }

  @Get('categories')
  @RequirePermission('finance.categories.view')
  @ApiOperation({ summary: 'Listar categorias hierárquicas' })
  findAllCategories(@Request() req: { user: { companyId: string } }) {
    return this.financeService.findAllCategories(req.user.companyId);
  }

  @Patch('categories/:id')
  @RequirePermission('finance.categories.update')
  @ApiOperation({ summary: 'Atualizar categoria' })
  updateCategory(
    @Param('id') id: string,
    @Body() dto: CreateCategoryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.updateCategory(id, req.user.companyId, dto);
  }

  @Delete('categories/:id')
  @RequirePermission('finance.categories.delete')
  @ApiOperation({ summary: 'Desativar categoria' })
  deactivateCategory(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.deactivateCategory(id, req.user.companyId);
  }

  // ─── Centros de custo ────────────────────────────────────────────────────

  @Post('cost-centers')
  @RequirePermission('finance.cost-centers.create')
  @ApiOperation({ summary: 'Criar centro de custo' })
  createCostCenter(
    @Body() dto: CreateCostCenterDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createCostCenter(req.user.companyId, dto);
  }

  @Get('cost-centers')
  @RequirePermission('finance.cost-centers.view')
  @ApiOperation({ summary: 'Listar centros de custo hierárquicos' })
  findAllCostCenters(@Request() req: { user: { companyId: string } }) {
    return this.financeService.findAllCostCenters(req.user.companyId);
  }

  @Patch('cost-centers/:id')
  @RequirePermission('finance.cost-centers.update')
  @ApiOperation({ summary: 'Atualizar centro de custo' })
  updateCostCenter(
    @Param('id') id: string,
    @Body() dto: CreateCostCenterDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.updateCostCenter(id, req.user.companyId, dto);
  }

  @Delete('cost-centers/:id')
  @RequirePermission('finance.cost-centers.delete')
  @ApiOperation({ summary: 'Desativar centro de custo' })
  deactivateCostCenter(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.deactivateCostCenter(id, req.user.companyId);
  }

  // Catch-all de ID: DEVE ser o último GET da classe (ver nota acima). (#787)
  @Get(':id')
  @RequirePermission('finance.entries.view')
  @ApiOperation({ summary: 'Buscar lançamento por ID' })
  findOne(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.financeService.findOne(id, req.user.companyId);
  }
}
