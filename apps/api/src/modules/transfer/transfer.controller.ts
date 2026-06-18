import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';

@UseGuards(JwtAuthGuard)
@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  create(
    @Body() dto: CreateTransferDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.transferService.create(dto, req.user.sub);
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
  dispatch(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.dispatch(id, req.user.companyId, req.user.sub);
  }

  @Patch(':id/receive')
  receive(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.receive(id, req.user.companyId, req.user.sub);
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.transferService.cancel(id, req.user.companyId, req.user.sub);
  }
}
