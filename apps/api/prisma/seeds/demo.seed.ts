/**
 * Seed de DEMONSTRAÇÃO / desenvolvimento — Onda 0, higiene do seed IAM.
 *
 * Cria empresas, usuários, catálogo, BOM, roteiro, armazéns, saldos, regras
 * fiscais, categorias financeiras e centros de custo FICTÍCIOS para um banco
 * de desenvolvimento vazio. Tudo aqui é inventado: CNPJs inválidos, domínio
 * reservado `exemplo.test`, nomes "Exemplo". Nunca usa identidade de empresa
 * real: `assertDemoIdentity` rejeita e-mails dos domínios reais e
 * `assertDemoCompanyName` rejeita nomes que pareçam empresa real.
 *
 * HARD-BLOCKED em NODE_ENV=production, sem flag de override (ver seed-guard).
 * Administrador real de tenant nasce pelo convite de tenant (OPS WP2, #909),
 * nunca por seed.
 *
 * Idempotente: upserts por chave natural; blocos condicionais só criam o que
 * falta. Execução: `npm run db:seed:demo` (exige SEED_USER_PASSWORD).
 */
import { PrismaClient, UserRole, CompanyType, ProductType, UnitOfMeasure, CustomerType, TaxRegime, TaxOperationType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { assertDemoCompanyName, assertDemoIdentity } from './seed-guard';

export const DEMO_EMAIL_DOMAIN = 'exemplo.test';
export const DEMO_ADMIN_EMAIL = `admin@${DEMO_EMAIL_DOMAIN}`;
export const DEMO_MATRIZ_NAME = 'Exemplo Calçados (Matriz)';
export const DEMO_FILIAL_NAME = 'Exemplo Calçados — Loja São Paulo';

/** Usuários de demonstração: um por perfil legado relevante. */
export const DEMO_USERS: ReadonlyArray<{ name: string; email: string; role: UserRole; unit: 'matriz' | 'filial' }> = [
  { name: 'Admin Demo', email: DEMO_ADMIN_EMAIL, role: UserRole.SUPER_ADMIN, unit: 'matriz' },
  { name: 'Diretor Demo', email: `diretor@${DEMO_EMAIL_DOMAIN}`, role: UserRole.DIRECTOR, unit: 'matriz' },
  { name: 'Gerente Demo', email: `gerente@${DEMO_EMAIL_DOMAIN}`, role: UserRole.MANAGER, unit: 'matriz' },
  { name: 'Vendedor Demo', email: `loja@${DEMO_EMAIL_DOMAIN}`, role: UserRole.STORE, unit: 'filial' },
];

export interface DemoSeedOptions {
  /** Senha inicial dos usuários demo (todos nascem com mustChangePassword). */
  password: string;
}

export interface DemoSeedSummary {
  companies: number;
  users: number;
}

export async function seedDemo(prisma: PrismaClient, opts: DemoSeedOptions): Promise<DemoSeedSummary> {
  if (!opts?.password) {
    throw new Error('seedDemo: senha dos usuários demo não informada.');
  }
  assertDemoCompanyName(DEMO_MATRIZ_NAME);
  assertDemoCompanyName(DEMO_FILIAL_NAME);
  for (const u of DEMO_USERS) assertDemoIdentity(u.email);

  // Empresa matriz FICTÍCIA (CNPJ inválido de propósito)
  const matriz = await prisma.company.upsert({
    where: { cnpj: '12.345.678/0001-90' },
    update: {
      razaoSocial: 'Exemplo Calçados Indústria e Comércio Ltda',
      ie: 'ISENTO',
      crt: 3,
      taxRegime: TaxRegime.LUCRO_PRESUMIDO,
      cnae: '2930101',
      street: 'Rua Exemplo',
      number: '1500',
      complement: 'Galpão 3',
      neighborhood: 'Distrito Industrial',
      city: 'Curitiba',
      state: 'PR',
      zipCode: '80000-000',
      ibgeCode: '4106902',
      phone: '(00) 0000-0000',
      email: 'fiscal@exemplo.test',
    },
    create: {
      name: DEMO_MATRIZ_NAME,
      cnpj: '12.345.678/0001-90',
      type: CompanyType.MATRIZ,
      razaoSocial: 'Exemplo Calçados Indústria e Comércio Ltda',
      ie: 'ISENTO',
      crt: 3,
      taxRegime: TaxRegime.LUCRO_PRESUMIDO,
      cnae: '2930101',
      street: 'Rua Exemplo',
      number: '1500',
      complement: 'Galpão 3',
      neighborhood: 'Distrito Industrial',
      city: 'Curitiba',
      state: 'PR',
      zipCode: '80000-000',
      ibgeCode: '4106902',
      phone: '(00) 0000-0000',
      email: 'fiscal@exemplo.test',
    },
  });

  // Filial FICTÍCIA
  const filialSP = await prisma.company.upsert({
    where: { cnpj: '12.345.678/0002-71' },
    update: {
      razaoSocial: 'Exemplo Calçados Indústria e Comércio Ltda',
      ie: 'ISENTO',
      crt: 3,
      taxRegime: TaxRegime.LUCRO_PRESUMIDO,
      cnae: '4789099',
      street: 'Av. Paulista',
      number: '1000',
      complement: 'Loja 12',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01310-100',
      ibgeCode: '3550308',
      phone: '(00) 0000-0001',
      email: 'lojasp@exemplo.test',
    },
    create: {
      name: DEMO_FILIAL_NAME,
      cnpj: '12.345.678/0002-71',
      type: CompanyType.FILIAL,
      parentId: matriz.id,
      razaoSocial: 'Exemplo Calçados Indústria e Comércio Ltda',
      ie: 'ISENTO',
      crt: 3,
      taxRegime: TaxRegime.LUCRO_PRESUMIDO,
      cnae: '4789099',
      street: 'Av. Paulista',
      number: '1000',
      complement: 'Loja 12',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01310-100',
      ibgeCode: '3550308',
      phone: '(00) 0000-0001',
      email: 'lojasp@exemplo.test',
    },
  });

  // Usuários demo — senha vem de fora (env), nunca do código. Todos nascem com
  // mustChangePassword: a senha do seed é de bootstrap, não de uso (#345).
  const senhaDemo = await bcrypt.hash(opts.password, 10);
  const users = DEMO_USERS.map((u) => ({
    name: u.name,
    email: u.email,
    role: u.role,
    companyId: u.unit === 'matriz' ? matriz.id : filialSP.id,
  }));

  for (const u of users) {
    assertDemoIdentity(u.email);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        passwordHash: senhaDemo,
        role: u.role,
        companyId: u.companyId,
        mustChangePassword: true,
      },
    });
  }

  // Products
  const products = [
    { sku: 'CAL-001', name: 'Calçado Social Masculino 42', type: ProductType.FINISHED_GOOD, unit: UnitOfMeasure.PR, ncm: '6403.99.00', costPrice: 85.00, salePrice: 249.90, companyId: matriz.id },
    { sku: 'CAL-002', name: 'Calçado Casual Feminino 37', type: ProductType.FINISHED_GOOD, unit: UnitOfMeasure.PR, ncm: '6404.19.00', costPrice: 72.00, salePrice: 199.90, companyId: matriz.id },
    { sku: 'MP-COURO-001', name: 'Couro Bovino Natural', type: ProductType.RAW_MATERIAL, unit: UnitOfMeasure.M2, costPrice: 35.00, companyId: matriz.id },
    { sku: 'MP-SOLADO-001', name: 'Solado PVC Preto 42', type: ProductType.RAW_MATERIAL, unit: UnitOfMeasure.UN, costPrice: 12.50, companyId: matriz.id },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { companyId_sku: { companyId: p.companyId, sku: p.sku } },
      update: {},
      create: p,
    });
  }

  // Suppliers
  const suppliers = [
    { name: 'Couro Brasil Ltda', cnpj: '11.222.333/0001-44', leadTimeDays: 7, companyId: matriz.id },
    { name: 'Solados Nacionais SA', cnpj: '55.666.777/0001-88', leadTimeDays: 5, companyId: matriz.id },
  ];

  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { companyId_cnpj: { companyId: s.companyId, cnpj: s.cnpj } },
      update: {},
      create: s,
    });
  }

  // Customers
  const customers = [
    { name: 'João Silva', type: CustomerType.INDIVIDUAL, document: '123.456.789-00', email: 'joao@email.com', city: 'São Paulo', state: 'SP', companyId: filialSP.id },
    { name: 'Modas Bela Vista ME', type: CustomerType.COMPANY, document: '99.888.777/0001-11', email: 'compras@modas.com', city: 'São Paulo', state: 'SP', companyId: filialSP.id },
  ];

  for (const c of customers) {
    await prisma.customer.upsert({
      where: { companyId_document: { companyId: c.companyId, document: c.document } },
      update: {},
      create: c,
    });
  }

  // BOM for CAL-001
  const cal001 = await prisma.product.findUnique({ where: { companyId_sku: { companyId: matriz.id, sku: 'CAL-001' } } });
  const couro = await prisma.product.findUnique({ where: { companyId_sku: { companyId: matriz.id, sku: 'MP-COURO-001' } } });
  const solado = await prisma.product.findUnique({ where: { companyId_sku: { companyId: matriz.id, sku: 'MP-SOLADO-001' } } });

  if (cal001 && couro && solado) {
    const existing = await prisma.bomVersion.findFirst({ where: { productId: cal001.id, version: 1 } });
    if (!existing) {
      await prisma.bomVersion.create({
        data: {
          companyId: matriz.id,
          productId: cal001.id,
          version: 1,
          isActive: true,
          notes: 'Versão inicial',
          items: {
            create: [
              { componentId: couro.id, quantity: 0.5, scrapPct: 5, unit: 'M2' },
              { componentId: solado.id, quantity: 1, scrapPct: 2, unit: 'UN' },
            ],
          },
        },
      });
    }

    // RoutingStep for CAL-001
    const steps = [
      { productId: cal001.id, companyId: matriz.id, stepOrder: 1, name: 'Corte', workCenter: 'Corte', runTimeMin: 20 },
      { productId: cal001.id, companyId: matriz.id, stepOrder: 2, name: 'Costura', workCenter: 'Costura', runTimeMin: 45 },
      { productId: cal001.id, companyId: matriz.id, stepOrder: 3, name: 'Montagem', workCenter: 'Montagem', runTimeMin: 30 },
      { productId: cal001.id, companyId: matriz.id, stepOrder: 4, name: 'Acabamento', workCenter: 'Acabamento', runTimeMin: 15 },
    ];
    for (const step of steps) {
      const ex = await prisma.routingStep.findFirst({ where: { productId: step.productId, stepOrder: step.stepOrder } });
      if (!ex) await prisma.routingStep.create({ data: step });
    }
  }

  // Warehouses
  const almoxarifado = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId: matriz.id, code: 'ALM-01' } },
    update: {},
    create: { companyId: matriz.id, name: 'Almoxarifado Principal', code: 'ALM-01' },
  });

  await prisma.warehouse.upsert({
    where: { companyId_code: { companyId: matriz.id, code: 'EXP-01' } },
    update: {},
    create: { companyId: matriz.id, name: 'Expedição', code: 'EXP-01' },
  });

  // Initial stock balances
  const adminUser = await prisma.user.findUnique({ where: { email: DEMO_ADMIN_EMAIL } });

  if (couro && solado && adminUser) {
    await prisma.stockBalance.upsert({
      where: { warehouseId_productId: { warehouseId: almoxarifado.id, productId: couro.id } },
      update: {},
      create: { companyId: matriz.id, warehouseId: almoxarifado.id, productId: couro.id, available: 50, reserved: 0 },
    });
    await prisma.stockBalance.upsert({
      where: { warehouseId_productId: { warehouseId: almoxarifado.id, productId: solado.id } },
      update: {},
      create: { companyId: matriz.id, warehouseId: almoxarifado.id, productId: solado.id, available: 200, reserved: 0 },
    });
    const hasMovement = await prisma.stockMovement.findFirst({ where: { companyId: matriz.id } });
    if (!hasMovement) {
      await prisma.stockMovement.createMany({
        data: [
          { companyId: matriz.id, warehouseId: almoxarifado.id, productId: couro.id, type: 'ENTRY', quantity: 50, reason: 'Saldo inicial de abertura', userId: adminUser.id },
          { companyId: matriz.id, warehouseId: almoxarifado.id, productId: solado.id, type: 'ENTRY', quantity: 200, reason: 'Saldo inicial de abertura', userId: adminUser.id },
        ],
      });
    }
  }

  // Tax Rules de exemplo — Lucro Presumido (PIS 0.65%, COFINS 3% cumulativo)
  // CFOPs de indústria: 5101/6101 (produção própria), 1101/2101 (compra MP), etc.
  const taxRules = [
    // ─── Vendas (produção própria) ──────────────────────────────────────────
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERNA, cfop: '5101', icmsCst: '00', icmsAliquota: 18, ipiCst: '50', ipiAliquota: 5, pisCst: '01', pisAliquota: 0.65, cofinsCst: '01', cofinsAliquota: 3, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Venda produção própria — interna PR', priority: 0 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ufOrigem: 'PR', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 18, ipiCst: '50', ipiAliquota: 5, pisCst: '01', pisAliquota: 0.65, cofinsCst: '01', cofinsAliquota: 3, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Venda produção própria — interestadual PR→Sul/Sudeste (DIFAL 18% fallback)', priority: 0 },

    // ─── Devolução de venda ─────────────────────────────────────────────────
    { companyId: matriz.id, operationType: TaxOperationType.DEVOLUCAO_VENDA, cfop: '1202', icmsCst: '00', icmsAliquota: 18, ipiCst: '49', ipiAliquota: 5, pisCst: '01', pisAliquota: 0.65, cofinsCst: '01', cofinsAliquota: 3, description: 'Devolução de venda — interna', priority: 0 },

    // ─── Compra de matéria-prima ────────────────────────────────────────────
    { companyId: matriz.id, operationType: TaxOperationType.COMPRA_INTERNA, cfop: '1101', icmsCst: '00', icmsAliquota: 18, ipiCst: '00', ipiAliquota: 5, pisCst: '01', pisAliquota: 0.65, cofinsCst: '01', cofinsAliquota: 3, description: 'Compra matéria-prima — interna PR', priority: 0 },
    { companyId: matriz.id, operationType: TaxOperationType.COMPRA_INTERESTADUAL, ufOrigem: 'PR', cfop: '2101', icmsCst: '00', icmsAliquota: 12, ipiCst: '00', ipiAliquota: 5, pisCst: '01', pisAliquota: 0.65, cofinsCst: '01', cofinsAliquota: 3, description: 'Compra matéria-prima — interestadual', priority: 0 },

    // ─── Devolução de compra ────────────────────────────────────────────────
    { companyId: matriz.id, operationType: TaxOperationType.DEVOLUCAO_COMPRA, cfop: '5201', icmsCst: '00', icmsAliquota: 18, ipiCst: '49', ipiAliquota: 5, pisCst: '01', pisAliquota: 0.65, cofinsCst: '01', cofinsAliquota: 3, description: 'Devolução de compra — interna', priority: 0 },

    // ─── Transferência entre filiais ────────────────────────────────────────
    { companyId: matriz.id, operationType: TaxOperationType.TRANSFERENCIA_INTERNA, cfop: '5152', icmsCst: '00', icmsAliquota: 18, ipiCst: '99', ipiAliquota: 0, pisCst: '01', pisAliquota: 0.65, cofinsCst: '01', cofinsAliquota: 3, description: 'Transferência produção própria — interna', priority: 0 },
    { companyId: matriz.id, operationType: TaxOperationType.TRANSFERENCIA_INTERESTADUAL, cfop: '6152', icmsCst: '00', icmsAliquota: 12, ipiCst: '99', ipiAliquota: 0, pisCst: '01', pisAliquota: 0.65, cofinsCst: '01', cofinsAliquota: 3, description: 'Transferência produção própria — interestadual', priority: 0 },

    // ─── Remessa/retorno conserto ───────────────────────────────────────────
    { companyId: matriz.id, operationType: TaxOperationType.REMESSA_CONSERTO, cfop: '5915', icmsCst: '41', icmsAliquota: 0, ipiCst: '99', ipiAliquota: 0, pisCst: '06', pisAliquota: 0, cofinsCst: '06', cofinsAliquota: 0, description: 'Remessa para conserto — interna', priority: 0 },
    { companyId: matriz.id, operationType: TaxOperationType.RETORNO_CONSERTO, cfop: '1916', icmsCst: '41', icmsAliquota: 0, ipiCst: '99', ipiAliquota: 0, pisCst: '06', pisAliquota: 0, cofinsCst: '06', cofinsAliquota: 0, description: 'Retorno de conserto — interna', priority: 0 },

    // ─── Amostra grátis ─────────────────────────────────────────────────────
    { companyId: matriz.id, operationType: TaxOperationType.AMOSTRA_GRATIS, cfop: '5911', icmsCst: '41', icmsAliquota: 0, ipiCst: '99', ipiAliquota: 0, pisCst: '06', pisAliquota: 0, cofinsCst: '06', cofinsAliquota: 0, description: 'Amostra grátis — interna', priority: 0 },

    // ─── Bonificação ────────────────────────────────────────────────────────
    { companyId: matriz.id, operationType: TaxOperationType.BONIFICACAO, cfop: '5910', icmsCst: '00', icmsAliquota: 18, ipiCst: '99', ipiAliquota: 0, pisCst: '06', pisAliquota: 0, cofinsCst: '06', cofinsAliquota: 0, description: 'Bonificação, doação — interna', priority: 0 },

    // ─── NCM 8716.39.00 — Reboques (veículos) — prioridade 10 > genérica 0 ──
    // IPI CST 51 (alíquota zero, TIPI Decreto 11.158/2022), ICMS sem ST
    // PIS CST 49 / COFINS CST 99 alíquota zero, conforme NF-e real #14236 autorizada (#371)
    // Regra de exemplo — fundamento legal a confirmar com o contador de cada empresa
    // icmsInternaDestino = alíquota interna do UF destino (para cálculo DIFAL — EC 87/2015)
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERNA, ncm: '87163900', cfop: '5101', icmsCst: '00', icmsAliquota: 12, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — venda interna PR (ICMS 12%)', priority: 10 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'SC', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 17, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→SC (ICMS 12%, interna SC 17%)', priority: 10 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'RS', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 17, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→RS (ICMS 12%, interna RS 17%)', priority: 10 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'SP', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 18, fcpAliquotaDestino: 2, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→SP (ICMS 12%, interna SP 18%)', priority: 10 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'MG', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 18, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→MG (ICMS 12%, interna MG 18%)', priority: 10 },
    // Demais UFs principais para DIFAL
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'RJ', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 20, fcpAliquotaDestino: 2, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→RJ (ICMS 12%, interna RJ 20%)', priority: 10 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'BA', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 19, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→BA (ICMS 12%, interna BA 19%)', priority: 10 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'GO', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 17, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→GO (ICMS 12%, interna GO 17%)', priority: 10 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'MT', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 17, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→MT (ICMS 12%, interna MT 17%)', priority: 10 },
    { companyId: matriz.id, operationType: TaxOperationType.VENDA_INTERESTADUAL, ncm: '87163900', ufOrigem: 'PR', ufDestino: 'MS', cfop: '6101', icmsCst: '00', icmsAliquota: 12, icmsInternaDestino: 17, ipiCst: '51', ipiAliquota: 0, pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0, cClassTrib: '000001', cbsCst: '000', cbsAliquota: 0.9, ibsUfCst: '000', ibsUfAliquota: 0.1, ibsMunCst: '000', ibsMunAliquota: 0, description: 'Reboque NCM 8716 — PR→MS (ICMS 12%, interna MS 17%)', priority: 10 },
  ];

  for (const rule of taxRules) {
    const exists = await prisma.taxRule.findFirst({
      where: { companyId: rule.companyId, operationType: rule.operationType, cfop: rule.cfop },
    });
    if (!exists) {
      await prisma.taxRule.create({ data: rule });
    }
  }

  // ─── Categorias financeiras gerenciais ────────────────────────────────────

  const categoryGroups = [
    {
      code: 'REC', name: 'Receitas', type: 'REVENUE' as const, dreCode: '1',
      children: [
        { code: 'REC-OP', name: 'Receita Operacional', type: 'REVENUE' as const, dreCode: '1.1' },
        { code: 'REC-FIN', name: 'Receitas Financeiras', type: 'REVENUE' as const, dreCode: '1.2' },
        { code: 'REC-OUT', name: 'Outras Receitas', type: 'REVENUE' as const, dreCode: '1.3' },
      ],
    },
    {
      code: 'CPV', name: 'Custos de Produção', type: 'EXPENSE' as const, dreCode: '2',
      children: [
        { code: 'CPV-MP', name: 'Matéria-Prima', type: 'EXPENSE' as const, dreCode: '2.1' },
        { code: 'CPV-MOD', name: 'Mão de Obra Direta', type: 'EXPENSE' as const, dreCode: '2.2' },
        { code: 'CPV-CIF', name: 'Custos Indiretos Fabricação', type: 'EXPENSE' as const, dreCode: '2.3' },
      ],
    },
    {
      code: 'DESP', name: 'Despesas Operacionais', type: 'EXPENSE' as const, dreCode: '3',
      children: [
        { code: 'DESP-ADM', name: 'Despesas Administrativas', type: 'EXPENSE' as const, dreCode: '3.1' },
        { code: 'DESP-COM', name: 'Despesas Comerciais', type: 'EXPENSE' as const, dreCode: '3.2' },
        { code: 'DESP-RH', name: 'Folha de Pagamento', type: 'EXPENSE' as const, dreCode: '3.3' },
        { code: 'DESP-FIN', name: 'Despesas Financeiras', type: 'EXPENSE' as const, dreCode: '3.4' },
        { code: 'DESP-TRIB', name: 'Impostos e Taxas', type: 'EXPENSE' as const, dreCode: '3.5' },
      ],
    },
  ];

  for (const group of categoryGroups) {
    const parent = await prisma.financialCategory.upsert({
      where: { companyId_code: { companyId: matriz.id, code: group.code } },
      update: {},
      create: { companyId: matriz.id, code: group.code, name: group.name, type: group.type, dreCode: group.dreCode },
    });

    for (const child of group.children) {
      await prisma.financialCategory.upsert({
        where: { companyId_code: { companyId: matriz.id, code: child.code } },
        update: {},
        create: { companyId: matriz.id, code: child.code, name: child.name, type: child.type, dreCode: child.dreCode, parentId: parent.id },
      });
    }
  }

  // ─── Centros de custo hierárquicos — indústria de exemplo ─────────────────

  const costCenterGroups = [
    {
      code: 'FAB', name: 'Fábrica',
      children: [
        { code: 'FAB-COR', name: 'Corte' },
        { code: 'FAB-SOL', name: 'Solda' },
        { code: 'FAB-CAL', name: 'Caldeiraria' },
        { code: 'FAB-USI', name: 'Usinagem' },
        { code: 'FAB-JIT', name: 'Jateamento' },
        { code: 'FAB-PIN', name: 'Pintura' },
        { code: 'FAB-MON', name: 'Montagem' },
        { code: 'FAB-ELE', name: 'Elétrica' },
        { code: 'FAB-HID', name: 'Hidráulica' },
        { code: 'FAB-ACA', name: 'Acabamento' },
        { code: 'FAB-INS', name: 'Inspeção/Qualidade' },
        { code: 'FAB-EXP', name: 'Expedição' },
        { code: 'FAB-MNT', name: 'Manutenção' },
        { code: 'FAB-ALM', name: 'Almoxarifado' },
      ],
    },
    {
      code: 'LOJA-SP', name: 'Loja São Paulo',
      children: [],
    },
    {
      code: 'ADM', name: 'Administrativo',
      children: [
        { code: 'ADM-FIN', name: 'Financeiro' },
        { code: 'ADM-RH', name: 'RH' },
        { code: 'ADM-COM', name: 'Comercial' },
        { code: 'ADM-DIR', name: 'Diretoria' },
      ],
    },
  ];

  for (const group of costCenterGroups) {
    const parent = await prisma.costCenter.upsert({
      where: { id: `seed-cc-${group.code}` },
      update: {},
      create: { id: `seed-cc-${group.code}`, companyId: matriz.id, code: group.code, name: group.name },
    });

    for (const child of group.children) {
      await prisma.costCenter.upsert({
        where: { id: `seed-cc-${child.code}` },
        update: {},
        create: { id: `seed-cc-${child.code}`, companyId: matriz.id, code: child.code, name: child.name, parentId: parent.id },
      });
    }
  }

  console.log(`✅ Seed demo: ${DEMO_USERS.length} usuários @${DEMO_EMAIL_DOMAIN}, 2 empresas fictícias`);
  return { companies: 2, users: DEMO_USERS.length };
}
