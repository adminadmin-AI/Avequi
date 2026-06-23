import { Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { DashboardService } from '../dashboard.service';
import { WidgetDataService } from '../widget-data.service';

export interface ExportColumn {
  key: string;
  label: string;
}

export interface ExportMetadata {
  title?: string;
  generatedAt?: string;
  companyId?: string;
  [key: string]: unknown;
}

@Injectable()
export class ExportService {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly widgetDataService: WidgetDataService,
  ) {}

  // ─── CSV ─────────────────────────────────────────────────────────────────────

  exportCsv(data: Record<string, unknown>[], columns: ExportColumn[]): string {
    const header = columns.map((c) => this.escapeCsvField(c.label)).join(',');
    const rows = data.map((row) =>
      columns.map((c) => this.escapeCsvField(String(row[c.key] ?? ''))).join(','),
    );
    return [header, ...rows].join('\n');
  }

  // ─── XLSX (simplified — tab-separated) ───────────────────────────────────────

  exportXlsx(data: Record<string, unknown>[], columns: ExportColumn[]): string {
    // Real XLSX would need a library (e.g., exceljs). This produces TSV as placeholder.
    const header = columns.map((c) => c.label).join('\t');
    const rows = data.map((row) =>
      columns.map((c) => String(row[c.key] ?? '')).join('\t'),
    );
    return [header, ...rows].join('\n');
  }

  // ─── HTML Report ─────────────────────────────────────────────────────────────

  exportHtmlReport(
    title: string,
    data: Record<string, unknown>[],
    columns: ExportColumn[],
    metadata?: ExportMetadata,
  ): string {
    const generatedAt = metadata?.generatedAt ?? new Date().toISOString();

    const headerCells = columns
      .map((c) => `<th style="background:#1a1a2e;color:#fff;padding:8px 12px;text-align:left;">${this.escapeHtml(c.label)}</th>`)
      .join('');

    const bodyRows = data
      .map((row, i) => {
        const bg = i % 2 === 0 ? '#ffffff' : '#f4f4f8';
        const cells = columns
          .map((c) => `<td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${this.escapeHtml(String(row[c.key] ?? ''))}</td>`)
          .join('');
        return `<tr style="background:${bg};">${cells}</tr>`;
      })
      .join('');

    const metaRows = metadata
      ? Object.entries(metadata)
          .filter(([k]) => k !== 'title')
          .map(([k, v]) => `<p style="margin:2px 0;font-size:12px;color:#666;"><strong>${this.escapeHtml(k)}:</strong> ${this.escapeHtml(String(v ?? ''))}</p>`)
          .join('')
      : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #222; }
    h1 { color: #1a1a2e; margin-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th { white-space: nowrap; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(title)}</h1>
  <p style="color:#888;font-size:12px;">Gerado em: ${this.escapeHtml(generatedAt)}</p>
  ${metaRows}
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <p style="margin-top:24px;font-size:11px;color:#aaa;">Avequi ERP — GDR Reboques</p>
</body>
</html>`;
  }

  // ─── Dashboard Export ─────────────────────────────────────────────────────────

  async exportDashboardData(
    companyId: string,
    dashboardId: string,
    format: 'CSV' | 'XLSX' | 'HTML',
    userId: string,
  ): Promise<{ content: string; mimeType: string; filename: string }> {
    const dashboard = await this.dashboardService.findOne(companyId, dashboardId, userId);
    if (!dashboard) {
      throw new BusinessException('Dashboard not found', HttpStatus.NOT_FOUND);
    }

    const resolvedData = await this.widgetDataService.resolveDashboard(companyId, dashboardId, userId);

    // Flatten widget data into rows
    const rows: Record<string, unknown>[] = [];
    for (const widget of resolvedData) {
      const data = (widget as { data?: unknown }).data;
      if (Array.isArray(data)) {
        for (const item of data as Record<string, unknown>[]) {
          rows.push({ widget: (widget as { title?: string }).title ?? 'Widget', ...item });
        }
      }
    }

    const columns: ExportColumn[] =
      rows.length > 0
        ? Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
        : [{ key: 'widget', label: 'Widget' }];

    const title = (dashboard as { name?: string }).name ?? 'Dashboard';
    const metadata: ExportMetadata = {
      title,
      generatedAt: new Date().toISOString(),
      companyId,
      dashboardId,
    };

    switch (format) {
      case 'CSV':
        return {
          content: this.exportCsv(rows, columns),
          mimeType: 'text/csv',
          filename: `${this.slugify(title)}.csv`,
        };
      case 'XLSX':
        return {
          content: this.exportXlsx(rows, columns),
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `${this.slugify(title)}.xlsx`,
        };
      case 'HTML':
        return {
          content: this.exportHtmlReport(title, rows, columns, metadata),
          mimeType: 'text/html',
          filename: `${this.slugify(title)}.html`,
        };
      default:
        throw new BusinessException(`Unsupported format: ${format}`, HttpStatus.BAD_REQUEST);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
