import { Controller, Get, Request } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // GET /dashboard/executive
  @Get('executive')
  getExecutive(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getExecutive(req.user.companyId);
  }

  // GET /dashboard/sales
  @Get('sales')
  getSales(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getSales(req.user.companyId);
  }

  // GET /dashboard/finance — dados financeiros sensíveis
  @Get('finance')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL')
  getFinance(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getFinance(req.user.companyId);
  }

  // GET /dashboard/production
  @Get('production')
  getProduction(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getProduction(req.user.companyId);
  }

  // GET /dashboard/stock
  @Get('stock')
  getStock(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getStock(req.user.companyId);
  }

  // GET /dashboard/purchases
  @Get('purchases')
  getPurchases(@Request() req: { user: { companyId: string } }) {
    return this.dashboardService.getPurchases(req.user.companyId);
  }
}
