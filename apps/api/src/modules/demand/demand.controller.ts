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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DemandService } from './demand.service';
import { UpsertDemandDto } from './dto/upsert-demand.dto';

@UseGuards(JwtAuthGuard)
@Controller('demand')
export class DemandController {
  constructor(private readonly demandService: DemandService) {}

  // POST /demand — cria ou atualiza previsão de demanda
  @Post()
  upsert(
    @Body() dto: UpsertDemandDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.demandService.upsert(dto, req.user.sub);
  }

  // GET /demand?period=2026-05&productId=xxx
  @Get()
  findAll(
    @Request() req: { user: { companyId: string } },
    @Query('period') period?: string,
    @Query('productId') productId?: string,
  ) {
    return this.demandService.findAll(req.user.companyId, { period, productId });
  }

  // GET /demand/consolidated?period=2026-05&productId=xxx&parentCompanyId=yyy
  @Get('consolidated')
  getConsolidated(
    @Query('period') period?: string,
    @Query('productId') productId?: string,
    @Query('parentCompanyId') parentCompanyId?: string,
  ) {
    return this.demandService.getConsolidated({ period, productId, parentCompanyId });
  }

  // GET /demand/history/:productId
  @Get('history/:productId')
  getHistory(
    @Param('productId') productId: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.demandService.getHistory(productId, req.user.companyId);
  }

  // GET /demand/suggestions?parentCompanyId=yyy
  @Get('suggestions')
  getSuggestions(
    @Request() req: { user: { companyId: string } },
    @Query('parentCompanyId') parentCompanyId?: string,
  ) {
    return this.demandService.getSuggestions(req.user.companyId, parentCompanyId);
  }

  // PATCH /demand/horizon — configura mrp_horizon_days
  @Patch('horizon')
  setHorizon(
    @Request() req: { user: { companyId: string } },
    @Body('days') days: number,
  ) {
    return this.demandService.setHorizon(req.user.companyId, days);
  }

  // DELETE /demand/:id
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.demandService.remove(id, req.user.companyId, req.user.sub);
  }
}
