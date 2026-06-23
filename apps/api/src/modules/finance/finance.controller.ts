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
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { CreateManualEntryDto } from './dto/create-manual-entry.dto';

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

  @Post('entries/manual')
  @ApiOperation({ summary: 'Criar lançamento manual (avulso)' })
  createManualEntry(
    @Body() dto: CreateManualEntryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createManualEntry(req.user.companyId, dto);
  }

  @Get('reports/dre')
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

  @Get('bank-accounts/consolidated')
  @ApiOperation({ summary: 'Saldo consolidado de todas as contas' })
  getConsolidatedBalance(@Request() req: { user: { companyId: string } }) {
    return this.financeService.getConsolidatedBalance(req.user.companyId);
  }

  @Get('bank-accounts/:id/statement')
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
  @ApiOperation({ summary: 'Criar categoria financeira' })
  createCategory(
    @Body() dto: CreateCategoryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createCategory(req.user.companyId, dto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Listar categorias hierárquicas' })
  findAllCategories(@Request() req: { user: { companyId: string } }) {
    return this.financeService.findAllCategories(req.user.companyId);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Atualizar categoria' })
  updateCategory(
    @Param('id') id: string,
    @Body() dto: CreateCategoryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.updateCategory(id, req.user.companyId, dto);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Desativar categoria' })
  deactivateCategory(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.deactivateCategory(id, req.user.companyId);
  }

  // ─── Centros de custo ────────────────────────────────────────────────────

  @Post('cost-centers')
  @ApiOperation({ summary: 'Criar centro de custo' })
  createCostCenter(
    @Body() dto: CreateCostCenterDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.createCostCenter(req.user.companyId, dto);
  }

  @Get('cost-centers')
  @ApiOperation({ summary: 'Listar centros de custo hierárquicos' })
  findAllCostCenters(@Request() req: { user: { companyId: string } }) {
    return this.financeService.findAllCostCenters(req.user.companyId);
  }

  @Patch('cost-centers/:id')
  @ApiOperation({ summary: 'Atualizar centro de custo' })
  updateCostCenter(
    @Param('id') id: string,
    @Body() dto: CreateCostCenterDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.updateCostCenter(id, req.user.companyId, dto);
  }

  @Delete('cost-centers/:id')
  @ApiOperation({ summary: 'Desativar centro de custo' })
  deactivateCostCenter(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.deactivateCostCenter(id, req.user.companyId);
  }
}
