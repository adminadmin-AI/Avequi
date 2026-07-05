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
} from '@nestjs/common';
import { QuotationStatus } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { RejectQuotationDto } from './dto/reject-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationService } from './quotation.service';

const QUOTATION_WRITE_ROLES = ['SUPER_ADMIN', 'MANAGER', 'COMMERCIAL'];

@Controller('quotations')
export class QuotationController {
  constructor(private readonly quotationService: QuotationService) {}

  // GET /quotations
  @Get()
  list(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.quotationService.list(req.user.companyId, {
      status: status as QuotationStatus | undefined,
      customerId,
    });
  }

  // POST /quotations
  @Post()
  @Roles(...QUOTATION_WRITE_ROLES)
  create(
    @Request() req: { user: { companyId: string; id?: string } },
    @Body() dto: CreateQuotationDto,
  ) {
    return this.quotationService.create(req.user.companyId, dto, req.user.id);
  }

  // GET /quotations/stats
  @Get('stats')
  getStats(@Request() req: { user: { companyId: string } }) {
    return this.quotationService.getStats(req.user.companyId);
  }

  // GET /quotations/:id
  @Get(':id')
  getById(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.getById(id, req.user.companyId);
  }

  // PATCH /quotations/:id
  @Patch(':id')
  @Roles(...QUOTATION_WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationService.update(id, req.user.companyId, dto);
  }

  // DELETE /quotations/:id
  @Delete(':id')
  @Roles('SUPER_ADMIN', 'MANAGER')
  delete(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.delete(id, req.user.companyId);
  }

  // PATCH /quotations/:id/send
  @Patch(':id/send')
  @Roles(...QUOTATION_WRITE_ROLES)
  send(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.send(id, req.user.companyId);
  }

  // PATCH /quotations/:id/approve
  @Patch(':id/approve')
  @Roles(...QUOTATION_WRITE_ROLES)
  approve(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.approve(id, req.user.companyId);
  }

  // PATCH /quotations/:id/reject
  @Patch(':id/reject')
  @Roles(...QUOTATION_WRITE_ROLES)
  reject(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: RejectQuotationDto,
  ) {
    return this.quotationService.reject(id, req.user.companyId, dto);
  }

  // PATCH /quotations/:id/convert
  @Patch(':id/convert')
  @Roles(...QUOTATION_WRITE_ROLES)
  convert(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; id?: string } },
  ) {
    return this.quotationService.convert(id, req.user.companyId, req.user.id);
  }

  // PATCH /quotations/:id/expire
  @Patch(':id/expire')
  @Roles(...QUOTATION_WRITE_ROLES)
  expire(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.expire(id, req.user.companyId);
  }
}
