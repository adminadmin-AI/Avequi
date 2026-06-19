import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ReportService } from './report.service';
import { REPORT_QUEUE, ReportJobData } from './report.types';

@Processor(REPORT_QUEUE)
export class ReportProcessor {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(private readonly reportService: ReportService) {}

  @Process('cost-history')
  async handleCostHistory(job: Job<ReportJobData>): Promise<{ filePath: string }> {
    this.logger.log(`[job:${job.id}] Gerando custo-histórico para company ${job.data.companyId}`);
    await job.progress(10);
    const filePath = await this.reportService.generateCostHistory(job.data.companyId);
    await job.progress(100);
    this.logger.log(`[job:${job.id}] Concluído → ${filePath}`);
    return { filePath };
  }

  @Process('stock-abc')
  async handleStockAbc(job: Job<ReportJobData>): Promise<{ filePath: string }> {
    this.logger.log(`[job:${job.id}] Gerando estoque-ABC para company ${job.data.companyId}`);
    await job.progress(10);
    const filePath = await this.reportService.generateStockAbc(job.data.companyId);
    await job.progress(100);
    this.logger.log(`[job:${job.id}] Concluído → ${filePath}`);
    return { filePath };
  }

  @Process('production-efficiency')
  async handleProductionEfficiency(job: Job<ReportJobData>): Promise<{ filePath: string }> {
    this.logger.log(`[job:${job.id}] Gerando eficiência-produção para company ${job.data.companyId}`);
    await job.progress(10);
    const filePath = await this.reportService.generateProductionEfficiency(job.data.companyId);
    await job.progress(100);
    this.logger.log(`[job:${job.id}] Concluído → ${filePath}`);
    return { filePath };
  }
}
