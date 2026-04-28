import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FiscalService } from './fiscal.service';

@ApiTags('Fiscal')
@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscalService: FiscalService) {}

  /** S08.04 — Webhook da Focus NFe (sem autenticação JWT — autenticado por secret no header) */
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de retorno assíncrono da Focus NFe' })
  async webhook(@Body() body: Record<string, unknown>) {
    await this.fiscalService.handleWebhook(body);
    return { ok: true };
  }

  /** S08.05 — Reprocessar documento rejeitado ou em erro */
  @Post(':id/retry')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reprocessar documento fiscal rejeitado' })
  async retry(@Param('id') id: string, @CurrentUser() user: any) {
    await this.fiscalService.retry(id, user?.companyId);
    return { ok: true };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar documentos fiscais da empresa' })
  findAll(@Query('companyId') companyId: string) {
    return this.fiscalService.findAll(companyId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalhe do documento fiscal' })
  findOne(@Param('id') id: string, @Query('companyId') companyId: string) {
    return this.fiscalService.findOne(id, companyId);
  }
}
