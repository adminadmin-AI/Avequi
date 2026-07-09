import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DispatchTransferDto } from './dto/dispatch-transfer.dto';

/**
 * #341 parte 2 (PR C): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #621).
 * Equivalência plena com o legado: ALMOXARIFE/LOJA operam, cancelar é gerência.
 */
@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @RequirePermission('stock.transfers.create')
  create(
    @Body() dto: CreateTransferDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.create(dto, req.user.companyId, req.user.sub);
  }

  @Get()
  @RequirePermission('stock.transfers.view')
  findAll(@Request() req: { user: { companyId: string } }) {
    return this.transferService.findAll(req.user.companyId);
  }

  @Get(':id')
  @RequirePermission('stock.transfers.view')
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.transferService.findOne(id, req.user.companyId);
  }

  @Patch(':id/dispatch')
  @RequirePermission('stock.transfers.dispatch')
  dispatch(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body() dto?: DispatchTransferDto,
  ) {
    return this.transferService.dispatch(id, req.user.companyId, req.user.sub, dto);
  }

  @Patch(':id/receive')
  @RequirePermission('stock.transfers.receive')
  receive(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.receive(id, req.user.companyId, req.user.sub);
  }

  @Patch(':id/cancel')
  @RequirePermission('stock.transfers.cancel')
  cancel(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.cancel(id, req.user.companyId, req.user.sub);
  }
}
