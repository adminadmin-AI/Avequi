import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TaxRuleService } from './tax-rule.service';
import { CreateTaxRuleDto } from './dto/create-tax-rule.dto';
import { UpdateTaxRuleDto } from './dto/update-tax-rule.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('tax-rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tax-rules')
export class TaxRuleController {
  constructor(private readonly taxRuleService: TaxRuleService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'FINANCIAL')
  @ApiOperation({ summary: 'Criar regra tributária' })
  create(@CurrentUser() user: any, @Body() dto: CreateTaxRuleDto) {
    return this.taxRuleService.create(user.companyId, dto);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'FINANCIAL')
  @ApiOperation({ summary: 'Listar regras tributárias da empresa' })
  findAll(@CurrentUser() user: any) {
    return this.taxRuleService.findAll(user.companyId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'FINANCIAL')
  @ApiOperation({ summary: 'Buscar regra tributária por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.taxRuleService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'FINANCIAL')
  @ApiOperation({ summary: 'Atualizar regra tributária' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateTaxRuleDto,
  ) {
    return this.taxRuleService.update(id, user.companyId, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Remover regra tributária' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.taxRuleService.remove(id, user.companyId);
  }
}
