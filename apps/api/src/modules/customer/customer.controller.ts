import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CreateCustomerDto, CustomerAddressDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR B): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #620).
 *
 * Endereços de entrega usam a família própria customers.addresses.* (decisão
 * Rafael): a loja/balcão adiciona endereço na venda (create), mas editar é do
 * comercial e remover é de gerência — regra distinta de editar o cliente.
 */
@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  // LOJA_OPERACIONAL cria cliente na venda de balcão (decisão Rafael 04/07/2026)
  @RequirePermission('customers.registry.create')
  @ApiOperation({ summary: 'Criar cliente' })
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: any) {
    return this.customerService.create(dto, user);
  }

  @Get()
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Listar clientes' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  findAll(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.customerService.findAll(user.companyId, { search, type, isActive });
  }

  @Get(':id/credit')
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Situação de crédito: limite, em aberto e disponível (#475)' })
  creditStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.customerService.creditStatus(id, user.companyId);
  }

  @Get(':id')
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Buscar cliente por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.customerService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @RequirePermission('customers.registry.update')
  @ApiOperation({ summary: 'Atualizar cliente' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: any,
  ) {
    return this.customerService.update(id, dto, user);
  }

  // ─── Endereços de entrega (#474) ────────────────────────────────────────────

  @Post(':id/addresses')
  @RequirePermission('customers.addresses.create')
  @ApiOperation({ summary: 'Adicionar endereço de entrega ao cliente' })
  addAddress(@Param('id') id: string, @Body() dto: CustomerAddressDto, @CurrentUser() user: any) {
    return this.customerService.addAddress(id, dto, user.companyId);
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermission('customers.addresses.update')
  @ApiOperation({ summary: 'Atualizar endereço de entrega' })
  updateAddress(
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body() dto: Partial<CustomerAddressDto>,
    @CurrentUser() user: any,
  ) {
    return this.customerService.updateAddress(id, addressId, dto, user.companyId);
  }

  @Delete(':id/addresses/:addressId')
  @RequirePermission('customers.addresses.delete')
  @ApiOperation({ summary: 'Remover endereço de entrega' })
  removeAddress(@Param('id') id: string, @Param('addressId') addressId: string, @CurrentUser() user: any) {
    return this.customerService.removeAddress(id, addressId, user.companyId);
  }
}
