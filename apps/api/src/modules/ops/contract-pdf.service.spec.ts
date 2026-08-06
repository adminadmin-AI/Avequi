import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractPdfService, reaisPorExtenso } from './contract-pdf.service';
import { montarDocumento, PENDENTE, TEMPLATE_VERSION } from './contract-template';
import { ContratoV2Params } from './contract-v2-tipos';

const OPERADORA = {
  id: 'op-1',
  name: 'Avecchi',
  razaoSocial: 'AVECCHI SOLUCOES EMPRESARIAIS LTDA',
  cnpj: '67846692000164',
  im: '23116509',
  email: 'claudio@avecchi.ai',
  street: 'Rua Um',
  number: '100',
  neighborhood: 'Centro',
  city: 'Sao Jose dos Pinhais',
  state: 'PR',
  zipCode: '83000-000',
  parentId: null,
};

const CLIENTE = {
  id: 'cli-1',
  name: 'GDR Reboques',
  razaoSocial: 'GDR INDUSTRIA E COMERCIO DE REBOQUES LTDA',
  cnpj: '46247069000115',
  im: null,
  email: null,
  street: 'Rua Antonio Singer',
  number: '4075',
  neighborhood: 'Campo Largo',
  city: 'Sao Jose dos Pinhais',
  state: 'PR',
  zipCode: '83091-002',
  parentId: null,
};

const SUBSCRIPTION = {
  companyId: 'cli-1',
  planId: null,
  priceCents: 150000,
  billingDay: 5,
  startedAt: new Date('2026-08-04T12:00:00Z'),
  canceledAt: null,
};

describe('ContractPdfService — AVQ-CT v2 (#992/#1025)', () => {
  let service: ContractPdfService;
  let prisma: any;

  beforeEach(async () => {
    process.env.OPERADORA_COMPANY_ID = 'op-1';
    prisma = {
      company: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(where.id === 'op-1' ? OPERADORA : where.id === 'cli-1' ? CLIENTE : null),
        ),
      },
      subscription: { findUnique: jest.fn().mockResolvedValue(SUBSCRIPTION) },
      subscriptionProposal: { findFirst: jest.fn().mockResolvedValue(null) },
      plan: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContractPdfService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ContractPdfService);
  });

  afterEach(() => {
    delete process.env.OPERADORA_COMPANY_ID;
  });

  it('gera PDF válido com filename derivado da conta', async () => {
    const { buffer, filename } = await service.generate('cli-1');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(filename).toBe('contrato-avecchi-gdr-reboques.pdf');
  }, 30000);

  it('documento completo: dezenas de páginas, sem explosão nem truncamento', async () => {
    const { buffer } = await service.generate('cli-1');
    const pages = buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    // 43 capítulos + 4 anexos: o v2 é um documento longo (referência ~30 págs).
    // < 15 = truncou; > 80 = regressão de páginas fantasma do rodapé.
    expect(pages.length).toBeGreaterThanOrEqual(15);
    expect(pages.length).toBeLessThanOrEqual(80);
  }, 30000);

  it('sem OPERADORA_COMPANY_ID → 503 fail-closed', async () => {
    delete process.env.OPERADORA_COMPANY_ID;
    await expect(service.generate('cli-1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('conta sem assinatura ativa → 400 com orientação', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    await expect(service.generate('cli-1')).rejects.toThrow(BadRequestException);
  });

  it('assinatura cancelada → 400 (contrato não se emite de conta encerrada)', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ ...SUBSCRIPTION, canceledAt: new Date() });
    await expect(service.generate('cli-1')).rejects.toThrow(BadRequestException);
  });

  it('filial não é parte — contrato só com a empresa RAIZ (404)', async () => {
    prisma.company.findUnique = jest.fn(({ where }: any) =>
      Promise.resolve(where.id === 'op-1' ? OPERADORA : { ...CLIENTE, parentId: 'cli-0' }),
    );
    await expect(service.generate('cli-1')).rejects.toThrow(NotFoundException);
  });
});

describe('montarDocumento — AVQ-CT v2 amarra nos dados reais', () => {
  const params: ContratoV2Params = {
    operadora: {
      razaoSocial: 'AVECCHI SOLUCOES EMPRESARIAIS LTDA',
      cnpj: '67.846.692/0001-64',
      im: '23116509',
      endereco: 'Rua Um, 100 — Centro — Sao Jose dos Pinhais/PR',
      email: 'claudio@avecchi.ai',
      comarca: 'Sao Jose dos Pinhais/PR',
    },
    cliente: {
      razaoSocial: 'GDR LTDA',
      cnpj: '46.247.069/0001-15',
      endereco: null,
      email: null,
    },
    comercial: {
      mensalidadeFormatada: 'R$ 1.500,00',
      mensalidadePorExtenso: 'mil e quinhentos reais',
      diaCobranca: 5,
      inicioVigencia: '04/08/2026',
      planoNome: null,
      propostaAceita: null,
    },
  };

  const textoDe = (caps: { titulo: string; blocos: any[] }[]) =>
    caps
      .map(
        (c) =>
          `${c.titulo}\n` +
          c.blocos
            .map((b: any) => (b.tipo === 'par' ? b.texto : [b.colunas, ...b.linhas].flat().join(' | ')))
            .join('\n'),
      )
      .join('\n');

  it('estrutura completa: 43 capítulos e 4 anexos', () => {
    const d = montarDocumento(params);
    expect(d.capitulos).toHaveLength(43);
    expect(d.anexos).toHaveLength(4);
    expect(d.capitulos[0].titulo).toContain('QUALIFICAÇÃO DAS PARTES');
    expect(d.capitulos[42].titulo).toContain('FORO');
  });

  it('qualificação, valores, vigência e foro entram com os dados vivos', () => {
    const d = montarDocumento(params);
    const texto = textoDe(d.capitulos);
    expect(texto).toContain('AVECCHI SOLUCOES EMPRESARIAIS LTDA');
    expect(texto).toContain('67.846.692/0001-64');
    expect(texto).toContain('23116509');
    expect(texto).toContain('Sao Jose dos Pinhais/PR');
    const anexoTexto = textoDe(d.anexos);
    expect(anexoTexto).toContain('R$ 1.500,00 (mil e quinhentos reais)');
    expect(anexoTexto).toContain('Todo dia 5 de cada mês');
    expect(anexoTexto).toContain('04/08/2026');
  });

  it('régua de cobrança contratual: 3º/10º/20º/25º/60º dia (cap. 31)', () => {
    const cap31 = montarDocumento(params).capitulos.find((c) => c.titulo.includes('INADIMPLÊNCIA'))!;
    const texto = textoDe([cap31]);
    expect(texto).toContain('3º dia de atraso');
    expect(texto).toContain('10º dia');
    expect(texto).toContain('20º dia');
    expect(texto).toContain('25º dia');
    expect(texto).toContain('60º dia');
    expect(texto).toContain('bloqueio de emissão de novos usuários');
  });

  it('cláusula 40.4 (aceite pelo Portal) presente — base do #1025', () => {
    const texto = textoDe(montarDocumento(params).capitulos);
    expect(texto).toContain('aceitação eletrônica pelo Portal Avecchi');
    expect(texto).toContain('título executivo extrajudicial');
  });

  it('Anexo IV reflete a infraestrutura REAL (correção factual autorizada)', () => {
    const anexoTexto = textoDe(montarDocumento(params).anexos);
    expect(anexoTexto).toContain('Railway');
    expect(anexoTexto).toContain('Pluggy');
    expect(anexoTexto).toContain('Anthropic');
    expect(anexoTexto).not.toContain('Cloudflare');
    expect(anexoTexto).not.toContain('OpenPix');
  });

  it('dado cadastral faltante sinaliza pendência em vez de inventar', () => {
    const semComarca = montarDocumento({
      ...params,
      operadora: { ...params.operadora, comarca: null },
      cliente: { ...params.cliente, endereco: null },
    });
    const texto = textoDe(semComarca.capitulos) + textoDe(semComarca.anexos);
    expect(texto).toContain(PENDENTE);
    expect(semComarca.localAssinatura).toBe(PENDENTE);
  });

  it('versão do template é estável e rastreável', () => {
    expect(TEMPLATE_VERSION).toBe('AVQ-CT v2');
  });
});

describe('reaisPorExtenso', () => {
  it.each([
    [150000, 'mil e quinhentos reais'],
    [100, 'um real'],
    [99, 'noventa e nove centavos'],
    [123456, 'mil e duzentos e trinta e quatro reais e cinquenta e seis centavos'],
    [10000000, 'cem mil reais'],
    [0, 'zero reais'],
  ])('%s centavos → "%s"', (cents, esperado) => {
    expect(reaisPorExtenso(cents as number)).toBe(esperado);
  });

  it('fora da faixa → null (nunca extenso errado)', () => {
    expect(reaisPorExtenso(-1)).toBeNull();
    expect(reaisPorExtenso(1.5)).toBeNull();
  });
});
