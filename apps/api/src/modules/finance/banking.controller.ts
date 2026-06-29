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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ScheduledPaymentStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FinanceService } from './finance.service';
import { ConfigureBankAccountDto } from './dto/configure-bank-account.dto';
import { CreateScheduledPaymentDto } from './dto/create-scheduled-payment.dto';

@ApiTags('Banking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('banking')
export class BankingController {
  constructor(private readonly financeService: FinanceService) {}

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

  @Get('reconciliation/unmatched')
  @ApiOperation({ summary: 'Conciliação: lançamentos sem correspondência (placeholder)' })
  getUnmatchedReconciliation() {
    return [];
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
  @ApiOperation({ summary: 'Criar boleto (stub — integração não configurada)' })
  createBoleto() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }

  @Delete('boletos/:id')
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
  @ApiOperation({ summary: 'Criar cobrança PIX (stub — integração não configurada)' })
  createPixCharge() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }

  @Patch('pix/charges/:id/cancel')
  @ApiOperation({ summary: 'Cancelar cobrança PIX (stub — integração não configurada)' })
  cancelPixCharge() {
    throw new NotImplementedException('Boleto/PIX integration not configured. Configure a bank provider first.');
  }
}
