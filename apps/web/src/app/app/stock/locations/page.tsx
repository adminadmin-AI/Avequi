'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import type { Warehouse } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';

type LocationType = 'RECEIVING' | 'STORAGE' | 'STAGING';

interface WmsLocation {
  id: string;
  warehouseId: string;
  code: string;
  description?: string | null;
  type?: LocationType | null;
  isActive: boolean;
}

const TYPE_LABEL: Record<LocationType, string> = {
  RECEIVING: 'Recebimento',
  STORAGE: 'Armazenagem',
  STAGING: 'Separação',
};

export default function LocationsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['/wms/locations'],
    queryFn: async () => (await apiClient.get<WmsLocation[]>('/wms/locations')).data,
  });
  const { data: warehouses = [] } = useList<Warehouse>('/warehouses');
  const warehouseName = useMemo(() => {
    const map = new Map(warehouses.map((w) => [w.id, `${w.code} — ${w.name}`]));
    return (id: string) => map.get(id) ?? '—';
  }, [warehouses]);

  // Agrupa por depósito
  const grouped = useMemo(() => {
    const map = new Map<string, WmsLocation[]>();
    for (const l of locations) {
      if (!map.has(l.warehouseId)) map.set(l.warehouseId, []);
      map.get(l.warehouseId)!.push(l);
    }
    return Array.from(map.entries());
  }, [locations]);

  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<LocationType>('STORAGE');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.post('/wms/locations', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/wms/locations'] }),
  });
  const toggle = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/wms/locations/${id}/toggle`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/wms/locations'] }),
  });

  function submit() {
    if (!warehouseId) return toast.error('Selecione o depósito');
    if (!code.trim()) return toast.error('Informe o código');
    create.mutate(
      { companyId, warehouseId, code: code.trim().toUpperCase(), type, description: description || undefined },
      {
        onSuccess: () => {
          toast.success('Localização criada');
          setOpen(false);
          setCode('');
          setDescription('');
        },
        onError: () => toast.error('Erro ao criar localização'),
      },
    );
  }

  return (
    <div>
      <PageHeader
        title="Localizações WMS"
        description="Endereços de armazenagem por depósito."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Nova localização
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          O model de localização não possui <strong>capacidade máxima</strong> nem contagem de
          <strong> produtos alocados</strong> — campos previstos na issue mas inexistentes no backend.
          A edição é feita por ativar/desativar (não há endpoint de update completo).
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : grouped.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
          Nenhuma localização cadastrada.
        </p>
      ) : (
        <div className="space-y-5">
          {grouped.map(([whId, locs]) => (
            <Card key={whId}>
              <CardHeader>
                <CardTitle className="text-base">{warehouseName(whId)}</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                      <th className="py-2 text-left font-medium">Código</th>
                      <th className="py-2 text-left font-medium">Tipo</th>
                      <th className="py-2 text-left font-medium">Descrição</th>
                      <th className="py-2 text-center font-medium">Status</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {locs.map((l) => (
                      <tr key={l.id} className="border-b border-slate-50">
                        <td className="py-2 font-mono text-xs font-medium">{l.code}</td>
                        <td className="py-2">{l.type ? TYPE_LABEL[l.type] : '—'}</td>
                        <td className="py-2 text-slate-600">{l.description || '—'}</td>
                        <td className="py-2 text-center">
                          <Badge variant={l.isActive ? 'success' : 'neutral'}>{l.isActive ? 'Ativa' : 'Inativa'}</Badge>
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() =>
                              toggle.mutate(l.id, {
                                onSuccess: () => toast.success('Status alterado'),
                                onError: () => toast.error('Erro ao alterar'),
                              })
                            }
                            title={l.isActive ? 'Desativar' : 'Ativar'}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger"
                          >
                            <Power size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Nova localização"
        formId="location-form"
        loading={create.isPending}
      >
        <form
          id="location-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4 py-1"
        >
          <div>
            <Label required>Depósito</Label>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">— Selecione —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Código</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A-01-02" className="font-mono uppercase" />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={type} onChange={(e) => setType(e.target.value as LocationType)}>
                {(Object.keys(TYPE_LABEL) as LocationType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional" />
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
