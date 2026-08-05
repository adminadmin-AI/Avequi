'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { mensagemDoErro } from '@/lib/api-error';
import { formatDateTime } from '@/lib/format';
import { backupCodesEmFalta, resolveMfaError } from '@/lib/mfa';
import type { MfaSetup, MfaStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Stepper } from '@/components/ui/stepper';
import { useToast } from '@/components/ui/toast';
import { BackupCodesPanel } from './backup-codes-panel';
import { DisableMfaDialog } from './disable-mfa-dialog';
import { MfaSetupPanel } from './mfa-setup-panel';
import { RegenerateCodesDialog } from './regenerate-codes-dialog';

const STATUS_KEY = ['/auth/mfa/status'];

const PASSOS = [
  { id: 'app', label: 'Configurar o app' },
  { id: 'codes', label: 'Guardar os códigos' },
];

/**
 * Segurança da conta (#936) — gestão self-service do MFA/TOTP.
 *
 * A API de MFA existe desde a #344, mas ativar dependia de bater no endpoint
 * na mão. Esta tela fecha o buraco: o cliente novo se serve sozinho, e o
 * operador que bate no 403 do OpsMfaGuard ("O portal da operadora exige
 * MFA…") tem para onde ir.
 *
 * Segue o precedente da irmã /app/account/password (#736): autoatendimento,
 * rota FORA do NAV de propósito → o RouteGuard trata como "unmapped" e libera
 * para qualquer autenticado (travado em lib/mfa.spec.ts). Gate de permissão
 * aqui viraria beco sem saída — quem precisa ativar é justamente quem está
 * sendo barrado.
 *
 * Tudo acontece nesta página (nada de navegar para fora no meio do fluxo):
 * `fluxo` alterna entre o cartão de estado, o painel de setup e a exibição
 * única dos backup codes.
 */
export default function AccountSecurityPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [fluxo, setFluxo] = useState<'idle' | 'setup' | 'codes'>('idle');
  const [setupData, setSetupData] = useState<MfaSetup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [origemDosCodes, setOrigemDosCodes] = useState<'ativacao' | 'regeneracao'>('ativacao');
  const [desativarAberto, setDesativarAberto] = useState(false);
  const [regenerarAberto, setRegenerarAberto] = useState(false);

  const statusQ = useQuery<MfaStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () => (await apiClient.get<MfaStatus>('/auth/mfa/status')).data,
  });

  const recarregarStatus = () => queryClient.invalidateQueries({ queryKey: STATUS_KEY });

  const iniciarSetup = useMutation({
    mutationFn: async () => (await apiClient.post<MfaSetup>('/auth/mfa/setup')).data,
    onSuccess: (data) => {
      setSetupData(data);
      setFluxo('setup');
    },
    // O caso mais provável aqui é 409 "MFA já está habilitado." (duas abas
    // abertas): a mensagem do servidor explica melhor que qualquer genérica.
    onError: (err) =>
      toast.error(
        'Não foi possível iniciar',
        resolveMfaError(err, 'Tente novamente em instantes.'),
      ),
  });

  function mostrarCodes(novos: string[], origem: 'ativacao' | 'regeneracao') {
    setCodes(novos);
    setOrigemDosCodes(origem);
    setFluxo('codes');
    setSetupData(null);
    void recarregarStatus();
  }

  function concluirCodes() {
    setCodes([]);
    setFluxo('idle');
    void recarregarStatus();
  }

  const status = statusQ.data;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Segurança"
        description="Proteja o acesso à sua conta com uma segunda etapa de verificação."
      />

      <div className="surface-sheen rounded-xl bg-surface p-5 shadow-soft">
        {fluxo !== 'idle' && origemDosCodes === 'ativacao' && (
          <Stepper
            steps={PASSOS}
            current={fluxo === 'setup' ? 0 : 1}
            className="mb-6 max-w-sm"
          />
        )}

        {fluxo === 'codes' ? (
          <BackupCodesPanel
            codes={codes}
            titulo={
              origemDosCodes === 'ativacao'
                ? 'Verificação em duas etapas ativada'
                : 'Novos backup codes gerados'
            }
            descricao={
              origemDosCodes === 'ativacao'
                ? 'A partir de agora o login pede o código do seu autenticador. Guarde os backup codes abaixo.'
                : 'Os códigos anteriores foram invalidados. Guarde a nova lista.'
            }
            onConcluir={concluirCodes}
          />
        ) : fluxo === 'setup' && setupData ? (
          <MfaSetupPanel
            setup={setupData}
            onConfirmado={(novos) => mostrarCodes(novos, 'ativacao')}
            onCancelar={() => {
              setSetupData(null);
              setFluxo('idle');
            }}
          />
        ) : statusQ.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-full max-w-sm" />
            <Skeleton className="h-10 w-56" />
          </div>
        ) : statusQ.isError ? (
          <ErrorState
            fullPage={false}
            className="border-0 bg-transparent py-4"
            title="Não foi possível carregar o estado do MFA"
            description={mensagemDoErro(statusQ.error) ?? 'Tente novamente em instantes.'}
            onRetry={() => statusQ.refetch()}
          />
        ) : status?.enabled ? (
          <MfaAtivo
            status={status}
            onRegenerar={() => setRegenerarAberto(true)}
            onDesativar={() => setDesativarAberto(true)}
          />
        ) : (
          <MfaInativo
            loading={iniciarSetup.isPending}
            onAtivar={() => iniciarSetup.mutate()}
          />
        )}
      </div>

      {fluxo === 'idle' && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-secondary px-3 py-2.5 text-caption text-content-secondary">
          <span className="flex items-start gap-2">
            <KeyRound size={16} className="mt-px shrink-0 text-content-muted" />
            Sua senha continua sendo a primeira barreira. Troque-a se suspeitar de qualquer acesso
            indevido.
          </span>
          <Link
            href="/app/account/password"
            className="shrink-0 font-medium text-brand-600 transition-colors duration-micro hover:underline dark:text-brand-400"
          >
            Alterar senha
          </Link>
        </div>
      )}

      <DisableMfaDialog
        open={desativarAberto}
        onOpenChange={setDesativarAberto}
        onDesativado={() => {
          setDesativarAberto(false);
          void recarregarStatus();
          toast.success(
            'Verificação em duas etapas desativada',
            'Sua conta agora é protegida apenas pela senha.',
          );
        }}
      />

      <RegenerateCodesDialog
        open={regenerarAberto}
        onOpenChange={setRegenerarAberto}
        onGerado={(novos) => {
          setRegenerarAberto(false);
          mostrarCodes(novos, 'regeneracao');
        }}
      />
    </div>
  );
}

/** Estado ATIVO: desde quando, quantos backup codes sobraram e o que dá para fazer. */
function MfaAtivo({
  status,
  onRegenerar,
  onDesativar,
}: {
  status: MfaStatus;
  onRegenerar: () => void;
  onDesativar: () => void;
}) {
  const poucos = backupCodesEmFalta(status.backupCodesRemaining);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
          <ShieldCheck size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-content">
              Verificação em duas etapas (MFA)
            </h2>
            <Badge variant="success">Ativa</Badge>
          </div>
          <p className="mt-1 text-sm text-content-secondary">
            O login pede o código do seu app autenticador
            {/* formatDateTime e não formatDate: `verifiedAt` é um instante, e o
                formatDate da casa força UTC (certo para campos @db.Date, errado
                aqui — uma ativação às 21h em Brasília apareceria no dia seguinte). */}
            {status.verifiedAt ? ` desde ${formatDateTime(status.verifiedAt)}` : ''}.
          </p>
        </div>
      </div>

      <div
        className={
          poucos
            ? 'rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5'
            : 'rounded-lg border border-line bg-surface-secondary px-3 py-2.5'
        }
      >
        <p className={poucos ? 'text-sm font-medium text-warning' : 'text-sm text-content'}>
          {status.backupCodesRemaining}{' '}
          {status.backupCodesRemaining === 1 ? 'backup code restante' : 'backup codes restantes'}
        </p>
        <p className="mt-0.5 text-caption text-content-secondary">
          {poucos
            ? 'Estão acabando. Gere novos agora, enquanto você ainda tem acesso ao autenticador.'
            : 'Cada código funciona uma única vez, no lugar do código do app.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="button" variant={poucos ? 'primary' : 'secondary'} onClick={onRegenerar}>
          Regenerar backup codes
        </Button>
        <Button
          type="button"
          variant="ghost"
          leftIcon={<ShieldOff size={16} />}
          onClick={onDesativar}
          className="text-danger hover:bg-danger/10 hover:text-danger"
        >
          Desativar
        </Button>
      </div>
    </div>
  );
}

/** Estado INATIVO: uma linha de porquê e um botão. */
function MfaInativo({ loading, onAtivar }: { loading: boolean; onAtivar: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-content-muted">
          <ShieldOff size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-content">
              Verificação em duas etapas (MFA)
            </h2>
            <Badge variant="neutral">Inativa</Badge>
          </div>
          <p className="mt-1 text-sm text-content-secondary">
            Com o MFA ligado, quem descobrir sua senha ainda não entra: falta o código de 6 dígitos
            que só o seu celular gera.
          </p>
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <Button
          type="button"
          leftIcon={<ShieldCheck size={16} />}
          loading={loading}
          onClick={onAtivar}
        >
          Ativar verificação em duas etapas
        </Button>
      </div>
    </div>
  );
}
