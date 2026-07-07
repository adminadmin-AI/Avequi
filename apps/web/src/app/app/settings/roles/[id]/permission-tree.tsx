'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Link2 } from 'lucide-react';
import type { IamPermissionCatalogModule } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { moduleLabel } from '../iam-labels';

/**
 * Árvore de permissões agrupada por módulo → recurso (#352).
 *
 * - Checkbox por permissão; checkbox de grupo (módulo/recurso) com estado
 *   indeterminado quando parte do grupo está marcada.
 * - Permissões HERDADAS do perfil pai aparecem marcadas e desabilitadas com
 *   indicador "herdada" (a edição acontece no perfil pai).
 * - readOnly = perfis system (fonte da verdade é o catálogo em código).
 */

function GroupCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 shrink-0 cursor-pointer rounded border-line accent-brand-600 disabled:cursor-not-allowed"
    />
  );
}

export function PermissionTree({
  catalog,
  selected,
  inherited,
  readOnly,
  onChange,
}: {
  catalog: IamPermissionCatalogModule[];
  /** codes marcados DIRETAMENTE no perfil */
  selected: Set<string>;
  /** codes herdados do perfil pai (sempre marcados, não editáveis) */
  inherited: Set<string>;
  readOnly: boolean;
  onChange: (nextSelected: Set<string>) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapsed(module: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  }

  /** Marca/desmarca um conjunto de codes (só os editáveis — herdados ficam). */
  function setCodes(codes: string[], value: boolean) {
    const next = new Set(selected);
    for (const code of codes) {
      if (inherited.has(code)) continue;
      if (value) next.add(code);
      else next.delete(code);
    }
    onChange(next);
  }

  function isOn(code: string) {
    return selected.has(code) || inherited.has(code);
  }

  return (
    <div className="space-y-3">
      {catalog.map((mod) => {
        const moduleCodes = mod.resources.flatMap((r) =>
          r.permissions.map((p) => p.code),
        );
        const onCount = moduleCodes.filter(isOn).length;
        const allOn = onCount === moduleCodes.length && moduleCodes.length > 0;
        const someOn = onCount > 0 && !allOn;
        const isCollapsed = collapsed.has(mod.module);

        return (
          <div key={mod.module} className="overflow-hidden rounded-xl border border-line bg-surface">
            {/* Cabeçalho do módulo */}
            <button
              type="button"
              onClick={() => toggleCollapsed(mod.module)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-secondary"
            >
              {isCollapsed ? (
                <ChevronRight size={16} className="shrink-0 text-content-muted" />
              ) : (
                <ChevronDown size={16} className="shrink-0 text-content-muted" />
              )}
              <GroupCheckbox
                checked={allOn}
                indeterminate={someOn}
                disabled={readOnly}
                onChange={(v) => setCodes(moduleCodes, v)}
                label={`Todas as permissões de ${moduleLabel(mod.module)}`}
              />
              <span className="flex-1 text-sm font-semibold text-content">
                {moduleLabel(mod.module)}
              </span>
              <span className="text-xs text-content-muted">
                {onCount}/{moduleCodes.length}
              </span>
            </button>

            {/* Recursos do módulo */}
            {!isCollapsed && (
              <div className="divide-y divide-line border-t border-line">
                {mod.resources.map((res) => {
                  const resCodes = res.permissions.map((p) => p.code);
                  const resOn = resCodes.filter(isOn).length;
                  const resAll = resOn === resCodes.length;
                  const resSome = resOn > 0 && !resAll;
                  // Nome do recurso: prefixo comum dos names ("Recurso — ação")
                  const resourceLabel =
                    res.permissions[0]?.name.split(' — ')[0] ?? res.resource;

                  return (
                    <div key={res.resource} className="px-4 py-3">
                      <div className="mb-2 flex items-center gap-3">
                        <GroupCheckbox
                          checked={resAll}
                          indeterminate={resSome}
                          disabled={readOnly}
                          onChange={(v) => setCodes(resCodes, v)}
                          label={`Todas as permissões de ${resourceLabel}`}
                        />
                        <span className="text-sm font-medium text-content-secondary">
                          {resourceLabel}
                        </span>
                      </div>
                      <div className="ml-7 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {res.permissions.map((p) => {
                          const isInherited = inherited.has(p.code);
                          const actionLabel = p.name.split(' — ')[1] ?? p.action;
                          return (
                            <label
                              key={p.code}
                              title={p.description ?? p.code}
                              className={cn(
                                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm',
                                'hover:bg-surface-secondary',
                                (readOnly || isInherited) && 'cursor-not-allowed opacity-80',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isOn(p.code)}
                                disabled={readOnly || isInherited}
                                onChange={(e) => setCodes([p.code], e.target.checked)}
                                className="h-4 w-4 shrink-0 rounded border-line accent-brand-600 disabled:cursor-not-allowed"
                              />
                              <span className="truncate text-content-secondary">
                                {actionLabel}
                              </span>
                              {isInherited && (
                                <Badge variant="neutral">
                                  <Link2 size={10} />
                                  herdada
                                </Badge>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
