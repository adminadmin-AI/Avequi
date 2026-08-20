'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { apiClient, confirmarCanalDeSessao, registrarSessao } from '@/lib/api-client';
import { useMyCompanies, type EmpresaDisponivel } from '@/hooks/use-my-companies';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui';

/**
 * Seletor de empresa ativa — grupo econômico (#1119).
 *
 * ── Por que ele é chamativo ───────────────────────────────────────────────
 * A empresa ativa não é preferência de exibição: ela define o CNPJ EMITENTE
 * da NF-e, os títulos que aparecem e onde o pedido é gravado. Trabalhar
 * achando que está na GDR quando está na CRD é um erro caro e silencioso —
 * por isso o controle fica no topo, com a inicial da empresa num quadrado de
 * cor PRÓPRIA (derivada do id), e não um texto discreto no canto. A cor é o
 * que o olho pega sem ler.
 *
 * ── Por que ele some ──────────────────────────────────────────────────────
 * Com uma empresa só (todo tenant sem grupo econômico), não renderiza nada.
 * Ninguém ganha um controle a mais por causa de uma feature que não usa.
 */

/** Paleta fixa; o índice sai do id, então a cor de cada empresa é estável. */
const CORES = [
  { chip: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300', dot: 'bg-indigo-500' },
  { chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  { chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  { chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
  { chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', dot: 'bg-rose-500' },
  { chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-300', dot: 'bg-violet-500' },
];

function corDaEmpresa(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CORES[hash % CORES.length];
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

export function CompanySwitcher() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { empresas, temGrupo } = useMyCompanies();
  const [trocando, setTrocando] = useState<string | null>(null);

  // Sem grupo econômico, o controle inteiro não existe.
  if (!temGrupo) return null;

  const ativa = empresas.find((e) => e.id === user?.companyId);
  const cor = corDaEmpresa(ativa?.id ?? '');

  async function trocar(empresa: EmpresaDisponivel) {
    if (empresa.id === user?.companyId || trocando) return;
    setTrocando(empresa.id);
    try {
      const { data } = await apiClient.post('/auth/switch-company', {
        empresaId: empresa.id,
      });
      // Mesmo caminho do login: cookies novos (ou Bearer, se o browser
      // descartar o cookie) antes de qualquer outra chamada sair.
      if (registrarSessao(data) === 'cookie') {
        await confirmarCanalDeSessao(data);
      }
      useAuthStore.setState((s) =>
        s.user ? { user: { ...s.user, companyId: empresa.id } } : s,
      );
      // CRÍTICO: o cache do React Query não sabe de empresa. Sem o clear, a
      // tela da CRD abriria com títulos e pedidos da GDR até cada query
      // revalidar sozinha — exatamente o tipo de confusão que esta feature
      // não pode criar.
      queryClient.clear();
      router.refresh();
    } finally {
      setTrocando(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 dark:hover:bg-neutral-800"
          aria-label={`Empresa ativa: ${ativa?.name ?? '—'}. Trocar de empresa`}
        >
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold',
              cor.chip,
            )}
          >
            {iniciais(ativa?.name ?? '?')}
          </span>
          <span className="hidden max-w-[160px] truncate text-sm font-medium text-content sm:block">
            {ativa?.name ?? '—'}
          </span>
          <ChevronsUpDown size={14} className="text-content-muted" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72 p-0">
        <div className="border-b border-line px-3 py-2">
          <p className="text-helper font-medium text-content-secondary">
            Trabalhando em
          </p>
          <p className="text-helper text-content-muted">
            Trocar muda os dados e o emitente das notas.
          </p>
        </div>

        <div className="p-1.5">
          {empresas.map((empresa) => {
            const corItem = corDaEmpresa(empresa.id);
            const ehAtiva = empresa.id === user?.companyId;
            return (
              <DropdownMenuItem
                key={empresa.id}
                onSelect={(e) => {
                  e.preventDefault();
                  void trocar(empresa);
                }}
                className="gap-2.5"
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold',
                    corItem.chip,
                  )}
                >
                  {iniciais(empresa.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-content">{empresa.name}</span>
                    {empresa.isBranch && (
                      <span className="shrink-0 text-helper text-content-muted">filial</span>
                    )}
                  </span>
                  <span className="block truncate text-helper text-content-muted">
                    {empresa.cnpj}
                  </span>
                </span>
                {trocando === empresa.id ? (
                  <Loader2 size={15} className="shrink-0 animate-spin text-content-muted" />
                ) : ehAtiva ? (
                  <Check size={15} className="shrink-0 text-brand-600" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-helper text-content-muted">
          <Building2 size={12} />
          <span>Grupo econômico</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
