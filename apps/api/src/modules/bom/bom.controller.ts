import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BomService } from './bom.service';
import { CreateBomDto } from './dto/create-bom.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR D): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #622).
 * Ativar versão de BOM é aprovação (DIRETOR mantém); criar é engenharia/gestão.
 */
@ApiTags('bom')
@ApiBearerAuth()
@Controller('bom')
export class BomController {
  constructor(private readonly bomService: BomService) {}

  @Post()
  @RequirePermission('production.bom.create')
  @ApiOperation({ summary: 'Criar nova versão de BOM' })
  create(@Body() dto: CreateBomDto, @CurrentUser() user: any) {
    return this.bomService.create(dto, user);
  }

  @Get('product/:productId')
  @RequirePermission('production.bom.view')
  @ApiOperation({ summary: 'Listar todas as versões de BOM por produto' })
  findByProduct(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.bomService.findByProduct(productId, user.companyId);
  }

  @Get('product/:productId/active')
  @RequirePermission('production.bom.view')
  @ApiOperation({ summary: 'Obter versão ativa de BOM para produto' })
  findActive(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.bomService.findActive(productId, user.companyId);
  }

  @Get(':id')
  @RequirePermission('production.bom.view')
  @ApiOperation({ summary: 'Obter versão de BOM por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bomService.findOne(id, user.companyId);
  }

  @Patch(':id/activate')
  @RequirePermission('production.bom.activate')
  @ApiOperation({ summary: 'Ativar versão de BOM' })
  activate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bomService.activate(id, user.companyId, user);
  }
}
