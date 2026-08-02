import { describe, expect, it } from 'vitest';
import { ehNegativaDeAcesso, mensagemDoErro } from './api-error';

describe('ehNegativaDeAcesso', () => {
  it('403 e 401 são negativas — retentar só repetiria a recusa', () => {
    expect(ehNegativaDeAcesso({ response: { status: 403 } })).toBe(true);
    expect(ehNegativaDeAcesso({ response: { status: 401 } })).toBe(true);
  });

  it('falha de infraestrutura NÃO é negativa (merece retry)', () => {
    expect(ehNegativaDeAcesso({ response: { status: 500 } })).toBe(false);
    expect(ehNegativaDeAcesso({ response: { status: 503 } })).toBe(false);
  });

  it('erro sem resposta (rede fora, timeout) não é negativa', () => {
    expect(ehNegativaDeAcesso(new Error('Network Error'))).toBe(false);
    expect(ehNegativaDeAcesso(undefined)).toBe(false);
    expect(ehNegativaDeAcesso(null)).toBe(false);
  });
});

describe('mensagemDoErro', () => {
  it('usa a mensagem do backend quando existe', () => {
    expect(mensagemDoErro({ response: { data: { message: 'Permissão negada' } } })).toBe(
      'Permissão negada',
    );
  });

  it('junta a lista do ValidationPipe', () => {
    expect(
      mensagemDoErro({ response: { data: { message: ['campo A inválido', 'campo B inválido'] } } }),
    ).toBe('campo A inválido; campo B inválido');
  });

  it('devolve undefined quando não há nada apresentável', () => {
    expect(mensagemDoErro({ response: { data: { message: '   ' } } })).toBeUndefined();
    expect(mensagemDoErro({ response: { data: { message: [] } } })).toBeUndefined();
    expect(mensagemDoErro({ response: { data: { message: { erro: 'x' } } } })).toBeUndefined();
    expect(mensagemDoErro({})).toBeUndefined();
    expect(mensagemDoErro(undefined)).toBeUndefined();
  });
});
