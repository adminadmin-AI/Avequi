'use client';

import { useList } from '@/hooks/use-resource';
import { Select } from '@/components/ui/select';

/**
 * Chassi disponível no depósito da venda — componente ÚNICO dos dois fluxos que
 * escolhem chassi: a venda balcão (#595) e a conferência da carga (#729).
 *
 * Aceita digitação e leitor de código de barras sem tratamento especial: o
 * leitor se comporta como teclado, e o navegador seleciona a opção pelo texto
 * digitado. A lista já vem filtrada pelo servidor (em estoque, livre, do
 * produto e do depósito da venda), então o operador não consegue escolher um
 * reboque que não pode sair.
 */

export interface ChassiDisponivel {
  id: string;
  serial: string;
  chassi?: string | null;
  descricaoCor?: string | null;
}

export function ChassiSelect({
  productId,
  warehouseId,
  value,
  onChange,
  excluded,
  disabled,
}: {
  productId: string;
  warehouseId: string;
  value: string;
  onChange: (v: string) => void;
  /** Chassis já escolhidos em outras linhas da mesma venda/conferência. */
  excluded: string[];
  disabled?: boolean;
}) {
  const { data: serials = [], isLoading } = useList<ChassiDisponivel>(
    '/sales/counter-serials',
    { productId, warehouseId },
    { enabled: Boolean(productId && warehouseId) },
  );

  if (!warehouseId) {
    return <span className="text-xs text-content-muted">Selecione o depósito</span>;
  }

  const options = serials.filter((s) => s.id === value || !excluded.includes(s.id));

  return (
    <Select
      aria-label="Chassi"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || isLoading}
      className="min-w-[220px]"
    >
      <option value="">
        {isLoading
          ? 'Carregando…'
          : options.length === 0
            ? 'Sem chassi disponível'
            : 'Escanear/selecionar'}
      </option>
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.chassi ?? s.serial}
          {s.descricaoCor ? ` · ${s.descricaoCor}` : ''}
        </option>
      ))}
    </Select>
  );
}
