import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TaxRuleService } from './tax-rule.service';
import { CreateTaxRuleDto } from './dto/create-tax-rule.dto';
import { UpdateTaxRuleDto } from './dto/update-tax-rule.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('tax-rules')
@ApiBearerAuth()
@Controller('tax-rules')
export class TaxRuleController {
  constructor(private readonly taxRuleService: TaxRuleService) {}

  @Post()
  @RequirePermission('fiscal.tax-rules.create')
  @ApiOperation({ summary: 'Criar regra tributária' })
  create(@CurrentUser() user: any, @Body() dto: CreateTaxRuleDto) {
    return this.taxRuleService.create(user.companyId, dto);
  }

  @Get()
  @RequirePermission('fiscal.tax-rules.view')
  @ApiOperation({ summary: 'Listar regras tributárias da empresa' })
  findAll(@CurrentUser() user: any) {
    return this.taxRuleService.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermission('fiscal.tax-rules.view')
  @ApiOperation({ summary: 'Buscar regra tributária por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.taxRuleService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @RequirePermission('fiscal.tax-rules.update')
  @ApiOperation({ summary: 'Atualizar regra tributária' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateTaxRuleDto,
  ) {
    return this.taxRuleService.update(id, user.companyId, dto);
  }

  @Delete(':id')
  @RequirePermission('fiscal.tax-rules.delete')
  @ApiOperation({ summary: 'Remover regra tributária' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.taxRuleService.remove(id, user.companyId);
  }
}
