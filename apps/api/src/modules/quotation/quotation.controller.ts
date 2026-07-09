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
} from '@nestjs/common';
import type { Response } from 'express';
import { QuotationStatus } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { RejectQuotationDto } from './dto/reject-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationService } from './quotation.service';
import { QuotationPdfService } from './quotation-pdf.service';

/**
 * #341 parte 2 (PR C): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #621).
 *
 * Decisão de produto: VENDEDOR cria/edita/envia/converte orçamento, mas
 * aprovar/rejeitar/expirar é do COORDENADOR_COMERCIAL para cima (catálogo v2).
 */
@Controller('quotations')
export class QuotationController {
  constructor(
    private readonly quotationService: QuotationService,
    private readonly quotationPdfService: QuotationPdfService,
  ) {}

  // GET /quotations/:id/pdf — proposta comercial em PDF (#572)
  @Get(':id/pdf')
  @RequirePermission('sales.quotations.view')
  async pdf(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.quotationPdfService.generate(id, req.user.companyId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  // GET /quotations
  @Get()
  @RequirePermission('sales.quotations.view')
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
  @RequirePermission('sales.quotations.create')
  create(
    @Request() req: { user: { companyId: string; id?: string } },
    @Body() dto: CreateQuotationDto,
  ) {
    return this.quotationService.create(req.user.companyId, dto, req.user.id);
  }

  // GET /quotations/stats
  @Get('stats')
  @RequirePermission('sales.quotations.view')
  getStats(@Request() req: { user: { companyId: string } }) {
    return this.quotationService.getStats(req.user.companyId);
  }

  // GET /quotations/:id
  @Get(':id')
  @RequirePermission('sales.quotations.view')
  getById(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.getById(id, req.user.companyId);
  }

  // PATCH /quotations/:id
  @Patch(':id')
  @RequirePermission('sales.quotations.update')
  update(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationService.update(id, req.user.companyId, dto);
  }

  // DELETE /quotations/:id
  @Delete(':id')
  @RequirePermission('sales.quotations.delete')
  delete(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.delete(id, req.user.companyId);
  }

  // PATCH /quotations/:id/send
  @Patch(':id/send')
  @RequirePermission('sales.quotations.send')
  send(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.send(id, req.user.companyId);
  }

  // PATCH /quotations/:id/approve
  @Patch(':id/approve')
  @RequirePermission('sales.quotations.approve')
  approve(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.approve(id, req.user.companyId);
  }

  // PATCH /quotations/:id/reject
  @Patch(':id/reject')
  @RequirePermission('sales.quotations.reject')
  reject(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: RejectQuotationDto,
  ) {
    return this.quotationService.reject(id, req.user.companyId, dto);
  }

  // PATCH /quotations/:id/convert
  @Patch(':id/convert')
  @RequirePermission('sales.quotations.convert')
  convert(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; id?: string } },
  ) {
    return this.quotationService.convert(id, req.user.companyId, req.user.id);
  }

  // PATCH /quotations/:id/expire
  @Patch(':id/expire')
  @RequirePermission('sales.quotations.expire')
  expire(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.quotationService.expire(id, req.user.companyId);
  }
}
