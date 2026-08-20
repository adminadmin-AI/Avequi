/**
 * Cadastro inicial da USINAGEM J A LTDA no ERP (épico #1068).
 *
 * Autorizado pelo Claudio em 13/08/2026. Escreve em PRODUÇÃO.
 *
 * Idempotente: cada passo confere antes de criar e não duplica. Rodar duas
 * vezes não faz estrago — a 2ª execução reporta tudo como "já existe".
 *
 * DRY_RUN=1 mostra o que faria sem escrever nada.
 *
 * Uso: DRY_RUN=1 npx tsx apps/api/scripts/cadastro-usinagem-ja.ts
 */

import { PrismaClient, TenantStatus, TaxRegime, CompanyType, CustomerType, ProductType, UnitOfMeasure, IcmsIndicator } from '@prisma/client';
import { buildInitialTaxRules } from '../src/modules/tax/tax-rule-seed';

const prisma = new PrismaClient();
const DRY = process.env.DRY_RUN === '1';
const log = (icon: string, msg: string) => console.log(`${icon} ${msg}`);

const CNPJ_USIJA = '62484006000139';
const CNPJ_CRD = '30284708000182';

(async () => {
  console.log(`\n╔══ Cadastro USINAGEM J A ${DRY ? '— DRY RUN (nada será escrito)' : '— ESCRITA REAL'} ══╗\n`);

  // ── 1. Tenant ────────────────────────────────────────────────────────────
  let company = await prisma.company.findUnique({ where: { cnpj: CNPJ_USIJA } });
  if (company) {
    log('↷', `Company já existe: ${company.name} (${company.id})`);
  } else if (DRY) {
    log('+', 'Company USINAGEM J A LTDA seria criada (tenant raiz, TRIAL, CRT=1)');
  } else {
    company = await prisma.company.create({
      data: {
        name: 'Usinagem J A',
        razaoSocial: 'USINAGEM J A LTDA',
        cnpj: CNPJ_USIJA,
        type: CompanyType.MATRIZ,
        ie: '9124135785',
        crt: 1,
        taxRegime: TaxRegime.SIMPLES_NACIONAL,
        cnae: '2539001',
        street: 'RUA NESTOR NEGOSEKE',
        number: '110',
        neighborhood: 'CAMPINA DOS FURTADOS',
        city: 'SAO JOSE DOS PINHAIS',
        state: 'PR',
        zipCode: '83161000',
        ibgeCode: '4125506',
        phone: '4199623775',
        email: 's.rosangella@yahoo.com.br',
        tenantStatus: TenantStatus.TRIAL,
      },
    });
    log('✅', `Company criada: ${company.id}`);
  }

  const companyId = company?.id;
  if (!companyId) {
    log('⏹', 'Sem companyId (dry run) — demais passos apenas descritos.\n');
  }

  // ── 2. Regras fiscais semeadas (inativas, #1071) ─────────────────────────
  // Dependem da migration 20260812150000_tax_rule_csosn_simples, que pode ainda
  // não estar aplicada em prod (o código está na main, mas o deploy do #1061
  // não rodou). Falhar aqui não pode abortar produto e cliente.
  try {
  if (companyId) {
    const existentes = await prisma.taxRule.count({ where: { companyId } });
    if (existentes > 0) {
      log('↷', `TaxRules já existem: ${existentes}`);
    } else {
      const rules = buildInitialTaxRules(companyId, 1);
      if (DRY) log('+', `${rules.length} TaxRules INATIVAS seriam semeadas`);
      else {
        await prisma.taxRule.createMany({ data: rules });
        log('✅', `${rules.length} TaxRules semeadas (INATIVAS — contador revisa e ativa)`);
      }
    }

    // A regra da operação real (venda da ponta de eixo para a CRD).
    //
    // CSOSN 102 — SEM repasse de crédito, definido pela contadora em 19/08.
    // O 101 exigiria pCredSN, e nenhum número inventado pode ir para o XML:
    // o crédito destacado é escriturado pelo destinatário, então errar para
    // mais vira crédito indevido tomado pela CRD. Com 102 não existe campo,
    // não existe número, não existe risco.
    //
    // Segue INATIVA — quem ativa é quem confere.
    const vendaInterna = await prisma.taxRule.findFirst({
      where: { companyId, operationType: 'VENDA_INTERNA' },
    });
    if (vendaInterna && !DRY) {
      await prisma.taxRule.update({
        where: { id: vendaInterna.id },
        data: {
          icmsCsosn: '102',
          pCredSN: null,
          description: 'Venda de produção própria — dentro do estado (contadora 19/08: CSOSN 102, sem crédito)',
        },
      });
      log('✅', 'VENDA_INTERNA em CSOSN 102 (sem crédito) — segue INATIVA');
    } else if (vendaInterna) {
      log('+', 'VENDA_INTERNA seria ajustada para CSOSN 102 (inativa)');
    }
  }
  } catch (e: any) {
    if (/icmsCsosn|pCredSN/.test(e.message)) {
      log('⚠️', 'Regras fiscais PULADAS — a migration do CSOSN não está aplicada em produção.');
      log('  ', 'Rodar a DDL aditiva (20260812150000_tax_rule_csosn_simples) e reexecutar este script.');
    } else throw e;
  }

  // ── 3. Produto ───────────────────────────────────────────────────────────
  if (companyId) {
    const sku = 'PONTA-EIXO';
    const prod = await prisma.product.findUnique({ where: { companyId_sku: { companyId, sku } } });
    if (prod) log('↷', `Produto já existe: ${prod.sku} (${prod.id})`);
    else if (DRY) log('+', 'Produto PONTA DE EIXO seria criado (NCM 87169090, CEST 0112700, UN, R$ 17,00)');
    else {
      const p = await prisma.product.create({
        data: {
          companyId,
          sku,
          name: 'PONTA DE EIXO',
          type: ProductType.FINISHED_GOOD, // ela compra o material e entrega pronta
          unit: UnitOfMeasure.UN,
          ncm: '87169090',
          cest: '0112700',
          origem: '0', // nacional
          salePrice: 17.0,
          isActive: true,
        },
      });
      log('✅', `Produto criado: ${p.id}`);
    }
  }

  // ── 4. CRD como cliente dela ─────────────────────────────────────────────
  if (companyId) {
    const cli = await prisma.customer.findFirst({ where: { companyId, document: CNPJ_CRD } });
    if (cli) log('↷', `Cliente CRD já existe: ${cli.id}`);
    else if (DRY) log('+', 'Cliente CRD seria criado (PJ contribuinte, IE 9078144677)');
    else {
      const c = await prisma.customer.create({
        data: {
          companyId,
          type: CustomerType.COMPANY,
          name: 'CRD Reboques',
          razaoSocial: 'CRD INDUSTRIA E COMERCIO DE REBOQUES LTDA',
          document: CNPJ_CRD,
          ie: '9078144677',
          // Contribuinte: é o que torna o CSOSN 101 válido (rej. 600 se for 9)
          indIeDest: IcmsIndicator.CONTRIBUINTE,
          isSimplesNacional: false, // CRT=3, regime normal
          address: 'RUA ANTONIO SINGER',
          number: '4075',
          neighborhood: 'CAMPO LARGO DA ROSEIRA',
          city: 'SAO JOSE DOS PINHAIS',
          state: 'PR',
          zipCode: '83091002',
          ibgeCode: '4125506',
          phone: '4131463478',
          defaultPaymentTerms: '7/14/21/28', // 4x de 7 em 7 dias
        },
      });
      log('✅', `Cliente CRD criado: ${c.id}`);
    }
  }

  console.log('\n╚══ fim ══╝\n');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('❌', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
