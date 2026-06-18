import { Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MrpService } from './mrp.service';

@UseGuards(JwtAuthGuard)
@Controller('mrp')
export class MrpController {
  constructor(private readonly mrpService: MrpService) {}

  // POST /mrp/run — dispara nova rodada MRP
  @Post('run')
  run(@Request() req: { user: { companyId: string; sub: string } }) {
    return this.mrpService.run(req.user.companyId, req.user.sub);
  }

  // GET /mrp/runs — lista rodadas da empresa
  @Get('runs')
  findAll(@Request() req: { user: { companyId: string } }) {
    return this.mrpService.findAll(req.user.companyId);
  }

  // GET /mrp/runs/:id — detalhe com todas as sugestões
  @Get('runs/:id')
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.findOne(id, req.user.companyId);
  }

  // GET /mrp/runs/:id/gaps — apenas sugestões com necessidade > 0
  @Get('runs/:id/gaps')
  findGaps(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.findGaps(id, req.user.companyId);
  }
}
