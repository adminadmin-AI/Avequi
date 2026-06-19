import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard)
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

  // GET /dashboard/finance
  @Get('finance')
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
