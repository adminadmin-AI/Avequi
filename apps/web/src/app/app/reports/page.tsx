'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Loader2, Info, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';

// ─── Relatórios diretos (export síncrono, .xlsx) ─────────────────────────────
const DIRECT_REPORTS: { path: string; file: string; label: string; desc: string }[] = [
  { path: '/reports/export/products', file: 'produtos.xlsx', label: 'Produtos', desc: 'Catálogo completo com preços, custo médio e estoque disponível.' },
  { path: '/reports/export/customers', file: 'clientes.xlsx', label: 'Clientes', desc: 'Cadastro de clientes com documento, contato, cidade/UF.' },
  { path: '/reports/export/suppliers', file: 'fornecedores.xlsx', label: 'Fornecedores', desc: 'Cadastro de fornecedores com CNPJ, contato e lead time.' },
  { path: '/reports/export/sales', file: 'ordens-de-venda.xlsx', label: 'Ordens de Venda', desc: 'OVs com cliente, status, total e responsável.' },
  { path: '/reports/export/purchases', file: 'ordens-de-compra.xlsx', label: 'Ordens de Compra', desc: 'OCs com fornecedor, status e total.' },
  { path: '/reports/export/stock', file: 'posicao-de-estoque.xlsx', label: 'Posição de Estoque', desc: 'Saldos por armazém: disponível, reservado, em trânsito e valor.' },
  { path: '/reports/aging', file: 'inadimplencia.xlsx', label: 'Inadimplência (Aging de Recebíveis)', desc: 'Recebíveis vencidos por faixa de atraso.' },
  { path: '/reports/purchases-by-supplier', file: 'compras-por-fornecedor.xlsx', label: 'Compras por Fornecedor', desc: 'Consolidado de compras agrupado por fornecedor e produto.' },
];

// ─── Relatórios pesados (processados em fila) ────────────────────────────────
const ASYNC_REPORTS: { name: string; file: string; label: string; desc: string }[] = [
  { name: 'cost-history', file: 'custo-historico.xlsx', label: 'Histórico de Custo Médio', desc: 'Evolução do custo médio ponderado (CMP) por produto a cada entrada.' },
  { name: 'stock-abc', file: 'estoque-abc.xlsx', label: 'Curva ABC de Estoque', desc: 'Classificação A/B/C dos itens por valor de saída/demanda.' },
  { name: 'production-efficiency', file: 'eficiencia-producao.xlsx', label: 'Eficiência de Produção', desc: 'Planejado vs realizado e custos por ordem de produção concluída.' },
];

const STATUS_LABEL: Record<string, string> = {
  waiting: 'Na fila…',
  active: 'Processando…',
  delayed: 'Aguardando…',
  completed: 'Pronto',
  failed: 'Falhou',
};

async function downloadFile(path: string, filename: string) {
  const res = await apiClient.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DirectReportCard({ report }: { report: (typeof DIRECT_REPORTS)[number] }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  async function handle() {
    setLoading(true);
    try {
      await downloadFile(report.path, report.file);
      toast.success('Download iniciado');
    } catch {
      toast.error('Não foi possível gerar o relatório');
    } finally {
      setLoading(false);
    }
  }
  return (
    <Card>
      <CardContent className="flex h-full flex-col py-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:text-brand-400">
            <FileSpreadsheet size={18} />
          </div>
          <div>
            <p className="font-medium text-content">{report.label}</p>
            <p className="mt-0.5 text-xs text-content-muted">{report.desc}</p>
          </div>
        </div>
        <div className="mt-auto pt-2">
          <Button variant="secondary" onClick={handle} loading={loading} className="w-full">
            <Download size={15} /> Baixar Excel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AsyncReportCard({ report }: { report: (typeof ASYNC_REPORTS)[number] }) {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: async () => (await apiClient.post<{ jobId: string }>(`/reports/${report.name}`, {})).data,
    onSuccess: (data) => {
      setJobId(data.jobId);
      toast.success('Relatório enfileirado');
    },
    onError: () => toast.error('Não foi possível enfileirar (a fila pode estar indisponível)'),
  });

  const statusQ = useQuery({
    queryKey: ['report-status', jobId],
    enabled: !!jobId,
    queryFn: async () => (await apiClient.get<{ status: string; error?: string }>(`/reports/${jobId}/status`)).data,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'completed' || s === 'failed' ? false : 2500;
    },
  });

  const status = statusQ.data?.status;
  const ready = status === 'completed';
  const failed = status === 'failed';
  const processing = !!jobId && !ready && !failed;

  async function handleDownload() {
    try {
      await downloadFile(`/reports/${jobId}/download`, report.file);
      toast.success('Download iniciado');
    } catch {
      toast.error('Não foi possível baixar o relatório');
    }
  }

  return (
    <Card>
      <CardContent className="flex h-full flex-col py-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <FileSpreadsheet size={18} />
          </div>
          <div>
            <p className="font-medium text-content">{report.label}</p>
            <p className="mt-0.5 text-xs text-content-muted">{report.desc}</p>
          </div>
        </div>

        {status && (
          <p className={`mb-2 text-xs ${failed ? 'text-danger' : ready ? 'text-success' : 'text-content-muted'}`}>
            {failed && statusQ.data?.error ? `Falhou: ${statusQ.data.error}` : STATUS_LABEL[status] ?? status}
          </p>
        )}

        <div className="mt-auto flex gap-2 pt-2">
          {ready ? (
            <Button onClick={handleDownload} className="w-full">
              <Download size={15} /> Baixar Excel
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => generate.mutate()}
              loading={generate.isPending}
              disabled={processing}
              className="w-full"
            >
              {processing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {processing ? 'Processando…' : failed ? 'Tentar novamente' : 'Gerar relatório'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  return (
    <div>
      <PageHeader title="Relatórios" description="Exporte relatórios gerenciais e operacionais em Excel." />

      <div className="mb-5 flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-xs text-content-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          O backend gera os relatórios em <strong>Excel (.xlsx)</strong> para download — não há pré-visualização em
          tela nem exportação em CSV, e os filtros por relatório (período/depósito/status) ainda não existem na API
          (cada export traz o conjunto completo). Pendências registradas na <strong>#247</strong>. Os relatórios
          "pesados" são processados em fila: clique em <em>Gerar</em> e aguarde ficar pronto para baixar.
        </span>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-content-muted">Relatórios diretos</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DIRECT_REPORTS.map((r) => (
          <DirectReportCard key={r.path} report={r} />
        ))}
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-content-muted">Relatórios pesados (fila)</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ASYNC_REPORTS.map((r) => (
          <AsyncReportCard key={r.name} report={r} />
        ))}
      </div>
    </div>
  );
}
