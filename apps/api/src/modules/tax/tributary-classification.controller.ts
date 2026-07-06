import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TributaryClassificationService } from './tributary-classification.service';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('tributary-classifications')
@ApiBearerAuth()
@Controller('tributary-classifications')
export class TributaryClassificationController {
  constructor(private readonly service: TributaryClassificationService) {}

  @Get()
  @ApiOperation({ summary: 'Listar classificações tributárias IBS/CBS vigentes (cClassTrib)' })
  findAll(
    @Query('cst') cst?: string,
    @Query('nfeOnly') nfeOnly?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({ cst, nfeOnly: nfeOnly === 'true', search });
  }

  @Get(':code')
  @ApiOperation({ summary: 'Buscar classificação tributária por código cClassTrib' })
  findByCode(@Param('code') code: string) {
    return this.service.findByCode(code);
  }

  @Post('sync')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Sincronizar tabela com o arquivo oficial (prisma/data/cclasstrib.ts)' })
  sync() {
    return this.service.syncFromOfficialTable();
  }
}
