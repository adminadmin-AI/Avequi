import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RfqService } from './rfq.service';

@ApiTags('rfq')
@ApiBearerAuth()
@Controller('rfq')
export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Criar RFQ (#192)' })
  create(@Body() dto: any, @CurrentUser() user: any) {
    return this.rfqService.create(dto, user?.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar RFQs' })
  findAll(@CurrentUser() user: any) {
    return this.rfqService.findAll(user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar RFQ por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.rfqService.findOne(id, user.companyId);
  }

  @Post(':id/quotes')
  @ApiOperation({ summary: 'Enviar cotação de fornecedor' })
  submitQuote(@Param('id') rfqId: string, @Body() dto: any) {
    return this.rfqService.submitQuote(rfqId, dto);
  }

  @Get(':id/compare')
  @ApiOperation({ summary: 'Comparar cotações lado-a-lado' })
  compare(@Param('id') id: string, @CurrentUser() user: any) {
    return this.rfqService.compareQuotes(id, user.companyId);
  }

  @Post('quotes/:quoteId/award')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Adjudicar cotação → gerar PO (#192)' })
  award(@Param('quoteId') quoteId: string, @CurrentUser() user: any) {
    return this.rfqService.awardQuote(quoteId, user.companyId, user?.id);
  }
}
