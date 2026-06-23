import { PrismaClient, UserRole, CompanyType, ProductType, UnitOfMeasure, CustomerType, TaxRegime } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Create GDR Matriz — dados fiscais reais
  const matriz = await prisma.company.upsert({
    where: { cnpj: '12.345.678/0001-90' },
    update: {
      razaoSocial: 'GDR Reboques Indústria e Comércio Ltda',
      ie: 'ISENTO',
      crt: 3,
      taxRegime: TaxRegime.LUCRO_PRESUMIDO,
      cnae: '2930101',
      street: 'Rua das Indústrias',
      number: '1500',
      complement: 'Galpão 3',
      neighborhood: 'Distrito Industrial',
      city: 'Cascavel',
      state: 'PR',
      zipCode: '85807-030',
      ibgeCode: '4104808',
      phone: '(45) 3222-1234',
      email: 'fiscal@gdr.com.br',
    },
    create: {
      name: 'GDR Matriz',
      cnpj: '12.345.678/0001-90',
      type: CompanyType.MATRIZ,
      razaoSocial: 'GDR Reboques Indústria e Comércio Ltda',
      ie: 'ISENTO',
      crt: 3,
      taxRegime: TaxRegime.LUCRO_PRESUMIDO,
      cnae: '2930101',
      street: 'Rua das Indústrias',
      number: '1500',
      complement: 'Galpão 3',
      neighborhood: 'Distrito Industrial',
      city: 'Cascavel',
      state: 'PR',
      zipCode: '85807-030',
      ibgeCode: '4104808',
      phone: '(45) 3222-1234',
      email: 'fiscal@gdr.com.br',
    },
  });

  // Create Filial SP — dados fiscais reais
  const filialSP = await prisma.company.upsert({
    where: { cnpj: '12.345.678/0002-71' },
    update: {
      razaoSocial: 'GDR Reboques Indústria e Comércio Ltda',
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
      phone: '(11) 3333-4444',
      email: 'lojasp@gdr.com.br',
    },
    create: {
      name: 'GDR Loja São Paulo',
      cnpj: '12.345.678/0002-71',
      type: CompanyType.FILIAL,
      parentId: matriz.id,
      razaoSocial: 'GDR Reboques Indústria e Comércio Ltda',
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
      phone: '(11) 3333-4444',
      email: 'lojasp@gdr.com.br',
    },
  });

  // Create users
  const users = [
    { name: 'Super Admin', email: 'admin@gdr.com.br', password: 'admin123', role: UserRole.SUPER_ADMIN, companyId: matriz.id },
    { name: 'Diretor GDR', email: 'diretor@gdr.com.br', password: 'diretor123', role: UserRole.DIRECTOR, companyId: matriz.id },
    { name: 'Gerente Produção', email: 'gerente@gdr.com.br', password: 'gerente123', role: UserRole.MANAGER, companyId: matriz.id },
    { name: 'Vendedor SP', email: 'loja@gdr.com.br', password: 'loja123', role: UserRole.STORE, companyId: filialSP.id },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, passwordHash: await bcrypt.hash(u.password, 10), role: u.role, companyId: u.companyId },
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
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@gdr.com.br' } });

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

  console.log('✅ Seed concluído');
}

main().catch(console.error).finally(() => prisma.$disconnect());
