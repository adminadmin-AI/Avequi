import {
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ScheduledPaymentStatus } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FinanceService } from './finance.service';
import { ReconciliationService } from './reconciliation.service';
import { CreateEntryFromStatementDto, ImportOfxDto, MatchStatementDto } from './dto/reconciliation.dto';
import { ConfigureBankAccountDto } from './dto/configure-bank-account.dto';
import { CreateScheduledPaymentDto } from './dto/create-scheduled-payment.dto';

/**
 * #341 parte 2 (PR E1): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz Rafael, issue #623). Conciliação é
 * finance.reconciliation.execute (FINANCEIRO/G.FINANCEIRO); configurar conta
 * é finance.banking.configure (G.FINANCEIRO); DIRETOR só leitura.
 */
@ApiTags('Banking')
@ApiBearerAuth()
@Controller('banking')
export class BankingController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  // ─── Bank Accounts ──────────────────────────────────────────────────────

  @Get('accounts')
  @RequirePermission('finance.banking.view')
  @ApiOperation({ summary: 'Listar contas bancárias' })
  findAllAccounts(@Request() req: { user: { companyId: string } }) {
    return this.financeService.findAllBankAccounts(req.user.companyId);
  }

  @Get('overview')
  @RequirePermission('finance.banking.view')
  @ApiOperation({ summary: 'Visão geral bancária: saldo total, contas abaixo do mínimo' })
  getOverview(@Request() req: { user: { companyId: string } }) {
    return this.financeService.getBankingOverview(req.user.companyId);
  }

  @Get('cash-flow/weekly')
  @RequirePermission('finance.reports.view')
  @ApiOperation({ summary: 'Fluxo de caixa 13 semanas rolantes (#383)' })
  @ApiQuery({ name: 'weeks', required: false })
  @ApiQuery({ name: 'bankAccountId', required: false })
  cashFlowWeekly(
    @Request() req: { user: { companyId: string } },
    @Query('weeks') weeks?: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.financeService.getCashFlowWeekly(req.user.companyId, {
      weeks: weeks ? parseInt(weeks, 10) : undefined,
      bankAccountId,
    });
  }

  @Get('cash-flow/monthly')
  @RequirePermission('finance.reports.view')
  @ApiOperation({ summary: 'Fluxo de caixa 12 meses rolantes (#383)' })
  @ApiQuery({ name: 'months', required: false })
  @ApiQuery({ name: 'bankAccountId', required: false })
  cashFlowMonthly(
    @Request() req: { user: { companyId: string } },
    @Query('months') months?: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.financeService.getCashFlowMonthly(req.user.companyId, {
      months: months ? parseInt(months, 10) : undefined,
      bankAccountId,
    });
  }

  @Get('cash-flow/scenarios')
  @RequirePermission('finance.reports.view')
  @ApiOperation({ summary: 'Projeção de caixa em 3 cenários: base, otimista, estresse (#390)' })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'bankAccountId', required: false })
  cashFlowScenarios(
    @Request() req: { user: { companyId: string } },
    @Query('days') days?: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.financeService.getCashFlowScenarios(req.user.companyId, {
      days: days ? parseInt(days, 10) : undefined,
      bankAccountId,
    });
  }

  // ─── Conciliação bancária (#385) ──────────────────────────────────────────

  @Post('reconciliation/import')
  @RequirePermission('finance.reconciliation.execute')
  @ApiOperation({ summary: 'Importar OFX e rodar match automático (#385)' })
  importOfx(@Body() dto: ImportOfxDto, @Request() req: { user: { companyId: string } }) {
    return this.reconciliation.importOfx(req.user.companyId, dto.bankAccountId, dto.ofxContent);
  }

  @Post('reconciliation/auto-match')
  @RequirePermission('finance.reconciliation.execute')
  @ApiOperation({ summary: 'Rodar match automático nos itens não conciliados (#385)' })
  @ApiQuery({ name: 'bankAccountId', required: false })
  autoMatch(@Request() req: { user: { companyId: string } }, @Query('bankAccountId') bankAccountId?: string) {
    return this.reconciliation.autoMatch(req.user.companyId, bankAccountId);
  }

  @Get('reconciliation/unmatched')
  @RequirePermission('finance.banking.view')
  @ApiOperation({ summary: 'Itens do extrato sem correspondência + sugestões (#385)' })
  @ApiQuery({ name: 'bankAccountId', required: false })
  getUnmatchedReconciliation(
    @Request() req: { user: { companyId: string } },
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.reconciliation.getUnmatched(req.user.companyId, bankAccountId);
  }

  @Post('reconciliation/:statementId/match')
  @RequirePermission('finance.reconciliation.execute')
  @ApiOperation({ summary: 'Vincular manualmente item do extrato a um lançamento (#385)' })
  matchManual(
    @Param('statementId') statementId: string,
    @Body() dto: MatchStatementDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.reconciliation.matchManual(req.user.companyId, statementId, dto.entryId);
  }

  @Post('reconciliation/:statementId/unmatch')
  @RequirePermission('finance.reconciliation.execute')
  @ApiOperation({ summary: 'Desfazer conciliação de um item do extrato (#385)' })
  unmatch(@Param('statementId') statementId: string, @Request() req: { user: { companyId: string } }) {
    return this.reconciliation.unmatch(req.user.companyId, statementId);
  }

  @Post('reconciliation/:statementId/create-entry')
  @RequirePermission('finance.entries.create')
  @ApiOperation({ summary: 'Criar lançamento avulso a partir de item do extrato (tarifas etc.) (#385)' })
  createEntryFromStatement(
    @Param('statementId') statementId: string,
    @Body() dto: CreateEntryFromStatementDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.reconciliation.createEntryFromStatement(req.user.companyId, statementId, dto);
  }

  @Get('accounts/:id')
  @RequirePermission('finance.banking.view')
  @ApiOperation({ summary: 'Buscar conta bancária por ID' })
  findOneAccount(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.findOneBankAccount(req.user.companyId, id);
  }

  @Get('accounts/:id/balance')
  @RequirePermission('finance.banking.view')
  @ApiOperation({ summary: 'Saldo da conta com verificação de mínimo' })
  getAccountBalance(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.getBankAccountBalance(req.user.companyId, id);
  }

  @Patch('accounts/:id/configure')
  @RequirePermission('finance.banking.configure')
  @ApiOperation({ summary: 'Configurar provider, PIX, saldo mínimo' })
  configureAccount(
    @Param('id') id: string,
    @Body() dto: ConfigureBankAccountDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.configureBankAccount(req.user.companyId, id, dto);
  }

  // ─── Scheduled Payments ──────────────────────────────────────────────────

  @Post('schedule')
  @RequirePermission('finance.payment-schedules.create')
  @ApiOperation({ summary: 'Agendar pagamento' })
  createSchedule(
    @Body() dto: CreateScheduledPaymentDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createScheduledPayment(req.user.companyId, dto);
  }

  @Get('schedules')
  @RequirePermission('finance.payment-schedules.view')
  @ApiOperation({ summary: 'Listar pagamentos agendados' })
  @ApiQuery({ name: 'status', required: false, enum: ScheduledPaymentStatus })
  findAllSchedules(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: ScheduledPaymentStatus,
  ) {
    return this.financeService.findAllScheduledPayments(req.user.companyId, status);
  }

  @Delete('schedule/:id')
  @RequirePermission('finance.payment-schedules.delete')
  @ApiOperation({ summary: 'Cancelar agendamento (apenas PENDING)' })
  cancelSchedule(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.cancelScheduledPayment(req.user.companyId, id);
  }

  // ─── Boleto stubs (integration not configured) ───────────────────────────

  @Get('boletos')
  @RequirePermission('finance.boletos.view')
  @ApiOperation({ summary: 'Listar boletos (stub)' })
  listBoletos() {
    return { data: [], total: 0 };
  }

  @Post('boletos')
  @RequirePermission('finance.boletos.create')
  @ApiOperation({ summary: 'Criar boleto (stub — integração não configurada)' })
  createBoleto() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }

  @Delete('boletos/:id')
  @RequirePermission('finance.boletos.delete')
  @ApiOperation({ summary: 'Cancelar boleto (stub — integração não configurada)' })
  deleteBoleto() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }

  // ─── PIX stubs (integration not configured) ──────────────────────────────

  @Get('pix/charges')
  @RequirePermission('finance.pix.view')
  @ApiOperation({ summary: 'Listar cobranças PIX (stub)' })
  listPixCharges() {
    return { data: [], total: 0 };
  }

  @Post('pix/charges')
  @RequirePermission('finance.pix.create')
  @ApiOperation({ summary: 'Criar cobrança PIX (stub — integração não configurada)' })
  createPixCharge() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }

  @Patch('pix/charges/:id/cancel')
  @RequirePermission('finance.pix.cancel')
  @ApiOperation({ summary: 'Cancelar cobrança PIX (stub — integração não configurada)' })
  cancelPixCharge() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }
}
