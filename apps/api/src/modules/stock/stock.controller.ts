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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR C): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #621).
 * OPERADOR_PCP recebeu stock.movements.create (o enum PRODUCTION movimentava).
 */
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('balances')
  @RequirePermission('stock.balances.view')
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
  @RequirePermission('stock.balances.view')
  @ApiOperation({ summary: 'Consultar saldo de produto em depósito' })
  getBalance(
    @Param('warehouseId') warehouseId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.stockService.getBalance(warehouseId, productId, user.companyId);
  }

  @Post('move')
  @RequirePermission('stock.movements.create')
  @ApiOperation({ summary: 'Registrar movimentação de estoque' })
  move(@Body() dto: CreateMovementDto, @CurrentUser() user: any) {
    return this.stockService.move({ ...dto, companyId: user.companyId }, user.id);
  }

  @Post('reverse/:movementId')
  @RequirePermission('stock.movements.reverse')
  @ApiOperation({ summary: 'Estornar movimentação de estoque' })
  reverse(
    @Param('movementId') movementId: string,
    @Body() body: { reason: string },
    @CurrentUser() user: any,
  ) {
    return this.stockService.reverse(movementId, body.reason, user?.id, user?.companyId);
  }

  @Get('movements')
  @RequirePermission('stock.movements.view')
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
