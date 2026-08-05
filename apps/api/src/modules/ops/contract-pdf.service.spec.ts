import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractPdfService } from './contract-pdf.service';
import { renderClauses, TEMPLATE_VERSION } from './contract-template';

const OPERADORA = {
  id: 'op-1',
  name: 'Avecchi',
  razaoSocial: 'AVECCHI SOLUCOES EMPRESARIAIS LTDA',
  cnpj: '67846692000164',
  im: '23116509',
  email: null,
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

describe('ContractPdfService (#992)', () => {
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
  });

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

describe('contract-template (#992) — o texto amarra nos dados reais', () => {
  const params = {
    operadora: {
      razaoSocial: 'AVECCHI SOLUCOES EMPRESARIAIS LTDA',
      cnpj: '67.846.692/0001-64',
      im: '23116509',
      endereco: 'Rua Um, 100 — Centro — Sao Jose dos Pinhais/PR',
      email: null,
      cidadeForo: 'Sao Jose dos Pinhais/PR',
    },
    cliente: {
      razaoSocial: 'GDR LTDA',
      cnpj: '46.247.069/0001-15',
      endereco: null,
      email: null,
    },
    comercial: {
      mensalidadeFormatada: 'R$ 1.500,00',
      diaCobranca: 5,
      inicioVigencia: '04/08/2026',
      planoNome: null,
      propostaAceita: null,
    },
  };

  it('valor, dia de cobrança, vigência e foro entram nas cláusulas', () => {
    const texto = renderClauses(params)
      .map((c) => `${c.title} ${c.body}`)
      .join('\n');
    expect(texto).toContain('R$ 1.500,00');
    expect(texto).toContain('dia 5 de cada mês');
    expect(texto).toContain('04/08/2026');
    expect(texto).toContain('Sao Jose dos Pinhais/PR');
    // régua de inadimplência espelha a régua REAL do billing (D+3/D+10/D+20)
    expect(texto).toMatch(/3º \(terceiro\) dia/);
    expect(texto).toMatch(/10º \(décimo\) dia/);
    expect(texto).toMatch(/20\s*\(vinte\) dias/);
  });

  it('foro sem cidade cadastrada sinaliza pendência em vez de inventar', () => {
    const texto = renderClauses({
      ...params,
      operadora: { ...params.operadora, cidadeForo: null },
    })
      .map((c) => c.body)
      .join('\n');
    expect(texto).toContain('[● PREENCHER NO CADASTRO DA EMPRESA]');
  });

  it('versão do template é estável e rastreável', () => {
    expect(TEMPLATE_VERSION).toBe('AVQ-CT v1');
  });
});
