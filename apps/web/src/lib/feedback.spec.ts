import { describe, expect, it } from 'vitest';
import { erroDeAcao } from './feedback';

const erroCom = (status?: number, message?: unknown) => ({ response: { status, data: { message } } });

describe('erroDeAcao (#987 onda 2)', () => {
  it('sem erro (fire-and-forget) usa a fórmula padrão com a ação', () => {
    expect(erroDeAcao('salvar a resposta rápida')).toBe(
      'Não conseguimos salvar a resposta rápida. Tente de novo. Se continuar, avise o suporte.',
    );
  });

  it('mensagem apresentável do backend vence a fórmula', () => {
    expect(erroDeAcao('dar baixa no título', erroCom(400, 'Título já liquidado'))).toBe(
      'Título já liquidado',
    );
  });

  it('array do ValidationPipe vira linhas unidas', () => {
    expect(erroDeAcao('salvar', erroCom(400, ['valor obrigatório', 'data inválida']))).toBe(
      'valor obrigatório; data inválida',
    );
  });

  it('401/403 sem mensagem vira negativa de permissão (retentar não resolve)', () => {
    expect(erroDeAcao('cancelar o pedido', erroCom(403))).toBe(
      'Você não tem permissão para cancelar o pedido.',
    );
  });

  it('erro de rede sem resposta cai na fórmula padrão', () => {
    expect(erroDeAcao('mover o lead', new Error('Network Error'))).toBe(
      'Não conseguimos mover o lead. Tente de novo. Se continuar, avise o suporte.',
    );
  });
});
