'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';
import { erroDeAcao } from '@/lib/feedback';
import { CARD_BRANDS } from '../../sales/payment-plan-editor';

/**
 * #585 — cadastro de adquirentes (credenciadoras) + tabela de taxas MDR e
 * prazo de liquidação. Fonte da verdade do valor líquido e da data de
 * recebimento de cada forma de cartão — a taxa é CONGELADA na venda.
 * Restrito a FINANCEIRO (decisão E1 #623: taxas negociadas são sensíveis).
 */

interface AcquirerFee {
  id: string;
  brand: string | null;
  modality: 'DEBITO' | 'CREDITO_AVISTA' | 'CREDITO_PARCELADO';
  installmentsFrom: number;
  installmentsTo: number;
  mdrRate: string;
  settlementDays: number;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}

interface Acquirer {
  id: string;
  name: string;
  cnpj: string | null;
  gateway: 'MOCK' | 'INFINITEPAY' | 'GETNET';
  isActive: boolean;
  fees: AcquirerFee[];
}

const MODALITY_LABEL: Record<AcquirerFee['modality'], string> = {
  DEBITO: 'Débito',
  CREDITO_AVISTA: 'Crédito à vista',
  CREDITO_PARCELADO: 'Crédito parcelado',
};

/** TEF/gateway que autoriza as transações da adquirente (#596 multi-adquirente) */
const GATEWAY_LABEL: Record<Acquirer['gateway'], string> = {
  MOCK: 'Não integrada (simulado)',
  INFINITEPAY: 'InfinitePay',
  GETNET: 'Getnet',
};

const RESOURCE = '/acquirers';

export default function AcquirersPage() {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: acquirers = [], isLoading } = useQuery<Acquirer[]>({
    queryKey: [RESOURCE],
    queryFn: async () => (await apiClient.get(RESOURCE)).data,
  });

  // ── dialog de adquirente (criar/editar) ────────────────────────────────────
  const [acqOpen, setAcqOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [gateway, setGateway] = useState<Acquirer['gateway']>('MOCK');

  const saveAcquirer = useMutation({
    mutationFn: () =>
      editingId
        ? apiClient.patch(`${RESOURCE}/${editingId}`, { name, cnpj: cnpj || undefined, gateway })
        : apiClient.post(RESOURCE, { name, cnpj: cnpj || undefined, gateway }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      setAcqOpen(false);
      toast.success(editingId ? 'Adquirente atualizada' : 'Adquirente criada');
    },
    onError: (e: any) => toast.error(erroDeAcao('salvar a adquirente', e)),
  });

  const toggleAcquirer = useMutation({
    mutationFn: (a: Acquirer) => apiClient.patch(`${RESOURCE}/${a.id}`, { isActive: !a.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
    onError: (e: any) => toast.error(erroDeAcao('alterar o status da adquirente', e)),
  });

  // ── dialog de taxa ─────────────────────────────────────────────────────────
  const [feeOpen, setFeeOpen] = useState(false);
  const [feeAcquirerId, setFeeAcquirerId] = useState('');
  const [brand, setBrand] = useState('');
  const [modality, setModality] = useState<AcquirerFee['modality']>('CREDITO_AVISTA');
  const [instFrom, setInstFrom] = useState('1');
  const [instTo, setInstTo] = useState('1');
  const [mdrRate, setMdrRate] = useState('');
  const [settlementDays, setSettlementDays] = useState('30');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');

  function openFeeDialog(acquirerId: string) {
    setFeeAcquirerId(acquirerId);
    setBrand('');
    setModality('CREDITO_AVISTA');
    setInstFrom('1');
    setInstTo('1');
    setMdrRate('');
    setSettlementDays('30');
    setValidFrom('');
    setValidTo('');
    setFeeOpen(true);
  }

  const saveFee = useMutation({
    mutationFn: () =>
      apiClient.post(`${RESOURCE}/${feeAcquirerId}/fees`, {
        brand: brand || undefined,
        modality,
        installmentsFrom: modality === 'CREDITO_PARCELADO' ? Number(instFrom) : 1,
        installmentsTo: modality === 'CREDITO_PARCELADO' ? Number(instTo) : 1,
        mdrRate: Number(mdrRate),
        settlementDays: Number(settlementDays),
        validFrom: validFrom || undefined,
        validTo: validTo || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      setFeeOpen(false);
      toast.success('Taxa cadastrada');
    },
    onError: (e: any) => toast.error(erroDeAcao('cadastrar a taxa', e)),
  });

  const deactivateFee = useMutation({
    mutationFn: (feeId: string) => apiClient.patch(`${RESOURCE}/fees/${feeId}`, { isActive: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      toast.success('Taxa desativada. Cadastre a nova vigência.');
    },
    onError: (e: any) => toast.error(erroDeAcao('desativar a taxa', e)),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Adquirentes e taxas"
        description="Adquirentes de cartão, taxas MDR e prazo de liquidação. A taxa vigente é congelada em cada venda."
        actions={
          <Button
            onClick={() => {
              setEditingId(null);
              setName('');
              setCnpj('');
              setGateway('MOCK');
              setAcqOpen(true);
            }}
          >
            <Plus size={16} />
            Nova adquirente
          </Button>
        }
      />

      {acquirers.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-content-muted">
            <CreditCard className="mx-auto mb-2" size={24} />
            Nenhuma adquirente cadastrada. Cadastre a adquirente (Cielo, Rede, Stone…) e as taxas
            contratadas. Sem taxa vigente a venda com cartão é bloqueada.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {acquirers.map((a) => (
            <Card key={a.id}>
              <CardContent className="py-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-content">{a.name}</h3>
                    {a.cnpj && <span className="font-mono text-xs text-content-muted">{a.cnpj}</span>}
                    <Badge variant={a.isActive ? 'success' : 'neutral'}>
                      {a.isActive ? 'Ativa' : 'Inativa'}
                    </Badge>
                    <Badge variant={a.gateway === 'MOCK' ? 'warning' : 'info'}>
                      TEF: {GATEWAY_LABEL[a.gateway] ?? a.gateway}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openFeeDialog(a.id)}>
                      <Plus size={14} />
                      Nova taxa
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingId(a.id);
                        setName(a.name);
                        setCnpj(a.cnpj ?? '');
                        setGateway(a.gateway ?? 'MOCK');
                        setAcqOpen(true);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant={a.isActive ? 'ghost' : 'secondary'}
                      onClick={() => toggleAcquirer.mutate(a)}
                    >
                      {a.isActive ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                </div>

                {a.fees.length === 0 ? (
                  <p className="py-3 text-sm text-content-muted">
                    Sem taxa ativa. Venda com cartão nesta adquirente será bloqueada até cadastrar.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line text-xs uppercase tracking-wide text-content-muted">
                          <th className="py-2 text-left font-medium">Modalidade</th>
                          <th className="py-2 text-left font-medium">Bandeira</th>
                          <th className="py-2 text-right font-medium">Parcelas</th>
                          <th className="py-2 text-right font-medium">MDR</th>
                          <th className="py-2 text-right font-medium">Liquidação</th>
                          <th className="py-2 text-left font-medium">Vigência</th>
                          <th className="py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.fees.map((f) => (
                          <tr key={f.id} className="border-b border-line last:border-0">
                            <td className="py-2">{MODALITY_LABEL[f.modality]}</td>
                            <td className="py-2">{f.brand ?? 'Qualquer'}</td>
                            <td className="py-2 text-right tabular-nums">
                              {f.installmentsFrom === f.installmentsTo
                                ? `${f.installmentsFrom}x`
                                : `${f.installmentsFrom}–${f.installmentsTo}x`}
                            </td>
                            <td className="py-2 text-right font-medium tabular-nums">{Number(f.mdrRate)}%</td>
                            <td className="py-2 text-right tabular-nums">D+{f.settlementDays}</td>
                            <td className="py-2 text-xs text-content-secondary">
                              {f.validFrom ? formatDate(f.validFrom) : '—'} →{' '}
                              {f.validTo ? formatDate(f.validTo) : 'vigente'}
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => deactivateFee.mutate(f.id)}
                                title="Desativa esta taxa (cadastre a nova vigência em seguida)"
                              >
                                Desativar
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog adquirente */}
      <FormDialog
        open={acqOpen}
        onOpenChange={setAcqOpen}
        title={editingId ? 'Editar adquirente' : 'Nova adquirente'}
        description="O CNPJ da credenciadora vai no grupo card da NF-e (tpIntegra=1)."
        formId="acquirer-form"
        submitLabel="Salvar"
        loading={saveAcquirer.isPending}
      >
        <form
          id="acquirer-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              toast.error('Informe o nome da adquirente');
              return;
            }
            saveAcquirer.mutate();
          }}
          className="space-y-4 py-1"
        >
          <div>
            <Label required>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cielo, Rede, Stone…" />
          </div>
          <div>
            <Label>CNPJ da adquirente</Label>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value.replace(/\D/g, ''))}
              placeholder="Só números (14 dígitos)"
              maxLength={14}
            />
          </div>
          <div>
            <Label>TEF / gateway de autorização</Label>
            <Select value={gateway} onChange={(e) => setGateway(e.target.value as Acquirer['gateway'])}>
              {(Object.keys(GATEWAY_LABEL) as Acquirer['gateway'][]).map((g) => (
                <option key={g} value={g}>
                  {GATEWAY_LABEL[g]}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-content-muted">
              Cada adquirente autoriza no seu próprio TEF. InfinitePay e Getnet podem coexistir.
              “Não integrada” só autoriza simulado (dev/homologação).
            </p>
          </div>
        </form>
      </FormDialog>

      {/* Dialog taxa */}
      <FormDialog
        open={feeOpen}
        onOpenChange={setFeeOpen}
        title="Nova taxa MDR"
        description="Bandeira específica vence a genérica; vigência mais recente vence a antiga."
        formId="fee-form"
        submitLabel="Cadastrar taxa"
        loading={saveFee.isPending}
      >
        <form
          id="fee-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!(Number(mdrRate) > 0)) {
              toast.error('Informe a taxa MDR (%)');
              return;
            }
            if (modality === 'CREDITO_PARCELADO' && Number(instTo) < Number(instFrom)) {
              toast.error('Faixa de parcelas inválida');
              return;
            }
            saveFee.mutate();
          }}
          className="grid gap-4 py-1 sm:grid-cols-2"
        >
          <div>
            <Label required>Modalidade</Label>
            <Select value={modality} onChange={(e) => setModality(e.target.value as AcquirerFee['modality'])}>
              <option value="DEBITO">Débito</option>
              <option value="CREDITO_AVISTA">Crédito à vista</option>
              <option value="CREDITO_PARCELADO">Crédito parcelado</option>
            </Select>
          </div>
          <div>
            <Label>Bandeira</Label>
            <Select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">Qualquer (genérica)</option>
              {CARD_BRANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </div>
          {modality === 'CREDITO_PARCELADO' && (
            <>
              <div>
                <Label required>Parcelas de</Label>
                <Input type="number" min="2" max="24" value={instFrom} onChange={(e) => setInstFrom(e.target.value)} />
              </div>
              <div>
                <Label required>até</Label>
                <Input type="number" min="2" max="24" value={instTo} onChange={(e) => setInstTo(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label required>Taxa MDR (%)</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={mdrRate}
              onChange={(e) => setMdrRate(e.target.value)}
              placeholder="3.49"
            />
          </div>
          <div>
            <Label required>Liquidação (D+n)</Label>
            <Input
              type="number"
              min="0"
              value={settlementDays}
              onChange={(e) => setSettlementDays(e.target.value)}
              placeholder="débito 1 · crédito 30"
            />
          </div>
          <div>
            <Label>Vigência: início</Label>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <div>
            <Label>Vigência: fim</Label>
            <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
