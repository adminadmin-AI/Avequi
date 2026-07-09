import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DeliveryService } from './delivery.service';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

const WRITE_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL', 'WAREHOUSE', 'STORE'] as const;

@ApiTags('deliveries')
@ApiBearerAuth()
@Controller('deliveries')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  @Get()
  @ApiOperation({ summary: 'Listar entregas (filtro opcional por status) (#365)' })
  @ApiQuery({ name: 'status', required: false })
  list(@CurrentUser() user: any, @Query('status') status?: string) {
    return this.service.list(user.companyId, status);
  }

  @Patch(':id/status')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Atualizar status/dados da entrega (transporte, recebedor, agenda)' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateDeliveryStatusDto, @CurrentUser() user: any) {
    return this.service.updateStatus(user.companyId, id, dto);
  }
}
