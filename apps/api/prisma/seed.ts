import { PrismaClient, UserRole, CompanyType } from '@prisma/client';
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

  console.log('✅ Seed concluído');
}

main().catch(console.error).finally(() => prisma.$disconnect());
