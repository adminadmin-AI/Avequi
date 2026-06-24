import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MrpService } from './mrp.service';

@ApiTags('MRP')
@UseGuards(JwtAuthGuard)
@Controller('mrp')
export class MrpController {
  constructor(private readonly mrpService: MrpService) {}

  @Post('run')
  @ApiOperation({ summary: 'Disparar nova rodada MRP' })
  run(@Request() req: { user: { companyId: string; sub: string } }) {
    return this.mrpService.run(req.user.companyId, req.user.sub);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Listar rodadas MRP' })
  findAll(@Request() req: { user: { companyId: string } }) {
    return this.mrpService.findAll(req.user.companyId);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Detalhe da rodada com sugestões' })
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.findOne(id, req.user.companyId);
  }

  @Get('runs/:id/gaps')
  @ApiOperation({ summary: 'Sugestões com necessidade > 0' })
  findGaps(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.findGaps(id, req.user.companyId);
  }

  @Post('suggestions/:id/convert')
  @ApiOperation({ summary: 'Converter sugestão MRP em PO (BUY) ou OP (MAKE)' })
  convert(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.convertSuggestion(id, req.user.companyId);
  }

  @Post('suggestions/convert-batch')
  @ApiOperation({ summary: 'Converter múltiplas sugestões MRP em PO/OP' })
  convertBatch(
    @Body() body: { suggestionIds: string[] },
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.convertBatch(body.suggestionIds, req.user.companyId);
  }
}
