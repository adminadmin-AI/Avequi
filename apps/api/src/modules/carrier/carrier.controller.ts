import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CarrierService } from './carrier.service';
import { CreateCarrierDto } from './dto/create-carrier.dto';
import { UpdateCarrierDto } from './dto/update-carrier.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('carriers')
@ApiBearerAuth()
@Controller('carriers')
export class CarrierController {
  constructor(private readonly carrierService: CarrierService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL')
  @ApiOperation({ summary: 'Criar transportadora' })
  create(@Body() dto: CreateCarrierDto, @CurrentUser() user: any) {
    return this.carrierService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Listar transportadoras' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  findAll(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.carrierService.findAll(user.companyId, { search, isActive });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar transportadora por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.carrierService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL')
  @ApiOperation({ summary: 'Atualizar transportadora' })
  update(@Param('id') id: string, @Body() dto: UpdateCarrierDto, @CurrentUser() user: any) {
    return this.carrierService.update(id, dto, user);
  }
}
