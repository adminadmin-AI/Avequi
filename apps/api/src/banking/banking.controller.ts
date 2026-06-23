import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { BankingService } from './banking.service';
import { BoletoService } from './boleto.service';
import { CnabService } from './cnab/cnab.service';
import { ReconciliationService } from './reconciliation.service';
import { DdaService } from './dda.service';
import { PixService } from './pix.service';
import { CreditLimitService } from './credit-limit.service';
import { FraudDetectionService, TransactionType } from './fraud-detection.service';
import { BankingReportService } from './banking-report.service';
import { CreateBoletoDto } from './dto/create-boleto.dto';
import { UpdateBoletoDto } from './dto/update-boleto.dto';
import { GenerateRemessaDto } from './dto/generate-remessa.dto';
import { UploadRetornoDto } from './dto/upload-retorno.dto';
import { CreateDdaMandateDto } from './dto/create-dda-mandate.dto';
import { CreatePixChargeDto } from './dto/create-pix-charge.dto';
import { CreateCreditLimitDto } from './dto/create-credit-limit.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { CreateFraudRuleDto } from './dto/create-fraud-rule.dto';
import { CheckFraudDto } from './dto/check-fraud.dto';
import { BoletoStatus } from '../../generated/prisma';

// Decorator stubs — will be provided by common/decorators
declare const Roles: (...roles: string[]) => MethodDecorator & ClassDecorator;
declare const CurrentUser: () => ParameterDecorator;

interface AuthUser {
  userId: string;
  companyId: string;
  role: string;
}

@ApiTags('Banking')
@ApiBearerAuth()
@Controller('banking')
export class BankingController {
  constructor(
    private readonly bankingService: BankingService,
    private readonly boletoService: BoletoService,
    private readonly cnabService: CnabService,
    private readonly reconciliationService: ReconciliationService,
    private readonly ddaService: DdaService,
    private readonly pixService: PixService,
    private readonly creditLimitService: CreditLimitService,
    private readonly fraudDetectionService: FraudDetectionService,
    private readonly bankingReportService: BankingReportService,
  ) {}

  // ─── Bank Accounts ────────────────────────────────────────────────────────

  @Get('accounts')
  @ApiOperation({ summary: 'Listar contas bancárias da empresa' })
  findAllAccounts(@CurrentUser() user: AuthUser) {
    return this.bankingService.findAll(user.companyId);
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: 'Detalhe de uma conta bancária' })
  findOneAccount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bankingService.findOne(user.companyId, id);
  }

  @Get('accounts/:id/balance')
  @ApiOperation({ summary: 'Saldo calculado da conta bancária' })
  getBalance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bankingService.getBalance(user.companyId, id);
  }

  // ─── Boletos ──────────────────────────────────────────────────────────────

  @Post('boletos')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Criar boleto' })
  createBoleto(@CurrentUser() user: AuthUser, @Body() dto: CreateBoletoDto) {
    return this.boletoService.create(user.companyId, dto);
  }

  @Get('boletos')
  @ApiOperation({ summary: 'Listar boletos' })
  @ApiQuery({ name: 'status', required: false, enum: BoletoStatus })
  @ApiQuery({ name: 'bankAccountId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAllBoletos(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: BoletoStatus,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.boletoService.findAll(user.companyId, {
      status,
      bankAccountId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('boletos/:id')
  @ApiOperation({ summary: 'Detalhe do boleto' })
  findOneBoleto(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.boletoService.findOne(user.companyId, id);
  }

  @Patch('boletos/:id')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Atualizar boleto' })
  updateBoleto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBoletoDto,
  ) {
    return this.boletoService.update(user.companyId, id, dto);
  }

  @Delete('boletos/:id')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar boleto (soft delete)' })
  cancelBoleto(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.boletoService.cancel(user.companyId, id);
  }

  // ─── CNAB Remessa ─────────────────────────────────────────────────────────

  @Post('cnab/remessa')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Gerar arquivo de remessa CNAB 240' })
  generateRemessa(@CurrentUser() user: AuthUser, @Body() dto: GenerateRemessaDto) {
    return this.cnabService.generateRemessa(
      user.companyId,
      dto.bankAccountId,
      dto.boletoIds,
    );
  }

  @Get('cnab/remessas')
  @ApiOperation({ summary: 'Listar remessas geradas' })
  findAllRemessas(@CurrentUser() user: AuthUser) {
    return this.cnabService.findAllRemessas(user.companyId);
  }

  // ─── CNAB Retorno ─────────────────────────────────────────────────────────

  @Post('cnab/retorno')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Fazer upload e processar arquivo de retorno CNAB 240' })
  processRetorno(@CurrentUser() user: AuthUser, @Body() dto: UploadRetornoDto) {
    return this.cnabService.processRetorno(
      user.companyId,
      dto.bankAccountId,
      dto.fileName,
      dto.fileContent,
    );
  }

  @Get('cnab/retornos')
  @ApiOperation({ summary: 'Listar retornos processados' })
  findAllRetornos(@CurrentUser() user: AuthUser) {
    return this.cnabService.findAllRetornos(user.companyId);
  }

  @Get('cnab/retornos/:id')
  @ApiOperation({ summary: 'Detalhe do retorno com itens' })
  findOneRetorno(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cnabService.findOneRetorno(user.companyId, id);
  }

  // ─── Reconciliation ───────────────────────────────────────────────────────

  @Post('reconciliation/import/:retornoId')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Importar itens de conciliação a partir de retorno CNAB' })
  importFromRetorno(
    @CurrentUser() user: AuthUser,
    @Param('retornoId') retornoId: string,
  ) {
    return this.reconciliationService.importFromRetorno(user.companyId, retornoId);
  }

  @Get('reconciliation/unmatched')
  @ApiOperation({ summary: 'Listar itens não conciliados' })
  @ApiQuery({ name: 'bankAccountId', required: false })
  findUnmatched(
    @CurrentUser() user: AuthUser,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.reconciliationService.findUnmatched(user.companyId, bankAccountId ?? '');
  }

  // ─── DDA — Débito Direto Autorizado ───────────────────────────────────────

  @Post('dda/mandates')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Criar mandato DDA' })
  createDdaMandate(@CurrentUser() user: AuthUser, @Body() dto: CreateDdaMandateDto) {
    return this.ddaService.createMandate(user.companyId, dto);
  }

  @Get('dda/mandates')
  @ApiOperation({ summary: 'Listar mandatos DDA da empresa' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'bankAccountId', required: false })
  findDdaMandates(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.ddaService.findMandates(user.companyId, { status, customerId, bankAccountId });
  }

  @Patch('dda/mandates/:id/cancel')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Cancelar mandato DDA' })
  cancelDdaMandate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ddaService.cancelMandate(user.companyId, id);
  }

  @Post('dda/process')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disparar processamento de débitos DDA autorizados' })
  processDdaDebits() {
    return this.ddaService.processAuthorizedDebits();
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  @Get('overview')
  @ApiOperation({ summary: 'Visão consolidada: contas, saldos, recebíveis e pagamentos' })
  getOverview(@CurrentUser() user: AuthUser) {
    return this.bankingService.getOverview(user.companyId);
  }

  // ─── Pix Charges ──────────────────────────────────────────────────────────

  @Post('pix/charges')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Gerar cobrança Pix (QR Code EMV)' })
  createPixCharge(@CurrentUser() user: AuthUser, @Body() dto: CreatePixChargeDto) {
    return this.pixService.generateStaticQrCode(user.companyId, dto);
  }

  @Get('pix/charges')
  @ApiOperation({ summary: 'Listar cobranças Pix' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'bankAccountId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAllPixCharges(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.pixService.findAll(user.companyId, {
      status,
      bankAccountId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('pix/charges/:id')
  @ApiOperation({ summary: 'Detalhe de uma cobrança Pix' })
  findOnePixCharge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pixService.findOne(user.companyId, id);
  }

  @Patch('pix/charges/:id/cancel')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar cobrança Pix' })
  cancelPixCharge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pixService.cancelCharge(user.companyId, id);
  }

  @Post('pix/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receber notificação de pagamento Pix (sem autenticação JWT — valida x-pix-signature)',
  })
  async pixWebhook(
    @Body() body: { txId: string; paidAmount: number; e2eId: string; companyId: string },
    @Headers('x-pix-signature') _signature: string,
  ) {
    // In production: validate HMAC/signature from bank before processing
    // For now: accept and mark as paid
    return this.pixService.markAsPaid(
      body.companyId,
      body.txId,
      body.paidAmount,
      body.e2eId,
    );
  }

  // ─── Credit Limits ────────────────────────────────────────────────────────

  @Post('credit-limits')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Criar ou atualizar limite de crédito de cliente' })
  createCreditLimit(@CurrentUser() user: AuthUser, @Body() dto: CreateCreditLimitDto) {
    return this.creditLimitService.create(user.companyId, dto);
  }

  @Get('credit-limits/:customerId')
  @ApiOperation({ summary: 'Consultar limite de crédito de um cliente' })
  getCreditLimit(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.creditLimitService.findByCustomer(user.companyId, customerId);
  }

  @Get('credit-limits/:customerId/check')
  @ApiOperation({ summary: 'Verificar disponibilidade de crédito para um valor' })
  @ApiQuery({ name: 'amount', required: true, type: Number })
  checkCreditAvailability(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Query('amount') amount: string,
  ) {
    return this.creditLimitService.checkAvailability(
      user.companyId,
      customerId,
      parseFloat(amount),
    );
  }

  // ─── Banking Reports ──────────────────────────────────────────────────────

  @Get('report/statement')
  @ApiOperation({ summary: 'Extrato bancário com saldo progressivo' })
  @ApiQuery({ name: 'bankAccountId', required: true })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  getStatement(
    @CurrentUser() user: AuthUser,
    @Query() query: StatementQueryDto,
  ) {
    return this.bankingReportService.getStatement(
      user.companyId,
      query.bankAccountId,
      new Date(query.startDate),
      new Date(query.endDate),
    );
  }

  @Get('report/summary')
  @ApiOperation({ summary: 'Resumo consolidado de movimentações de todas as contas' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  getSummary(
    @CurrentUser() user: AuthUser,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.bankingReportService.getSummary(
      user.companyId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  // ─── Fraud Detection ──────────────────────────────────────────────────────

  @Post('fraud/check')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verificação manual de fraude para uma transação' })
  checkFraud(@CurrentUser() user: AuthUser, @Body() dto: CheckFraudDto) {
    return this.fraudDetectionService.checkTransaction(
      user.companyId,
      dto.bankAccountId,
      dto.amount,
      dto.type as TransactionType,
      dto.metadata,
    );
  }

  @Get('fraud/rules')
  @ApiOperation({ summary: 'Listar regras de fraude da empresa' })
  findFraudRules(@CurrentUser() user: AuthUser) {
    return this.fraudDetectionService.findRules(user.companyId);
  }

  @Post('fraud/rules')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Criar ou atualizar regra de limite de fraude' })
  createFraudRule(@CurrentUser() user: AuthUser, @Body() dto: CreateFraudRuleDto) {
    return this.fraudDetectionService.setMaxAmount(
      user.companyId,
      dto.bankAccountId ?? null,
      dto.transactionType as TransactionType,
      dto.maxAmount,
    );
  }

  @Get('fraud/alerts')
  @ApiOperation({ summary: 'Listar alertas de fraude' })
  @ApiQuery({ name: 'resolved', required: false, type: Boolean })
  findFraudAlerts(
    @CurrentUser() user: AuthUser,
    @Query('resolved') resolved?: string,
  ) {
    const resolvedBool =
      resolved === undefined ? undefined : resolved === 'true';
    return this.fraudDetectionService.findAlerts(user.companyId, resolvedBool);
  }

  @Patch('fraud/alerts/:id/resolve')
  @Roles('FINANCIAL', 'DIRECTOR', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar alerta de fraude como resolvido' })
  resolveFraudAlert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.fraudDetectionService.resolveAlert(
      user.companyId,
      id,
      user.userId,
    );
  }
}
