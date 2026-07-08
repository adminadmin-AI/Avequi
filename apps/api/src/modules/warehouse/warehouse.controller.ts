import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WarehouseService } from './warehouse.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR B): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #620).
 */
@ApiTags('warehouses')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Post()
  @RequirePermission('stock.warehouses.create')
  @ApiOperation({ summary: 'Criar depósito' })
  create(@Body() dto: CreateWarehouseDto, @CurrentUser() user: any) {
    return this.warehouseService.create(dto, user);
  }

  @Get()
  @RequirePermission('stock.warehouses.view')
  @ApiOperation({ summary: 'Listar depósitos' })
  findAll(@CurrentUser() user: any) {
    return this.warehouseService.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermission('stock.warehouses.view')
  @ApiOperation({ summary: 'Buscar depósito por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.warehouseService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @RequirePermission('stock.warehouses.update')
  @ApiOperation({ summary: 'Atualizar depósito' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() user: any,
  ) {
    return this.warehouseService.update(id, dto, user);
  }
}
