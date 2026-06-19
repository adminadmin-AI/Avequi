import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { InboundNfeStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MatchNfeDto } from './dto/match-nfe.dto';
import { UploadNfeDto } from './dto/upload-nfe.dto';
import { InboundNfeService } from './inbound-nfe.service';

@UseGuards(JwtAuthGuard)
@Controller('inbound-nfe')
export class InboundNfeController {
  constructor(private readonly inboundNfeService: InboundNfeService) {}

  // POST /inbound-nfe/upload
  @Post('upload')
  upload(
    @Body() dto: UploadNfeDto,
    @Request() req: { user: { companyId: string; id?: string } },
  ) {
    return this.inboundNfeService.upload(req.user.companyId, dto, req.user.id);
  }

  // GET /inbound-nfe/stats
  @Get('stats')
  getStats(@Request() req: { user: { companyId: string } }) {
    return this.inboundNfeService.getStats(req.user.companyId);
  }

  // GET /inbound-nfe?status=PENDING
  @Get()
  list(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.inboundNfeService.list(req.user.companyId, {
      status: status as InboundNfeStatus | undefined,
    });
  }

  // GET /inbound-nfe/:id
  @Get(':id')
  getById(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.inboundNfeService.getById(id, req.user.companyId);
  }

  // PATCH /inbound-nfe/:id/match
  @Patch(':id/match')
  matchToPo(
    @Param('id') id: string,
    @Body() dto: MatchNfeDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.inboundNfeService.matchToPo(id, req.user.companyId, dto);
  }

  // PATCH /inbound-nfe/:id/reject
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req: { user: { companyId: string } },
  ) {
    return this.inboundNfeService.reject(id, req.user.companyId, body.reason);
  }

  // PATCH /inbound-nfe/:id/import
  @Patch(':id/import')
  importAsGr(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; id?: string } },
  ) {
    return this.inboundNfeService.importAsGr(id, req.user.companyId, req.user.id);
  }
}
