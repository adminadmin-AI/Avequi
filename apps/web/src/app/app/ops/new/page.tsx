'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Mail,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { mensagemDoErro } from '@/lib/api-error';
import { unmask } from '@/lib/format';
import type {
  CreateTenantInput,
  FiscalCheckResult,
  InviteAdminResult,
  TaxRegime,
  TenantProvisioning,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { MaskedInput } from '@/components/ui/masked-input';
import { Stepper, type Step } from '@/components/ui/stepper';
import { FormSection } from '@/components/ui/form-section';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

const RESOURCE = '/ops/tenants';

const UF = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const STEPS: Step[] = [
  { id: 'empresa', label: 'Empresa' },
  { id: 'admin', label: 'Admin' },
  { id: 'fiscal', label: 'Fiscal' },
  { id: 'golive', label: 'Go-live' },
];

const companySchema = z.object({
  name: z.string().min(2, 'Informe o nome'),
  cnpj: z.string().refine((v) => unmask(v).length === 14, 'CNPJ deve ter 14 dígitos'),
  razaoSocial: z.string().min(2, 'Informe a razão social'),
  ie: z.string().optional(),
  crt: z.string().optional(),
  taxRegime: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
});
type CompanyFormValues = z.infer<typeof companySchema>;

/** Primeiro passo ainda pendente do checklist — onde o wizard retomável posiciona. */
function firstPendingStep(checklist: TenantProvisioning['checklist']): number {
  if (!checklist.admin.done) return 1;
  if (!checklist.fiscal.done) return 2;
  if (!checklist.activation.done) return 3;
  return 3;
}

/**
 * Wizard de onboarding — OPS WP2 (#909). Idempotente por CNPJ e RETOMÁVEL:
 * chega com ?tenantId= (do detalhe, ou do próprio replace após criar) e
 * carrega o checklist do backend (fonte única do estado — não duplicamos
 * regra de negócio aqui). "Pode ser feio, tem que ser correto": prioriza
 * mostrar o estado real de cada passo sobre polish visual.
 */
export default function NewTenantWizardPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [positioned, setPositioned] = useState(false);

  // Lido no mount — mesmo padrão do resto do app p/ deep-link via query string.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('tenantId');
    if (tenantId) setCompanyId(tenantId);
  }, []);

  const provisioningQuery = useQuery<TenantProvisioning>({
    queryKey: [RESOURCE, companyId, 'provisioning'],
    queryFn: async () => (await apiClient.get(`${RESOURCE}/${companyId}/provisioning`)).data,
    enabled: !!companyId,
  });
  const provisioning = provisioningQuery.data;

  // Retomada: posiciona no primeiro passo pendente assim que o checklist chega.
  useEffect(() => {
    if (provisioning && !positioned) {
      setStep(firstPendingStep(provisioning.checklist));
      setPositioned(true);
    }
  }, [provisioning, positioned]);

  function refreshProvisioning() {
    return qc.invalidateQueries({ queryKey: [RESOURCE, companyId, 'provisioning'] });
  }

  // ── Passo 1 — Empresa ────────────────────────────────────────────────────
  const companyForm = useForm<CompanyFormValues>({ resolver: zodResolver(companySchema) });

  const createTenant = useMutation({
    mutationFn: (values: CompanyFormValues) => {
      const payload: CreateTenantInput = {
        name: values.name,
        cnpj: unmask(values.cnpj),
        razaoSocial: values.razaoSocial,
        ie: values.ie || undefined,
        crt: values.crt ? (Number(values.crt) as 1 | 2 | 3) : undefined,
        taxRegime: (values.taxRegime || undefined) as TaxRegime | undefined,
        state: values.state || undefined,
        city: values.city || undefined,
        email: values.email || undefined,
      };
      return apiClient.post<TenantProvisioning>(RESOURCE, payload);
    },
    onSuccess: (res) => {
      const data = res.data;
      setCompanyId(data.company.id);
      qc.setQueryData([RESOURCE, data.company.id, 'provisioning'], data);
      router.replace(`/app/ops/new?tenantId=${data.company.id}`);
      setStep(firstPendingStep(data.checklist));
      setPositioned(true);
      toast.success('Conta criada — continue o onboarding');
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Erro ao criar a conta'),
  });

  // ── Passo 2 — Admin ──────────────────────────────────────────────────────
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');

  useEffect(() => {
    const admin = provisioning?.checklist.admin;
    if (admin?.invited) {
      setAdminEmail((prev) => prev || admin.email);
    }
  }, [provisioning?.checklist.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const inviteAdmin = useMutation({
    mutationFn: () =>
      apiClient.post<InviteAdminResult>(`${RESOURCE}/${companyId}/provisioning/admin`, {
        name: adminName,
        email: adminEmail,
      }),
    onSuccess: (res) => {
      refreshProvisioning();
      toast[res.data.emailSent ? 'success' : 'warning'](
        res.data.emailSent
          ? `Convite enviado para ${res.data.email}`
          : `Convite criado, mas o e-mail falhou — reenvie depois (${res.data.emailError ?? 'erro no envio'})`,
      );
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Erro ao convidar o admin'),
  });

  function submitAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!adminName.trim() || !adminEmail.trim()) {
      toast.error('Informe nome e e-mail do admin');
      return;
    }
    inviteAdmin.mutate();
  }

  // ── Passo 3 — Fiscal ─────────────────────────────────────────────────────
  const fiscalCheck = useMutation({
    mutationFn: () =>
      apiClient.post<FiscalCheckResult>(`${RESOURCE}/${companyId}/provisioning/fiscal-check`),
    onSuccess: () => refreshProvisioning(),
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Erro ao verificar a config fiscal'),
  });

  // ── Passo 4 — Go-live ────────────────────────────────────────────────────
  const activate = useMutation({
    mutationFn: () => apiClient.post(`${RESOURCE}/${companyId}/activate`),
    onSuccess: () => {
      toast.success('Conta ativada — go-live concluído');
      router.push('/app/ops/tenants');
    },
    onError: (err) => toast.error(mensagemDoErro(err) ?? 'Não foi possível ativar a conta'),
  });

  const checklist = provisioning?.checklist;

  function next() {
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <div>
      <PageHeader
        title="Nova conta de cliente"
        description="Onboarding de um tenant novo — pode ser retomado a qualquer momento pelo link com ?tenantId=."
        actions={
          <Button variant="secondary" onClick={() => router.push('/app/ops/tenants')}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      <Stepper
        steps={STEPS}
        current={step}
        onStepClick={companyId ? setStep : undefined}
        className="mx-auto mb-6 max-w-2xl"
      />

      {/* Passo 1 — Empresa */}
      {step === 0 &&
        (companyId ? (
          <Card className="mb-5">
            <CardContent className="flex items-center gap-3 py-5">
              <Check className="text-success" size={20} />
              <div>
                <p className="text-sm font-medium text-content">
                  {provisioning?.company.name ?? 'Empresa criada'}
                </p>
                <p className="text-xs text-content-muted">
                  A empresa raiz já foi criada (TRIAL). Siga para o próximo passo.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <FormSection
            title="Dados da empresa"
            description="Nasce como TRIAL. CNPJ é único — se já existir um onboarding aberto com este CNPJ, ele é retomado."
            className="mb-5"
          >
            <Field label="Nome" required error={companyForm.formState.errors.name?.message}>
              <Input {...companyForm.register('name')} placeholder="Nome fantasia" />
            </Field>
            <Field label="CNPJ" required error={companyForm.formState.errors.cnpj?.message}>
              <Controller
                name="cnpj"
                control={companyForm.control}
                render={({ field }) => (
                  <MaskedInput
                    mask="cnpj"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value)}
                    placeholder="00.000.000/0000-00"
                  />
                )}
              />
            </Field>
            <Field
              label="Razão social"
              required
              error={companyForm.formState.errors.razaoSocial?.message}
            >
              <Input {...companyForm.register('razaoSocial')} placeholder="Razão social" />
            </Field>
            <Field label="Inscrição Estadual" error={companyForm.formState.errors.ie?.message}>
              <Input {...companyForm.register('ie')} placeholder="Opcional" />
            </Field>
            <Field label="Regime tributário" error={companyForm.formState.errors.crt?.message}>
              <Select {...companyForm.register('crt')}>
                <option value="">—</option>
                <option value="1">1 — Simples Nacional</option>
                <option value="2">2 — Simples Nacional, excesso sublimite</option>
                <option value="3">3 — Regime Normal</option>
              </Select>
            </Field>
            <Field label="Regime de tributação" error={companyForm.formState.errors.taxRegime?.message}>
              <Select {...companyForm.register('taxRegime')}>
                <option value="">—</option>
                <option value="SIMPLES_NACIONAL">Simples Nacional</option>
                <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
                <option value="LUCRO_REAL">Lucro Real</option>
              </Select>
            </Field>
            <Field label="Cidade" error={companyForm.formState.errors.city?.message}>
              <Input {...companyForm.register('city')} placeholder="Opcional" />
            </Field>
            <Field label="UF" error={companyForm.formState.errors.state?.message}>
              <Select {...companyForm.register('state')}>
                <option value="">—</option>
                {UF.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="E-mail de contato" error={companyForm.formState.errors.email?.message}>
              <Input {...companyForm.register('email')} type="email" placeholder="Opcional" />
            </Field>
          </FormSection>
        ))}

      {/* Passo 2 — Admin */}
      {step === 1 && (
        <Card className="mb-5">
          <CardContent className="space-y-4 py-5">
            <h3 className="text-sm font-semibold text-content-secondary">Admin do tenant</h3>
            <p className="text-xs text-content-muted">
              Cria (ou reaproveita) o usuário admin e envia o convite de primeiro acesso.
              Reenviar revoga o convite anterior.
            </p>

            {checklist?.admin.invited && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                  checklist.admin.accepted
                    ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-900 dark:bg-success-900/20 dark:text-success-400'
                    : 'border-line bg-surface-secondary text-content-secondary'
                }`}
              >
                {checklist.admin.accepted ? <Check size={16} className="mt-0.5 shrink-0" /> : <Mail size={16} className="mt-0.5 shrink-0" />}
                <div>
                  <p>
                    Convite para <strong>{checklist.admin.email}</strong>
                    {checklist.admin.accepted ? ' — aceito ✓' : ' — aguardando aceite'}
                  </p>
                  {!checklist.admin.emailSent && (
                    <p className="mt-1 flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertCircle size={13} /> E-mail falhou ao enviar — copie o link ou reenvie.
                    </p>
                  )}
                  {!checklist.admin.accepted && checklist.admin.inviteExpiresAt && (
                    <p className="mt-1 text-xs text-content-muted">
                      Expira em {new Date(checklist.admin.inviteExpiresAt).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={submitAdmin} className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label required>Nome</Label>
                <Input
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Nome do admin"
                />
              </div>
              <div>
                <Label required>E-mail</Label>
                <Input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@cliente.com.br"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" loading={inviteAdmin.isPending} disabled={!companyId}>
                  {checklist?.admin.invited ? (
                    <>
                      <RefreshCw size={16} />
                      Reenviar convite
                    </>
                  ) : (
                    <>
                      <Mail size={16} />
                      Enviar convite
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Passo 3 — Fiscal */}
      {step === 2 && (
        <Card className="mb-5">
          <CardContent className="space-y-4 py-5">
            <h3 className="text-sm font-semibold text-content-secondary">Configuração fiscal</h3>
            <p className="text-xs text-content-muted">
              Exige um token Focus NFe ESCOPADO para este tenant — o fallback global pertence à
              matriz GDR (decisão #695) e não pode ser usado para outro cliente.
            </p>

            {checklist?.fiscal.checkedAt && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                  checklist.fiscal.ok
                    ? 'border-success-200 bg-success-50 text-success-700 dark:border-success-900 dark:bg-success-900/20 dark:text-success-400'
                    : 'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-900 dark:bg-danger-900/20 dark:text-danger-300'
                }`}
              >
                {checklist.fiscal.ok ? (
                  <Check size={16} className="mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={16} className="mt-0.5 shrink-0" />
                )}
                <div>
                  <p>{checklist.fiscal.ok ? 'Token escopado encontrado' : 'Token escopado ausente'}</p>
                  <p className="text-xs opacity-80">
                    Verificado em {new Date(checklist.fiscal.checkedAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
            )}

            {checklist && !checklist.fiscal.done && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p>
                    Defina{' '}
                    <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-xs dark:bg-white/10">
                      FOCUS_NFE_TOKEN__{companyId}
                    </code>{' '}
                    no Railway e redeploye (decisão #695), depois verifique de novo.
                  </p>
                  <button
                    type="button"
                    onClick={() => companyId && navigator.clipboard.writeText(companyId)}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:opacity-80"
                  >
                    <Copy size={12} />
                    Copiar companyId
                  </button>
                </div>
              </div>
            )}

            <Button
              onClick={() => fiscalCheck.mutate()}
              loading={fiscalCheck.isPending}
              disabled={!companyId}
              variant="secondary"
            >
              <ShieldCheck size={16} />
              Verificar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Passo 4 — Go-live */}
      {step === 3 && (
        <Card className="mb-5">
          <CardContent className="space-y-4 py-5">
            <h3 className="text-sm font-semibold text-content-secondary">Go-live</h3>
            <p className="text-xs text-content-muted">
              Gate manual: exige convite aceito pelo admin e checagem fiscal ok. TRIAL → ACTIVE.
            </p>

            <ul className="space-y-1.5 text-sm">
              <ChecklistLine label="Admin aceitou o convite" done={!!checklist?.admin.done} />
              <ChecklistLine label="Fiscal verificado" done={!!checklist?.fiscal.done} />
            </ul>

            {checklist?.activation.done ? (
              <Badge variant="success" dot>
                Conta já ativada
              </Badge>
            ) : (
              <Button onClick={() => activate.mutate()} loading={activate.isPending} disabled={!companyId}>
                <Check size={16} />
                Ativar conta
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* navegação do wizard */}
      <div className="flex justify-between gap-3">
        <Button variant="secondary" onClick={step === 0 ? () => router.push('/app/ops/tenants') : back}>
          {step === 0 ? 'Cancelar' : 'Voltar'}
        </Button>
        {step === 0 && !companyId ? (
          <Button onClick={companyForm.handleSubmit((v) => createTenant.mutate(v))} loading={createTenant.isPending}>
            Criar conta e continuar
          </Button>
        ) : (
          step < STEPS.length - 1 && <Button onClick={next}>Próximo</Button>
        )}
      </div>
    </div>
  );
}

function ChecklistLine({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {done ? (
        <Check size={15} className="text-success" />
      ) : (
        <XCircle size={15} className="text-content-muted" />
      )}
      <span className={done ? 'text-content' : 'text-content-muted'}>{label}</span>
    </li>
  );
}
