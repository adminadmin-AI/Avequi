import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(headers: Record<string, string> = {}) {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const request = {
    method: 'GET',
    url: '/api/test',
    headers,
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('db error', {
    code,
    clientVersion: '5.0.0',
    meta,
  });
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // silencia o log de erro no output dos testes
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserva status e mensagem de HttpException', () => {
    const { host, response } = makeHost();

    filter.catch(new NotFoundException('Produto nao encontrado'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Produto nao encontrado',
        path: '/api/test',
      }),
    );
  });

  it('junta mensagens de validacao (array) em uma string', () => {
    const { host, response } = makeHost();

    filter.catch(
      new BadRequestException(['name obrigatorio', 'email invalido']),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'name obrigatorio; email invalido',
      }),
    );
  });

  it('erro generico vira 500 com mensagem sanitizada, sem stack no body', () => {
    const { host, response } = makeHost();

    filter.catch(new Error('segredo interno: conexao com senha xyz'), host);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    const body = response.json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    // nada do erro original ou da stack pode vazar no body
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('segredo interno');
    expect(serialized).not.toContain('at '); // frames de stack
    expect(body.stack).toBeUndefined();
  });

  it('Prisma P2002 (unique) vira 409 com campos do conflito', () => {
    const { host, response } = makeHost();

    filter.catch(prismaError('P2002', { target: ['email'] }), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Unique constraint violation on: email',
      }),
    );
  });

  it('Prisma P2025 (not found) vira 404', () => {
    const { host, response } = makeHost();

    filter.catch(prismaError('P2025'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Record not found' }),
    );
  });

  it('Prisma P2003 (FK) vira 400', () => {
    const { host, response } = makeHost();

    filter.catch(prismaError('P2003'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Foreign key constraint violation',
      }),
    );
  });

  it('Prisma com codigo desconhecido vira 500 sanitizado', () => {
    const { host, response } = makeHost();

    filter.catch(prismaError('P9999'), host);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Internal server error' }),
    );
  });

  it('reaproveita o x-request-id do request quando presente', () => {
    const { host, response } = makeHost({ 'x-request-id': 'req-abc-123' });

    filter.catch(new Error('boom'), host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-abc-123' }),
    );
  });

  it('gera requestId (uuid) quando o header esta ausente', () => {
    const { host, response } = makeHost();

    filter.catch(new Error('boom'), host);

    const body = response.json.mock.calls[0][0];
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
