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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FinanceService } from './finance.service';
import { PayEntryDto } from './dto/pay-entry.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateInstallmentsDto } from './dto/create-installments.dto';

@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // ─── Lançamentos financeiros ──────────────────────────────────────────────

  @Get()
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

  @Get('cashflow')
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

  @Get(':id')
  @ApiOperation({ summary: 'Buscar lançamento por ID' })
  findOne(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.financeService.findOne(id, req.user.companyId);
  }

  @Patch(':id/pay')
  @ApiOperation({ summary: 'Registrar pagamento/recebimento' })
  pay(
    @Param('id') id: string,
    @Body() dto: PayEntryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.pay(id, req.user.companyId, dto);
  }

  @Post(':id/installments')
  @ApiOperation({ summary: 'Parcelar lançamento em N parcelas' })
  createInstallments(
    @Param('id') id: string,
    @Body() dto: CreateInstallmentsDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createInstallments(id, req.user.companyId, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancelar lançamento' })
  cancel(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.financeService.cancel(id, req.user.companyId);
  }

  // ─── Contas bancárias ─────────────────────────────────────────────────────

  @Post('bank-accounts')
  @ApiOperation({ summary: 'Criar conta bancária' })
  createBankAccount(
    @Body() dto: CreateBankAccountDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createBankAccount(req.user.companyId, dto);
  }

  @Get('bank-accounts')
  @ApiOperation({ summary: 'Listar contas bancárias ativas' })
  findAllBankAccounts(@Request() req: { user: { companyId: string } }) {
    return this.financeService.findAllBankAccounts(req.user.companyId);
  }

  @Patch('bank-accounts/:id')
  @ApiOperation({ summary: 'Atualizar conta bancária' })
  updateBankAccount(
    @Param('id') id: string,
    @Body() dto: CreateBankAccountDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.updateBankAccount(id, req.user.companyId, dto);
  }

  @Delete('bank-accounts/:id')
  @ApiOperation({ summary: 'Desativar conta bancária' })
  deactivateBankAccount(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.deactivateBankAccount(id, req.user.companyId);
  }
}
