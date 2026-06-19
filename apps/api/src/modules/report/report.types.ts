export const REPORT_QUEUE = 'reports';

export type ReportJobName =
  | 'cost-history'
  | 'stock-abc'
  | 'production-efficiency';

export interface ReportJobData {
  companyId: string;
  jobName: ReportJobName;
  requestedAt: string;
}

export interface ReportJobResult {
  status: 'done' | 'failed';
  filePath?: string;
  error?: string;
}
