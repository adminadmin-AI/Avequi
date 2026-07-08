import { Controller, Get, Request } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DashboardService } from './dashboard.service';

/**
 * #341 parte 2 (PR B): cada painel exige o dashboard.*.view correspondente do
 * catálogo (gate único RBAC v2). O @Roles legado do painel financeiro foi
 * substituído por dashboard.finance.view (mesmos perfis equivalentes + os
 * novos do v2 — matriz validada pelo Rafael na issue #620).
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // GET /dashboard/executive
  @Get('executive')
  @RequirePermission('dashboard.executive.view')
  getExecutive(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getExecutive(req.user.companyId);
  }

  // GET /dashboard/sales
  @Get('sales')
  @RequirePermission('dashboard.sales.view')
  getSales(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getSales(req.user.companyId);
  }

  // GET /dashboard/finance — dados financeiros sensíveis
  @Get('finance')
  @RequirePermission('dashboard.finance.view')
  getFinance(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getFinance(req.user.companyId);
  }

  // GET /dashboard/production
  @Get('production')
  @RequirePermission('dashboard.production.view')
  getProduction(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getProduction(req.user.companyId);
  }

  // GET /dashboard/stock
  @Get('stock')
  @RequirePermission('dashboard.stock.view')
  getStock(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getStock(req.user.companyId);
  }

  // GET /dashboard/purchases
  @Get('purchases')
  @RequirePermission('dashboard.purchases.view')
  getPurchases(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getPurchases(req.user.companyId);
  }
}
