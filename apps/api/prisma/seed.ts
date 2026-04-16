import { PrismaClient, UserRole, CompanyType, ProductType, UnitOfMeasure, CustomerType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Create GDR Matriz
  const matriz = await prisma.company.upsert({
    where: { cnpj: '12.345.678/0001-90' },
    update: {},
    create: { name: 'GDR Matriz', cnpj: '12.345.678/0001-90', type: CompanyType.MATRIZ },
  });

  // Create Filial SP
  const filialSP = await prisma.company.upsert({
    where: { cnpj: '12.345.678/0002-71' },
    update: {},
    create: { name: 'GDR Loja São Paulo', cnpj: '12.345.678/0002-71', type: CompanyType.FILIAL, parentId: matriz.id },
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

  console.log('✅ Seed concluído');
}

main().catch(console.error).finally(() => prisma.$disconnect());
