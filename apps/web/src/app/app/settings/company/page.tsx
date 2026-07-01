'use client';

import { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useDetail, useList, useUpdate } from '@/hooks/use-resource';
import type { Company, CompanyType, TaxRegime } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { formatCNPJ, formatPhone, formatCEP, formatDate, unmask } from '@/lib/format';
import { CompanyForm, type CompanyFormValues } from './company-form';

const RESOURCE = '/companies';

const TYPE_LABEL: Record<CompanyType, string> = { MATRIZ: 'Matriz', FILIAL: 'Filial' };
const REGIME_LABEL: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};
const CRT_LABEL: Record<number, string> = {
  1: '1 — Simples Nacional',
  2: '2 — SN, excesso de sublimite',
  3: '3 — Regime Normal',
};

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-content-muted">{label}</dt>
      <dd className="text-sm text-content">{value ?? '—'}</dd>
    </div>
  );
}

export default function CompanyPage() {
  const user = useAuthStore((s) => s.user);
  const companyId = user?.companyId ?? '';
  const canEdit = user?.role === 'SUPER_ADMIN';

  const toast = useToast();

  const { data: company, isLoading } = useDetail<Company>(RESOURCE, companyId || undefined);
  const { data: companies = [] } = useList<Company>(RESOURCE);
  const update = useUpdate<Company>(RESOURCE);

  const parentName = useMemo(() => {
    if (!company?.parentId) return null;
    return companies.find((c) => c.id === company.parentId)?.name ?? null;
  }, [company, companies]);

  const [dialogOpen, setDialogOpen] = useState(false);

  function handleSubmit(values: CompanyFormValues) {
    if (!company) return;
    update.mutate(
      { id: company.id, data: { ...values, cnpj: unmask(values.cnpj) } },
      {
        onSuccess: () => {
          toast.success('Empresa atualizada');
          setDialogOpen(false);
        },
        onError: () => toast.error('Erro ao atualizar empresa'),
      },
    );
  }

  if (isLoading || !company) {
    return (
      <div>
        <PageHeader title="Empresa" description="Dados cadastrais e fiscais da empresa." />
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const hasAddress =
    company.street || company.city || company.zipCode || company.phone || company.email;
  const hasFiscal =
    company.razaoSocial || company.ie || company.crt != null || company.taxRegime || company.cnae;

  return (
    <div>
      <PageHeader
        title="Empresa"
        description="Dados cadastrais e fiscais da empresa."
        actions={
          canEdit ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Pencil size={16} />
              Editar
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Identificação */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Identificação</CardTitle>
            <Badge variant={company.type === 'MATRIZ' ? 'brand' : 'neutral'}>
              {TYPE_LABEL[company.type]}
            </Badge>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-line">
              <Row label="Nome" value={company.name} />
              <Row
                label="CNPJ"
                value={<span className="font-mono">{formatCNPJ(company.cnpj)}</span>}
              />
              <Row label="Tipo" value={TYPE_LABEL[company.type]} />
              {company.type === 'FILIAL' && <Row label="Empresa pai" value={parentName} />}
              <Row label="Data de cadastro" value={formatDate(company.createdAt)} />
            </dl>
          </CardContent>
        </Card>

        {/* Dados fiscais */}
        <Card>
          <CardHeader>
            <CardTitle>Dados fiscais</CardTitle>
          </CardHeader>
          <CardContent>
            {hasFiscal ? (
              <dl className="grid grid-cols-2 gap-x-6 divide-line">
                <Row label="Razão social" value={company.razaoSocial} />
                <Row label="CNAE" value={company.cnae} />
                <Row label="Inscrição Estadual" value={company.ie} />
                <Row label="Inscrição Municipal" value={company.im} />
                <Row
                  label="Regime tributário"
                  value={company.taxRegime ? REGIME_LABEL[company.taxRegime] : undefined}
                />
                <Row
                  label="CRT"
                  value={company.crt != null ? CRT_LABEL[company.crt] ?? company.crt : undefined}
                />
                <Row label="SUFRAMA" value={company.suframa} />
              </dl>
            ) : (
              <p className="py-4 text-sm text-content-muted">
                Nenhum dado fiscal cadastrado para esta empresa.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Endereço */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Endereço e contato</CardTitle>
          </CardHeader>
          <CardContent>
            {hasAddress ? (
              <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                <Row
                  label="Logradouro"
                  value={
                    company.street
                      ? `${company.street}${company.number ? `, ${company.number}` : ''}`
                      : undefined
                  }
                />
                <Row label="Complemento" value={company.complement} />
                <Row label="Bairro" value={company.neighborhood} />
                <Row
                  label="Cidade / UF"
                  value={
                    company.city
                      ? `${company.city}${company.state ? ` / ${company.state}` : ''}`
                      : undefined
                  }
                />
                <Row label="CEP" value={company.zipCode ? formatCEP(company.zipCode) : undefined} />
                <Row label="Código IBGE" value={company.ibgeCode} />
                <Row
                  label="Telefone"
                  value={company.phone ? formatPhone(company.phone) : undefined}
                />
                <Row label="E-mail" value={company.email} />
              </dl>
            ) : (
              <p className="py-4 text-sm text-content-muted">Nenhum endereço cadastrado.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Editar empresa"
        description={`Editando "${company.name}"`}
        formId="company-form"
        loading={update.isPending}
      >
        <CompanyForm
          formId="company-form"
          defaultValues={{
            name: company.name,
            cnpj: formatCNPJ(company.cnpj),
            type: company.type,
          }}
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
