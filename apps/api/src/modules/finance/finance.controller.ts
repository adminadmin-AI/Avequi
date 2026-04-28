import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { FinanceService } from './finance.service';
import { PayEntryDto } from './dto/pay-entry.dto';

@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // GET /finance?type=RECEIVABLE&status=OPEN&dueDateFrom=2026-01-01&dueDateTo=2026-12-31
  @Get()
  findAll(
    @Request() req: { user: { companyId: string } },
    @Query('type') type?: FinancialEntryType,
    @Query('status') status?: FinancialEntryStatus,
    @Query('dueDateFrom') dueDateFrom?: string,
    @Query('dueDateTo') dueDateTo?: string,
  ) {
    return this.financeService.findAll(req.user.companyId, {
      type,
      status,
      dueDateFrom,
      dueDateTo,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.financeService.findOne(id, req.user.companyId);
  }

  // PATCH /finance/:id/pay
  @Patch(':id/pay')
  pay(
    @Param('id') id: string,
    @Body() dto: PayEntryDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.pay(id, req.user.companyId, dto);
  }

  // PATCH /finance/:id/cancel
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Request() req: { user: { companyId: string } }) {
    return this.financeService.cancel(id, req.user.companyId);
  }
}
