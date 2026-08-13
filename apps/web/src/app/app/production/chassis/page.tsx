'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ScanBarcode } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatGroup } from '@/components/ui/stat-group';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime, formatNumber } from '@/lib/format';

const RESOURCE = '/chassi';

/**
 * Instalador autocontido da ferramenta OpenClaw (asset público de uma tag
 * `openclaw-*` — fora do trem de releases `vX.Y.Z` do ERP). Leva o
 * Python embutido: o PC da fábrica não precisa de Python nem de internet
 * durante a instalação. Nova versão da ferramenta = nova tag `openclaw-*`
 * e atualizar estas duas constantes.
 *
 * O nome do arquivo é o do asset no GitHub (pedido do Rafael: nome em
 * português, sem o codinome OpenClaw) — o atributo `download` do <a> não
 * renomeia download cross-origin, então o renomeio é no próprio asset.
 */
const INSTALADOR_URL =
  'https://github.com/adminadmin-AI/Avequi/releases/download/openclaw-v1.1.3/Marcadora_de_Chassi_v1.1.3.exe';
const INSTALADOR_VERSAO = '1.1.3';

/** Gravação vinda de GET /chassi/gravacoes (tabelas gdr_chassi_* do OpenClaw). */
interface ChassiGravacao {
  id: number;
  vin: string;
  tipo: 'padrao' | 'especial';
  observacao: string | null;
  numero: number;
  ano: number;
  operador: string;
  status: 'em_andamento' | 'concluida' | 'cancelada' | 'nao_concluida';
  criadoEm: string;
  concluidoEm: string | null;
  quadro: { codigo: string; nome: string } | null;
  serie: { codigo: string; nome: string };
  /** Marcações já feitas no chassi (plaqueta / esquerdo / direito). */
  etapasGravadas?: string[];
}

interface ChassiEvento {
  id: number;
  evento: string;
  etapa: string | null;
  operador: string | null;
  detalhe: Record<string, unknown> | null;
  criadoEm: string;
}

interface ChassiDetalhe extends ChassiGravacao {
  serie: { codigo: string; nome: string; prefixo: string };
  eventos: ChassiEvento[];
}

interface ChassiSerie {
  id: number;
  codigo: string;
  nome: string;
  prefixo: string;
  eixos: string;
  faixaMin: number;
  faixaMax: number;
  usados: number;
  reservados: number;
  restantes: number;
  alerta: boolean;
}

const STATUS_LABEL: Record<ChassiGravacao['status'], string> = {
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  // A ferramenta encerra assim a gravação que ficou pendurada quando o
  // operador começa a próxima (queda de energia, erro, janela fechada no
  // meio). Antes ficava "Em andamento" para sempre, e a tela dava a entender
  // que a carretinha ainda estava sendo gravada.
  nao_concluida: 'Não concluída',
  cancelada: 'Cancelada',
};
const STATUS_VARIANT: Record<ChassiGravacao['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  concluida: 'success',
  em_andamento: 'warning',
  nao_concluida: 'danger',
  cancelada: 'neutral',
};
const EVENTO_LABEL: Record<string, string> = {
  iniciada: 'Gravação iniciada',
  etapa_gravada: 'Etapa gravada',
  etapa_refeita: 'Etapa refeita',
  interrompida: 'Interrompida',
  nao_concluida: 'Não concluída',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};
const ETAPA_LABEL: Record<string, string> = {
  plaqueta: 'Plaqueta',
  esquerdo: 'Lado esquerdo',
  direito: 'Lado direito',
};

/**
 * As três marcações de uma carretinha, na ordem em que o operador executa.
 * Espelha `ETAPAS_ORDEM` da ferramenta.
 */
const ETAPAS_ORDEM = ['plaqueta', 'esquerdo', 'direito'] as const;

/**
 * Quais etapas esta gravação concluiu, lido da própria trilha de eventos.
 * Responde "parou onde?" sem ninguém precisar ler a trilha inteira — o caso
 * que motivou isto foi uma gravação interrompida aparecendo só como
 * "Não concluída", sem dizer se o chassi já tinha número em algum lado.
 */
function etapasConcluidas(eventos: ChassiEvento[]): Set<string> {
  return new Set(
    eventos.filter((e) => e.evento === 'etapa_gravada' && e.etapa).map((e) => e.etapa as string),
  );
}

function modeloDe(g: ChassiGravacao): string {
  if (g.tipo === 'especial') return `⭐ Especial · ${g.observacao ?? '—'}`;
  return g.quadro ? g.quadro.nome : '—';
}

export default function ChassisPage() {
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [status, setStatus] = useState('');
  const [ano, setAno] = useState('');
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [instalarAberto, setInstalarAberto] = useState(false);

  const gravacoesQ = useQuery({
    queryKey: [`${RESOURCE}/gravacoes`],
    queryFn: async () => (await apiClient.get<ChassiGravacao[]>(`${RESOURCE}/gravacoes`)).data,
  });
  const seriesQ = useQuery({
    queryKey: [`${RESOURCE}/series`],
    queryFn: async () => (await apiClient.get<ChassiSerie[]>(`${RESOURCE}/series`)).data,
  });
  const detalheQ = useQuery({
    queryKey: [`${RESOURCE}/gravacoes`, detalheId],
    enabled: detalheId != null,
    queryFn: async () =>
      (await apiClient.get<ChassiDetalhe>(`${RESOURCE}/gravacoes/${detalheId}`)).data,
  });

  const gravacoes = useMemo(() => gravacoesQ.data ?? [], [gravacoesQ.data]);
  const series = seriesQ.data ?? [];

  const filtradas = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return gravacoes.filter((g) => {
      if (ano && String(g.ano) !== ano) return false;
      if (tipo && g.tipo !== tipo) return false;
      if (status && g.status !== status) return false;
      if (q && !g.vin.includes(q) && !g.operador.toUpperCase().includes(q) && !modeloDe(g).toUpperCase().includes(q)) return false;
      return true;
    });
  }, [gravacoes, busca, tipo, status, ano]);

  // Anos presentes nas gravações, do mais novo para o mais antigo. Sai dos
  // dados e não de uma lista fixa: quando 2027 chegar, aparece sozinho.
  const anosDisponiveis = useMemo(
    () => [...new Set(gravacoes.map((g) => g.ano))].sort((a, b) => b - a),
    [gravacoes],
  );

  const hoje = new Date().toDateString();
  const resumo = {
    total: gravacoes.length,
    concluidas: gravacoes.filter((g) => g.status === 'concluida').length,
    especiais: gravacoes.filter((g) => g.tipo === 'especial').length,
    hoje: gravacoes.filter((g) => new Date(g.criadoEm).toDateString() === hoje).length,
  };

  const columns: Column<ChassiGravacao>[] = [
    { key: 'vin', header: 'VIN', sortable: true, accessor: (g) => g.vin, cell: (g) => <span className="font-mono text-xs font-medium">{g.vin}</span> },
    { key: 'modelo', header: 'Modelo', cell: (g) => modeloDe(g) },
    { key: 'serie', header: 'Série', cell: (g) => g.serie.nome },
    {
      // Ano-modelo do chassi: sai da 10ª posição do VIN (T = 2026), não do
      // ano em que a peça foi marcada — uma carretinha numerada em 2026 pode
      // ser gravada em janeiro de 2027 e continua sendo 2026.
      key: 'ano',
      header: 'Ano',
      align: 'center',
      sortable: true,
      accessor: (g) => g.ano,
      cell: (g) => <span className="font-mono text-xs">{g.ano}</span>,
    },
    { key: 'operador', header: 'Operador', sortable: true, accessor: (g) => g.operador, cell: (g) => g.operador },
    { key: 'inicio', header: 'Início', sortable: true, accessor: (g) => g.criadoEm, cell: (g) => formatDateTime(g.criadoEm) },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (g) => STATUS_LABEL[g.status],
      cell: (g) => {
        const feitas = g.etapasGravadas?.length ?? 0;
        // "Parou onde?" só interessa quando a gravação não chegou ao fim.
        const parcial = g.status !== 'concluida' && feitas < ETAPAS_ORDEM.length;
        return (
          <div className="flex flex-col items-center gap-0.5">
            <Badge variant={STATUS_VARIANT[g.status]}>{STATUS_LABEL[g.status]}</Badge>
            {parcial && (
              <span className="text-[11px] text-content-muted">
                {feitas} de {ETAPAS_ORDEM.length} marcações
              </span>
            )}
          </div>
        );
      },
    },
  ];

  const detalhe = detalheQ.data;

  return (
    <div>
      <PageHeader
        title="Chassis gravados"
        description="Gravações de número de chassi feitas pela marcadora (ferramenta OpenClaw no chão de fábrica)."
        actions={
          <Button variant="outline" onClick={() => setInstalarAberto(true)}>
            <Download size={16} />
            Instalar ferramenta
          </Button>
        }
      />

      <StatGroup
        className="mb-4"
        stats={[
          { label: 'Gravações', value: formatNumber(resumo.total) },
          { label: 'Hoje', value: formatNumber(resumo.hoje) },
          { label: 'Concluídas', value: formatNumber(resumo.concluidas) },
          { label: 'Especiais', value: formatNumber(resumo.especiais) },
        ]}
      />

      {/* Painel das séries: quanto ainda resta em cada faixa de numeração */}
      <StatGroup
        className="mb-6"
        stats={series.map((s) => ({
          label: `${s.nome} · restantes`,
          value: formatNumber(s.restantes),
          // "reservados" são números que uma estação separou para si e ainda
          // não gravou — já saíram do pool, mas nenhuma carretinha os leva
          // ainda. Sem isso na tela, some número e ninguém entende por quê.
          sub: [
            `${formatNumber(s.usados)} usados`,
            s.reservados > 0 ? `${formatNumber(s.reservados)} reservados na estação` : null,
            `faixa ${s.faixaMin}–${s.faixaMax}`,
            s.alerta ? '⚠ acabando' : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }))}
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Label>Buscar</Label>
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="VIN, operador ou modelo..." className="font-mono" />
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="padrao">Padrão</option>
            <option value="especial">⭐ Especial</option>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="concluida">Concluída</option>
            <option value="em_andamento">Em andamento</option>
            <option value="nao_concluida">Não concluída</option>
            <option value="cancelada">Cancelada</option>
          </Select>
        </div>
        <div>
          <Label>Ano do chassi</Label>
          <Select value={ano} onChange={(e) => setAno(e.target.value)}>
            <option value="">Todos</option>
            {anosDisponiveis.map((a) => (
              <option key={a} value={String(a)}>{a}</option>
            ))}
          </Select>
        </div>
      </div>

      <DataTable
        data={filtradas}
        columns={columns}
        loading={gravacoesQ.isLoading}
        onRowClick={(g) => setDetalheId(g.id)}
        searchable={false}
        emptyMessage="Nenhum chassi gravado ainda. As gravações da marcadora aparecem aqui."
      />

      {/* ── Detalhe da gravação (trilha de auditoria) ─────────────────────── */}
      <Sheet open={detalheId != null} onOpenChange={(o) => !o && setDetalheId(null)}>
        <SheetContent size="md">
          <SheetHeader>
            <SheetTitle className="font-mono">{detalhe?.vin ?? 'Carregando...'}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {detalheQ.isLoading || !detalhe ? (
              <p className="text-sm text-content-muted">Carregando detalhes...</p>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <p className="text-xs text-content-muted">Modelo</p>
                    <p>{modeloDe(detalhe)}</p>
                    {detalhe.quadro && <p className="font-mono text-xs text-content-muted">{detalhe.quadro.codigo}</p>}
                  </div>
                  <div>
                    <p className="text-xs text-content-muted">Série</p>
                    <p>{detalhe.serie.nome}</p>
                    <p className="font-mono text-xs text-content-muted">{detalhe.serie.prefixo} + {String(detalhe.numero).padStart(4, '0')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-content-muted">Operador</p>
                    <p>{detalhe.operador}</p>
                  </div>
                  <div>
                    <p className="text-xs text-content-muted">Status</p>
                    <Badge variant={STATUS_VARIANT[detalhe.status]}>{STATUS_LABEL[detalhe.status]}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-content-muted">Início</p>
                    <p>{formatDateTime(detalhe.criadoEm)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-content-muted">Conclusão</p>
                    <p>{detalhe.concluidoEm ? formatDateTime(detalhe.concluidoEm) : '—'}</p>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-content-muted">
                    Marcações no chassi
                  </p>
                  {(() => {
                    const feitas = etapasConcluidas(detalhe.eventos);
                    return (
                      <div className="grid grid-cols-3 gap-2">
                        {ETAPAS_ORDEM.map((etapa) => {
                          const ok = feitas.has(etapa);
                          return (
                            <div
                              key={etapa}
                              className={
                                'rounded-lg border px-3 py-2 text-center ' +
                                (ok
                                  ? 'border-success/40 bg-success/10'
                                  : 'border-line bg-surface-secondary')
                              }
                            >
                              <p className="text-lg leading-none">{ok ? '✓' : '○'}</p>
                              <p className="mt-1 text-xs font-medium">{ETAPA_LABEL[etapa]}</p>
                              <p className="text-[11px] text-content-muted">
                                {ok ? 'gravada' : 'não gravada'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-content-muted">Trilha de auditoria</p>
                  <ol className="space-y-2 border-l border-line pl-4">
                    {detalhe.eventos.map((e) => (
                      <li key={e.id} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
                        <p>
                          {EVENTO_LABEL[e.evento] ?? e.evento}
                          {e.etapa && <span className="text-content-muted"> · {ETAPA_LABEL[e.etapa] ?? e.etapa}</span>}
                        </p>
                        <p className="text-xs text-content-muted">
                          {formatDateTime(e.criadoEm)}
                          {e.operador ? ` · ${e.operador}` : ''}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* ── Guia de instalação da ferramenta ──────────────────────────────── */}
      <Sheet open={instalarAberto} onOpenChange={setInstalarAberto}>
        <SheetContent size="lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ScanBarcode size={18} />
              Instalar a ferramenta de gravação (OpenClaw)
            </SheetTitle>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-4 text-sm">
              <p className="text-content-secondary">
                A ferramenta roda <strong>localmente</strong> no computador ao lado da marcadora
                (ela fala com a marcadora pela porta serial e com a impressora de etiquetas).
                Os dados vão direto para o ERP. As gravações aparecem nesta tela.
              </p>

              <a
                href={INSTALADOR_URL}
                download
                className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'w-full')}
              >
                <Download size={16} />
                Baixar o instalador (v{INSTALADOR_VERSAO} · ~59 MB)
              </a>

              <div>
                <p className="mb-1 font-medium">Pré-requisitos do computador</p>
                <ul className="list-disc space-y-1 pl-5 text-content-secondary">
                  <li>Windows 10/11 (64 bits). <strong>Não precisa de Python nem de internet durante a instalação</strong>: o instalador leva tudo</li>
                  <li>Marcadora conectada via USB (adaptador serial FTDI)</li>
                  <li>Impressora de etiquetas Elgin L42-DT instalada (driver Generic/Text Only)</li>
                </ul>
              </div>

              <div>
                <p className="mb-1 font-medium">Passo a passo</p>
                <ol className="list-decimal space-y-1 pl-5 text-content-secondary">
                  <li>Execute o <span className="font-mono text-xs">Marcadora_de_Chassi_*.exe</span> baixado acima: ele instala em <span className="font-mono text-xs">C:\OpenClaw</span> e cria o atalho <strong>“Marcadora de Chassi”</strong> na área de trabalho (não precisa de administrador)</li>
                  <li>Solicite o provisionamento da credencial de banco para a máquina (ver aviso abaixo) e salve-a em <span className="font-mono text-xs">C:\OpenClaw\app\.streamlit\secrets.toml</span> conforme o modelo que acompanha a instalação</li>
                  <li>Abra o atalho <strong>“Marcadora de Chassi”</strong>: a tela abre sozinha no navegador, sem janela de terminal</li>
                  <li>Use o botão <strong>“🩺 Diagnóstico da estação”</strong> na tela inicial: ele confere banco local, nuvem, fila offline, impressora, marcadora no USB e a trava de segurança, sem tocar na máquina</li>
                  <li>Confirme o chip “☁ Nuvem sincronizada” no topo da ferramenta</li>
                  <li>Faça uma gravação de teste em sucata antes de liberar para o operador</li>
                </ol>
                <p className="mt-1 text-xs text-content-muted">
                  Para desinstalar: Painel de Controle → Programas (os registros e a credencial da
                  estação são preservados). Atualização: instalar a versão nova por cima.
                </p>
              </div>

              <Alert variant="warning" title="Credencial de acesso ao banco">
                A credencial da ferramenta (usuário dedicado, privilégio mínimo) <strong>não acompanha o
                instalador</strong> e não deve ser copiada de outra máquina. O provisionamento é feito por
                máquina, por canal seguro. Fale com o responsável pelo ERP.
              </Alert>

              <Alert variant="info" title="Gravação física ainda travada">
                A ferramenta instala com a trava de segurança <strong>ligada</strong>: registra e imprime
                etiqueta, mas não envia comando à marcadora. A liberação acontece só no teste
                controlado em sucata (issue #1033).
              </Alert>

              <p className="text-xs text-content-muted">
                O instalador é autocontido (Python embutido) e é gerado por{' '}
                <span className="font-mono">scripts/openclaw/instalador/construir_setup.py</span> do
                projeto producao_v2, publicado na tag <span className="font-mono">openclaw-v{INSTALADOR_VERSAO}</span> deste
                repositório (fora do trem de releases do ERP).
              </p>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
