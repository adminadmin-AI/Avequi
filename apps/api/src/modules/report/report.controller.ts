import {
  Controller,
  Get,
  Post,
  Param,
  Request,
  UseGuards,
  Header,
  StreamableFile,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportService } from './report.service';
import { ReportJobName } from './report.types';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  // ─── Exports síncronos ────────────────────────────────────────────────────

  // GET /reports/export/products
  @Get('export/products')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportProducts(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportProducts(req.user.companyId);
  }

  // GET /reports/export/customers
  @Get('export/customers')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportCustomers(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportCustomers(req.user.companyId);
  }

  // GET /reports/export/suppliers
  @Get('export/suppliers')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportSuppliers(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportSuppliers(req.user.companyId);
  }

  // GET /reports/export/sales
  @Get('export/sales')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportSales(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportSales(req.user.companyId);
  }

  // GET /reports/export/purchases
  @Get('export/purchases')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportPurchases(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportPurchases(req.user.companyId);
  }

  // GET /reports/export/stock
  @Get('export/stock')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportStock(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportStock(req.user.companyId);
  }

  // GET /reports/aging
  @Get('aging')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportAging(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportAging(req.user.companyId);
  }

  // GET /reports/purchases-by-supplier
  @Get('purchases-by-supplier')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportPurchasesBySupplier(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportPurchasesBySupplier(req.user.companyId);
  }

  // ─── Relatórios assíncronos ───────────────────────────────────────────────

  // POST /reports/cost-history
  @Post('cost-history')
  enqueueCostHistory(@Request() req: { user: { companyId: string } }) {
    return this.reportService.enqueueReport(
      req.user.companyId,
      'cost-history' as ReportJobName,
    );
  }

  // POST /reports/stock-abc
  @Post('stock-abc')
  enqueueStockAbc(@Request() req: { user: { companyId: string } }) {
    return this.reportService.enqueueReport(
      req.user.companyId,
      'stock-abc' as ReportJobName,
    );
  }

  // POST /reports/production-efficiency
  @Post('production-efficiency')
  enqueueProductionEfficiency(@Request() req: { user: { companyId: string } }) {
    return this.reportService.enqueueReport(
      req.user.companyId,
      'production-efficiency' as ReportJobName,
    );
  }

  // GET /reports/:jobId/status
  @Get(':jobId/status')
  getStatus(@Param('jobId') jobId: string) {
    return this.reportService.getJobStatus(jobId);
  }

  // GET /reports/:jobId/download
  @Get(':jobId/download')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  downloadReport(@Param('jobId') jobId: string): Promise<StreamableFile> {
    return this.reportService.downloadReport(jobId);
  }
}
