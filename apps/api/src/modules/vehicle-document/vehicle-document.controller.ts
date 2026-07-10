import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VehicleDocumentService } from './vehicle-document.service';
import { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import { UpdateVehicleDocumentDto } from './dto/update-vehicle-document.dto';
import { RegisterDeliveryDto } from './dto/register-delivery.dto';

// #341 parte 2 (bloco G): gate unico RBAC v2 (#625) - documentos regulatorios
// do veiculo: view restrita; manage SEM Financeiro (o legado dava) - decisao
// Rafael; SOMENTE_LEITURA fora.

@ApiTags('vehicle-documents')
@ApiBearerAuth()
@Controller('vehicle-documents')
export class VehicleDocumentController {
  constructor(private readonly service: VehicleDocumentService) {}

  @Post()
  @RequirePermission('vehicle-tracking.documents.manage')
  @ApiOperation({ summary: 'Cadastrar documento regulatório (CAT/CCT/Projeto Técnico) do produto (#364)' })
  create(@Body() dto: CreateVehicleDocumentDto, @CurrentUser() user: any) {
    return this.service.createDocument(user.companyId, dto);
  }

  @Get()
  @RequirePermission('vehicle-tracking.documents.view')
  @ApiOperation({ summary: 'Listar documentos (filtro opcional por produto)' })
  @ApiQuery({ name: 'productId', required: false })
  list(@CurrentUser() user: any, @Query('productId') productId?: string) {
    return this.service.listDocuments(user.companyId, productId);
  }

  // Rotas estáticas ANTES da paramétrica :id
  @Get('pending-deliveries')
  @RequirePermission('vehicle-tracking.documents.view')
  @ApiOperation({ summary: 'Dashboard — vendas de veículo faturadas sem documentos entregues' })
  pending(@CurrentUser() user: any) {
    return this.service.salesMissingDocuments(user.companyId);
  }

  @Get('by-sale/:salesOrderId')
  @RequirePermission('vehicle-tracking.documents.view')
  @ApiOperation({ summary: 'Entregas de documentos de uma venda' })
  bySale(@Param('salesOrderId') salesOrderId: string, @CurrentUser() user: any) {
    return this.service.listDeliveriesBySale(user.companyId, salesOrderId);
  }

  @Get(':id')
  @RequirePermission('vehicle-tracking.documents.view')
  @ApiOperation({ summary: 'Documento + histórico de entregas' })
  get(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getDocument(user.companyId, id);
  }

  @Patch(':id')
  @RequirePermission('vehicle-tracking.documents.manage')
  @ApiOperation({ summary: 'Atualizar documento (número, status, validade, arquivo)' })
  update(@Param('id') id: string, @Body() dto: UpdateVehicleDocumentDto, @CurrentUser() user: any) {
    return this.service.updateDocument(user.companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('vehicle-tracking.documents.manage')
  @ApiOperation({ summary: 'Remover documento' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.removeDocument(user.companyId, id);
  }

  @Post(':id/deliveries')
  @RequirePermission('vehicle-tracking.documents.manage')
  @ApiOperation({ summary: 'Registrar entrega do documento (por venda/chassi, revenda ou cliente final)' })
  registerDelivery(@Param('id') id: string, @Body() dto: RegisterDeliveryDto, @CurrentUser() user: any) {
    return this.service.registerDelivery(user.companyId, id, dto);
  }
}
