import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DispatchTransferDto } from './dto/dispatch-transfer.dto';

const TRANSFER_WRITE_ROLES = ['SUPER_ADMIN', 'MANAGER', 'WAREHOUSE', 'STORE'];

@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @Roles(...TRANSFER_WRITE_ROLES)
  create(
    @Body() dto: CreateTransferDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.create(dto, req.user.companyId, req.user.sub);
  }

  @Get()
  findAll(@Request() req: { user: { companyId: string } }) {
    return this.transferService.findAll(req.user.companyId);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.transferService.findOne(id, req.user.companyId);
  }

  @Patch(':id/dispatch')
  @Roles(...TRANSFER_WRITE_ROLES)
  dispatch(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body() dto?: DispatchTransferDto,
  ) {
    return this.transferService.dispatch(id, req.user.companyId, req.user.sub, dto);
  }

  @Patch(':id/receive')
  @Roles(...TRANSFER_WRITE_ROLES)
  receive(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.receive(id, req.user.companyId, req.user.sub);
  }

  @Patch(':id/cancel')
  @Roles('SUPER_ADMIN', 'MANAGER')
  cancel(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.cancel(id, req.user.companyId, req.user.sub);
  }
}
