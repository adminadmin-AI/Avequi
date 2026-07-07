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
import { Roles } from '../../common/decorators/roles.decorator';
import { FinanceService } from './finance.service';
import { ReconciliationService } from './reconciliation.service';
import { CreateEntryFromStatementDto, ImportOfxDto, MatchStatementDto } from './dto/reconciliation.dto';
import { ConfigureBankAccountDto } from './dto/configure-bank-account.dto';
import { CreateScheduledPaymentDto } from './dto/create-scheduled-payment.dto';

// Leitura restrita: dados bancários são sensíveis
const BANKING_READ_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL'];
const BANKING_WRITE_ROLES = ['SUPER_ADMIN', 'FINANCIAL'];

@ApiTags('Banking')
@ApiBearerAuth()
@Roles(...BANKING_READ_ROLES)
@Controller('banking')
export class BankingController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  // ─── Bank Accounts ──────────────────────────────────────────────────────

  @Get('accounts')
  @ApiOperation({ summary: 'Listar contas bancárias' })
  findAllAccounts(@Request() req: { user: { companyId: string } }) {
    return this.financeService.findAllBankAccounts(req.user.companyId);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Visão geral bancária: saldo total, contas abaixo do mínimo' })
  getOverview(@Request() req: { user: { companyId: string } }) {
    return this.financeService.getBankingOverview(req.user.companyId);
  }

  @Get('cash-flow/weekly')
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
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Importar OFX e rodar match automático (#385)' })
  importOfx(@Body() dto: ImportOfxDto, @Request() req: { user: { companyId: string } }) {
    return this.reconciliation.importOfx(req.user.companyId, dto.bankAccountId, dto.ofxContent);
  }

  @Post('reconciliation/auto-match')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Rodar match automático nos itens não conciliados (#385)' })
  @ApiQuery({ name: 'bankAccountId', required: false })
  autoMatch(@Request() req: { user: { companyId: string } }, @Query('bankAccountId') bankAccountId?: string) {
    return this.reconciliation.autoMatch(req.user.companyId, bankAccountId);
  }

  @Get('reconciliation/unmatched')
  @ApiOperation({ summary: 'Itens do extrato sem correspondência + sugestões (#385)' })
  @ApiQuery({ name: 'bankAccountId', required: false })
  getUnmatchedReconciliation(
    @Request() req: { user: { companyId: string } },
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.reconciliation.getUnmatched(req.user.companyId, bankAccountId);
  }

  @Post('reconciliation/:statementId/match')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Vincular manualmente item do extrato a um lançamento (#385)' })
  matchManual(
    @Param('statementId') statementId: string,
    @Body() dto: MatchStatementDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.reconciliation.matchManual(req.user.companyId, statementId, dto.entryId);
  }

  @Post('reconciliation/:statementId/unmatch')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Desfazer conciliação de um item do extrato (#385)' })
  unmatch(@Param('statementId') statementId: string, @Request() req: { user: { companyId: string } }) {
    return this.reconciliation.unmatch(req.user.companyId, statementId);
  }

  @Post('reconciliation/:statementId/create-entry')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Criar lançamento avulso a partir de item do extrato (tarifas etc.) (#385)' })
  createEntryFromStatement(
    @Param('statementId') statementId: string,
    @Body() dto: CreateEntryFromStatementDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.reconciliation.createEntryFromStatement(req.user.companyId, statementId, dto);
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: 'Buscar conta bancária por ID' })
  findOneAccount(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.findOneBankAccount(req.user.companyId, id);
  }

  @Get('accounts/:id/balance')
  @ApiOperation({ summary: 'Saldo da conta com verificação de mínimo' })
  getAccountBalance(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.getBankAccountBalance(req.user.companyId, id);
  }

  @Patch('accounts/:id/configure')
  @Roles(...BANKING_WRITE_ROLES)
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
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Agendar pagamento' })
  createSchedule(
    @Body() dto: CreateScheduledPaymentDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createScheduledPayment(req.user.companyId, dto);
  }

  @Get('schedules')
  @ApiOperation({ summary: 'Listar pagamentos agendados' })
  @ApiQuery({ name: 'status', required: false, enum: ScheduledPaymentStatus })
  findAllSchedules(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: ScheduledPaymentStatus,
  ) {
    return this.financeService.findAllScheduledPayments(req.user.companyId, status);
  }

  @Delete('schedule/:id')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Cancelar agendamento (apenas PENDING)' })
  cancelSchedule(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.cancelScheduledPayment(req.user.companyId, id);
  }

  // ─── Boleto stubs (integration not configured) ───────────────────────────

  @Get('boletos')
  @ApiOperation({ summary: 'Listar boletos (stub)' })
  listBoletos() {
    return { data: [], total: 0 };
  }

  @Post('boletos')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Criar boleto (stub — integração não configurada)' })
  createBoleto() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }

  @Delete('boletos/:id')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Cancelar boleto (stub — integração não configurada)' })
  deleteBoleto() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }

  // ─── PIX stubs (integration not configured) ──────────────────────────────

  @Get('pix/charges')
  @ApiOperation({ summary: 'Listar cobranças PIX (stub)' })
  listPixCharges() {
    return { data: [], total: 0 };
  }

  @Post('pix/charges')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Criar cobrança PIX (stub — integração não configurada)' })
  createPixCharge() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }

  @Patch('pix/charges/:id/cancel')
  @Roles(...BANKING_WRITE_ROLES)
  @ApiOperation({ summary: 'Cancelar cobrança PIX (stub — integração não configurada)' })
  cancelPixCharge() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }
}
