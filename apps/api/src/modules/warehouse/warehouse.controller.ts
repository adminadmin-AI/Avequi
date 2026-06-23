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
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('warehouses')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Criar depósito' })
  create(@Body() dto: CreateWarehouseDto, @CurrentUser() user: any) {
    return this.warehouseService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Listar depósitos' })
  findAll(@CurrentUser() user: any) {
    return this.warehouseService.findAll(user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar depósito por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.warehouseService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Atualizar depósito' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() user: any,
  ) {
    return this.warehouseService.update(id, dto, user);
  }
}
