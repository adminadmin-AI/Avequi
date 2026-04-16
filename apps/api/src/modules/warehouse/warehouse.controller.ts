import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { WarehouseService } from './warehouse.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('warehouses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @ApiQuery({ name: 'companyId', required: true })
  findAll(@Query('companyId') companyId: string) {
    return this.warehouseService.findAll(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar depósito por ID' })
  @ApiQuery({ name: 'companyId', required: true })
  findOne(@Param('id') id: string, @Query('companyId') companyId: string) {
    return this.warehouseService.findOne(id, companyId);
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
