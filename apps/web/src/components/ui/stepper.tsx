'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Stepper — F3.1 (#316)
 *
 * Indicador de etapas para wizards: círculos numerados + rótulos + linha de
 * progresso. Etapas concluídas ganham check e são clicáveis para voltar
 * (avançar só via botão Próximo, com validação por step na página).
 *
 * Também serve como progress indicator dentro de FormDialog multi-step
 * (herdado da #311).
 */

export interface Step {
  id: string;
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: Step[];
  /** índice da etapa atual (0-based) */
  current: number;
  /** permite voltar clicando numa etapa concluída */
  onStepClick?: (index: number) => void;
  className?: string;
}

export function Stepper({ steps, current, onStepClick, className }: StepperProps) {
  return (
    <ol className={cn('flex items-start', className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = done && !!onStepClick;
        return (
          <li key={step.id} className={cn('flex items-start', i > 0 && 'flex-1')}>
            {/* linha conectora */}
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  'mx-2 mt-4 h-0.5 flex-1 rounded-full transition-colors duration-flow',
                  done || active ? 'bg-brand-600 dark:bg-brand-500' : 'bg-line',
                )}
              />
            )}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick(i)}
              className={cn(
                'group flex shrink-0 flex-col items-center gap-1.5 text-center',
                clickable && 'cursor-pointer',
                !clickable && 'cursor-default',
              )}
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors duration-fast',
                  done &&
                    'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500',
                  active &&
                    'border-brand-600 bg-surface text-brand-600 dark:border-brand-400 dark:text-brand-400',
                  !done && !active && 'border-line bg-surface text-content-muted',
                  clickable && 'group-hover:brightness-110',
                )}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'max-w-[120px] text-caption font-medium',
                  active ? 'text-content' : 'text-content-muted',
                )}
              >
                {step.label}
              </span>
              {step.description && (
                <span className="max-w-[140px] text-helper text-content-muted">
                  {step.description}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
