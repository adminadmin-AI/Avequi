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
import { SupplierService } from './supplier.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR B): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #620).
 */
@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @RequirePermission('suppliers.registry.create')
  @ApiOperation({ summary: 'Criar fornecedor' })
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: any) {
    return this.supplierService.create(dto, user);
  }

  @Get()
  @RequirePermission('suppliers.registry.view')
  @ApiOperation({ summary: 'Listar fornecedores' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  findAll(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.supplierService.findAll(user.companyId, { search, isActive });
  }

  @Get(':id')
  @RequirePermission('suppliers.registry.view')
  @ApiOperation({ summary: 'Buscar fornecedor por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.supplierService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @RequirePermission('suppliers.registry.update')
  @ApiOperation({ summary: 'Atualizar fornecedor' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: any,
  ) {
    return this.supplierService.update(id, dto, user);
  }
}
