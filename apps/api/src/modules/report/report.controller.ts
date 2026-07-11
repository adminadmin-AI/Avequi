import {
  Controller,
  Get,
  Post,
  Param,
  Request,
  Header,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ReportService } from './report.service';
import { ReportJobName } from './report.types';

/**
 * Relatórios e exportações — issue #341 parte 2.
 *
 * Antes: SEM gate (qualquer autenticado). Agora: RBAC v2 reutilizando os codes
 * já existentes do módulo `analytics` (o catálogo já mapeava estes endpoints):
 *   - analytics.export.execute → GET /reports/export/* (Excel direto)
 *   - analytics.reports.view   → aging, purchases-by-supplier, :jobId/status,
 *                                :jobId/download (leitura/status/download)
 *   - analytics.reports.create → POST de jobs assíncronos
 * companyId SEMPRE do JWT. Os jobs (status/download) validam que o job pertence
 * à empresa do usuário (anti-IDOR — 404 se for de outra empresa).
 */
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  // ─── Exports síncronos ────────────────────────────────────────────────────

  // GET /reports/export/products
  @Get('export/products')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('analytics.export.execute')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportProducts(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportProducts(req.user.companyId);
  }

  // GET /reports/export/customers
  @Get('export/customers')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('analytics.export.execute')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportCustomers(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportCustomers(req.user.companyId);
  }

  // GET /reports/export/suppliers
  @Get('export/suppliers')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('analytics.export.execute')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportSuppliers(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportSuppliers(req.user.companyId);
  }

  // GET /reports/export/sales
  @Get('export/sales')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('analytics.export.execute')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportSales(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportSales(req.user.companyId);
  }

  // GET /reports/export/purchases
  @Get('export/purchases')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('analytics.export.execute')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportPurchases(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportPurchases(req.user.companyId);
  }

  // GET /reports/export/stock
  @Get('export/stock')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('analytics.export.execute')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportStock(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportStock(req.user.companyId);
  }

  // GET /reports/aging
  @Get('aging')
  @RequirePermission('analytics.reports.view')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportAging(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportAging(req.user.companyId);
  }

  // GET /reports/purchases-by-supplier
  @Get('purchases-by-supplier')
  @RequirePermission('analytics.reports.view')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  exportPurchasesBySupplier(@Request() req: { user: { companyId: string } }): Promise<StreamableFile> {
    return this.reportService.exportPurchasesBySupplier(req.user.companyId);
  }

  // ─── Relatórios assíncronos ───────────────────────────────────────────────

  // POST /reports/cost-history
  @Post('cost-history')
  @RequirePermission('analytics.reports.create')
  enqueueCostHistory(@Request() req: { user: { companyId: string } }) {
    return this.reportService.enqueueReport(
      req.user.companyId,
      'cost-history' as ReportJobName,
    );
  }

  // POST /reports/stock-abc
  @Post('stock-abc')
  @RequirePermission('analytics.reports.create')
  enqueueStockAbc(@Request() req: { user: { companyId: string } }) {
    return this.reportService.enqueueReport(
      req.user.companyId,
      'stock-abc' as ReportJobName,
    );
  }

  // POST /reports/production-efficiency
  @Post('production-efficiency')
  @RequirePermission('analytics.reports.create')
  enqueueProductionEfficiency(@Request() req: { user: { companyId: string } }) {
    return this.reportService.enqueueReport(
      req.user.companyId,
      'production-efficiency' as ReportJobName,
    );
  }

  // GET /reports/:jobId/status
  @Get(':jobId/status')
  @RequirePermission('analytics.reports.view')
  getStatus(
    @Request() req: { user: { companyId: string } },
    @Param('jobId') jobId: string,
  ) {
    // anti-IDOR: o service valida que o job pertence à empresa do JWT.
    return this.reportService.getJobStatus(jobId, req.user.companyId);
  }

  // GET /reports/:jobId/download
  @Get(':jobId/download')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('analytics.reports.view')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  downloadReport(
    @Request() req: { user: { companyId: string } },
    @Param('jobId') jobId: string,
  ): Promise<StreamableFile> {
    // anti-IDOR: o service valida que o job pertence à empresa do JWT.
    return this.reportService.downloadReport(jobId, req.user.companyId);
  }
}
