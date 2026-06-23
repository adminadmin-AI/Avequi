import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StockService } from './stock.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('balances')
  @ApiOperation({ summary: 'Consultar saldos de estoque' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'productId', required: false })
  getBalances(
    @CurrentUser() user: any,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.stockService.getBalances(user.companyId, warehouseId, productId);
  }

  @Get('balances/:warehouseId/:productId')
  @ApiOperation({ summary: 'Consultar saldo de produto em depósito' })
  getBalance(
    @Param('warehouseId') warehouseId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.stockService.getBalance(warehouseId, productId, user.companyId);
  }

  @Post('move')
  @Roles('DIRECTOR', 'MANAGER', 'WAREHOUSE', 'PRODUCTION')
  @ApiOperation({ summary: 'Registrar movimentação de estoque' })
  move(@Body() dto: CreateMovementDto, @CurrentUser() user: any) {
    return this.stockService.move(dto, user?.id);
  }

  @Post('reverse/:movementId')
  @Roles('DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Estornar movimentação de estoque' })
  reverse(
    @Param('movementId') movementId: string,
    @Body() body: { reason: string },
    @CurrentUser() user: any,
  ) {
    return this.stockService.reverse(movementId, body.reason, user?.id, user?.companyId);
  }

  @Get('movements')
  @ApiOperation({ summary: 'Listar movimentações de estoque' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'productId', required: false })
  getMovements(
    @CurrentUser() user: any,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.stockService.getMovements(user.companyId, warehouseId, productId);
  }
}
