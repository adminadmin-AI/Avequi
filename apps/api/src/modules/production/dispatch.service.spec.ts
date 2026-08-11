/**
 * #817 — Testes do despacho por setor.
 *
 * Estes testes usam o `BomExplosionService` **de verdade** (#980), não um dublê.
 * A razão é deliberada: o valor desta issue está justamente em consumir o ledger
 * de arestas corretamente. Um mock do serviço de explosão provaria apenas que o
 * `DispatchService` sabe ler um objeto que o próprio teste inventou.
 *
 * O que é mockado é só o `PrismaService` — e o mock expõe **exclusivamente
 * métodos de leitura** (`findMany`), de modo que qualquer escrita acidental
 * introduzida no futuro quebra o teste com "is not a function" em vez de passar
 * despercebida.
 *
 * ─── A fábrica de mentira usada aqui ────────────────────────────────────────
 *
 *   MOD-CAR-003 (acabado)              roteiro: 1 Pré-montagem  @ SET-MON-001
 *   │                                           2 Montagem final @ SET-MON-001
 *   ├── CON-CHA-003 ×1   (alocado ao passo 2)
 *   │   │                              roteiro: 1 Solda         @ SET-SOL-002
 *   │   │                                       2 Galvanização  @ SET-GAL-001
 *   │   ├── PC-LONG   ×2 (alocado ao passo 1 da Solda)
 *   │   └── PC-PARAF  ×4 (SEM alocação → pendência)
 *   └── PC-PARAF ×20 +10% de refugo (alocado ao passo 1)
 *
 * Carrinho: 10 × MOD-CAR-003.
 */

import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BomExplosionService } from '../../common/production/bom-explosion.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DispatchService } from './dispatch.service';
import { DispatchOperation, DispatchResult } from './dispatch.types';
import { ProductionController } from './production.controller';
import {
  DispatchCartEchoDto,
  DispatchCollectItemDto,
  DispatchOsDto,
  DispatchPendencyDto,
  DispatchResponseDto,
} from './dto/dispatch-response.dto';

const EMPRESA = 'c1';

interface ProdutoFake {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  unit: string;
  type: string;
}
interface PassoFake {
  id: string;
  companyId: string;
  productId: string;
  stepOrder: number;
  name: string;
  workCenterId: string | null;
  workCenterRef: { id: string; code: string; name: string } | null;
}
interface BomFake {
  id: string;
  companyId: string;
  productId: string;
  version: number;
  isActive: boolean;
  items: {
    id: string;
    componentId: string;
    quantity: string;
    scrapPct: string;
    routingStepId: string | null;
    unit: string | null;
  }[];
}

const WC = {
  sol: { id: 'wc-sol', code: 'SET-SOL-002', name: 'Solda 2' },
  gal: { id: 'wc-gal', code: 'SET-GAL-001', name: 'Galvanização' },
  mon: { id: 'wc-mon', code: 'SET-MON-001', name: 'Montagem' },
};

function produtosBase(): ProdutoFake[] {
  return [
    { id: 'p-mod', companyId: EMPRESA, sku: 'MOD-CAR-003', name: 'Carretinha 3', unit: 'UN', type: 'FINISHED_GOOD' },
    { id: 'p-con', companyId: EMPRESA, sku: 'CON-CHA-003', name: 'Conjunto chassi 3', unit: 'UN', type: 'SEMI_FINISHED' },
    { id: 'p-long', companyId: EMPRESA, sku: 'PC-LONG', name: 'Longarina', unit: 'UN', type: 'COMPONENT' },
    { id: 'p-paraf', companyId: EMPRESA, sku: 'PC-PARAF', name: 'Parafuso M8', unit: 'UN', type: 'RAW_MATERIAL' },
  ];
}

function passosBase(): PassoFake[] {
  return [
    { id: 'rs-mod-1', companyId: EMPRESA, productId: 'p-mod', stepOrder: 1, name: 'Pré-montagem', workCenterId: WC.mon.id, workCenterRef: WC.mon },
    { id: 'rs-mod-2', companyId: EMPRESA, productId: 'p-mod', stepOrder: 2, name: 'Montagem final', workCenterId: WC.mon.id, workCenterRef: WC.mon },
    { id: 'rs-con-1', companyId: EMPRESA, productId: 'p-con', stepOrder: 1, name: 'Solda', workCenterId: WC.sol.id, workCenterRef: WC.sol },
    { id: 'rs-con-2', companyId: EMPRESA, productId: 'p-con', stepOrder: 2, name: 'Galvanização', workCenterId: WC.gal.id, workCenterRef: WC.gal },
  ];
}

function bomsBase(): BomFake[] {
  return [
    {
      id: 'bv-mod',
      companyId: EMPRESA,
      productId: 'p-mod',
      version: 1,
      isActive: true,
      items: [
        { id: 'bi-1', componentId: 'p-con', quantity: '1', scrapPct: '0', routingStepId: 'rs-mod-2', unit: 'UN' },
        { id: 'bi-2', componentId: 'p-paraf', quantity: '20', scrapPct: '10', routingStepId: 'rs-mod-1', unit: 'UN' },
      ],
    },
    {
      id: 'bv-con',
      companyId: EMPRESA,
      productId: 'p-con',
      version: 1,
      isActive: true,
      items: [
        { id: 'bi-3', componentId: 'p-long', quantity: '2', scrapPct: '0', routingStepId: 'rs-con-1', unit: 'UN' },
        // Sem routingStepId de propósito: vira UNALLOCATED_COMPONENT.
        { id: 'bi-4', componentId: 'p-paraf', quantity: '4', scrapPct: '0', routingStepId: null, unit: 'UN' },
      ],
    },
  ];
}

interface CentroFake {
  id: string;
  companyId: string;
  code: string;
  name: string;
  supplyMarket: { id: string; code: string; name: string } | null;
}

interface Cenario {
  produtos?: ProdutoFake[];
  passos?: PassoFake[];
  boms?: BomFake[];
  centros?: CentroFake[];
}

/** Mock de Prisma SOMENTE LEITURA — só existe `findMany`. */
function prismaFake(cenario: Cenario = {}) {
  const produtos = cenario.produtos ?? produtosBase();
  const passos = cenario.passos ?? passosBase();
  const boms = cenario.boms ?? bomsBase();
  // Sem mercado configurado por padrão: os testes pré-#1058 seguem valendo
  // (market: null em toda OC, markets: []).
  const centros =
    cenario.centros ??
    Object.values(WC).map((wc) => ({
      id: wc.id,
      companyId: EMPRESA,
      code: wc.code,
      name: wc.name,
      supplyMarket: null as CentroFake['supplyMarket'],
    }));

  const idsDe = (where: any): string[] | null => where?.id?.in ?? null;

  return {
    product: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids = idsDe(where);
        return produtos.filter(
          (p) => p.companyId === where.companyId && (ids === null || ids.includes(p.id)),
        );
      }),
    },
    routingStep: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] | null = where?.productId?.in ?? null;
        return passos
          .filter(
            (s) => s.companyId === where.companyId && (ids === null || ids.includes(s.productId)),
          )
          .sort((a, b) => a.productId.localeCompare(b.productId) || a.stepOrder - b.stepOrder);
      }),
    },
    workCenter: {
      findMany: jest.fn(async ({ where }: any) =>
        centros.filter((c) => c.companyId === where.companyId),
      ),
    },
    bomVersion: {
      findMany: jest.fn(async ({ where }: any) =>
        boms
          .filter((b) => b.companyId === where.companyId && b.isActive === where.isActive)
          .sort(
            (a, b) =>
              a.productId.localeCompare(b.productId) ||
              b.version - a.version ||
              a.id.localeCompare(b.id),
          ),
      ),
    },
  };
}

async function montar(cenario: Cenario = {}) {
  const prisma = prismaFake(cenario);
  const mod = await Test.createTestingModule({
    providers: [DispatchService, BomExplosionService, { provide: PrismaService, useValue: prisma }],
  }).compile();

  return { service: mod.get(DispatchService), prisma };
}

const CARRINHO = { items: [{ productId: 'p-mod', quantity: 10 }] };

/** Acha a operação de um produto num centro de trabalho. */
function operacao(res: DispatchResult, code: string, sku: string, stepOrder: number): DispatchOperation {
  const wc = res.workCenters.find((w) => w.code === code);
  if (!wc) throw new Error(`centro de trabalho ${code} não veio na resposta`);
  const op = wc.operations.find((o) => o.os.sku === sku && o.stepOrder === stepOrder);
  if (!op) throw new Error(`operação ${sku}/${stepOrder} não veio em ${code}`);
  return op;
}

describe('DispatchService (#817) — despacho por setor', () => {
  describe('cenário completo da fábrica', () => {
    let res: DispatchResult;

    beforeAll(async () => {
      const { service } = await montar();
      res = await service.dispatch(EMPRESA, CARRINHO);
    });

    it('devolve o carrinho resolvido para SKU e nome', () => {
      expect(res.cart).toEqual([
        { productId: 'p-mod', sku: 'MOD-CAR-003', name: 'Carretinha 3', unit: 'UN', quantity: '10' },
      ]);
    });

    it('agrupa por centro de trabalho, ordenado por código', () => {
      expect(res.workCenters.map((w) => w.code)).toEqual([
        'SET-GAL-001',
        'SET-MON-001',
        'SET-SOL-002',
      ]);
    });

    // ── Critério 1: BOM multinível ────────────────────────────────────────
    it('explode a BOM multinível: o conjunto de nível 2 vira OS na Solda', () => {
      const op = operacao(res, 'SET-SOL-002', 'CON-CHA-003', 1);
      expect(op.os.quantity).toBe('10');
      expect(op.stepName).toBe('Solda');
    });

    // ── Critério 2: scrapPct por nível, Decimal preservado ────────────────
    it('aplica scrapPct no nível certo: 10 × 20 × 1,10 = 220 exatos', () => {
      const op = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 1);
      const paraf = op.oc.find((i) => i.sku === 'PC-PARAF');
      expect(paraf?.quantity).toBe('220');
    });

    // ── Critério 3: O ITEM VINDO DA OPERAÇÃO ANTERIOR ─────────────────────
    // É o caso que motivou a correção de escopo da issue. Sem ele a OC da
    // Galvanização sairia vazia, porque um conjunto não é componente de si mesmo.
    it('a OC da Galvanização recebe o PRÓPRIO conjunto vindo da Solda', () => {
      const galva = operacao(res, 'SET-GAL-001', 'CON-CHA-003', 2);

      expect(galva.isFirstStep).toBe(false);
      expect(galva.oc).toHaveLength(1);
      expect(galva.oc[0]).toMatchObject({
        sku: 'CON-CHA-003',
        quantity: '10',
        originKind: 'PREVIOUS_OPERATION',
        sourceType: 'WORK_CENTER',
        fromWorkCenter: { code: 'SET-SOL-002' },
        fromRoutingStepId: 'rs-con-1',
        // A passagem entre operações NÃO nasce de linha de BOM.
        bomItemIds: [],
      });
    });

    it('a primeira operação de um roteiro não recebe item de operação anterior', () => {
      const solda = operacao(res, 'SET-SOL-002', 'CON-CHA-003', 1);
      expect(solda.isFirstStep).toBe(true);
      expect(solda.oc.every((i) => i.originKind === 'BOM_COMPONENT')).toBe(true);
    });

    // ── Critério 4: componentes alocados por BomItem.routingStepId ────────
    it('coloca cada componente na operação a que foi alocado, e não em outra', () => {
      const preMontagem = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 1);
      const montagemFinal = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 2);

      // bi-2 (parafuso) → passo 1; bi-1 (conjunto) → passo 2.
      expect(preMontagem.oc.map((i) => i.sku)).toEqual(['PC-PARAF']);
      expect(preMontagem.oc[0].bomItemIds).toEqual(['bi-2']);

      const doBom = montagemFinal.oc.filter((i) => i.originKind === 'BOM_COMPONENT');
      expect(doBom.map((i) => i.sku)).toEqual(['CON-CHA-003']);
      expect(doBom[0].bomItemIds).toEqual(['bi-1']);
    });

    // ── Critério 5: as três origens ───────────────────────────────────────
    it('classifica origem WORK_CENTER para componente fabricado (última operação do roteiro dele)', () => {
      const montagemFinal = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 2);
      const conjunto = montagemFinal.oc.find((i) => i.originKind === 'BOM_COMPONENT');

      // O conjunto fica pronto na ÚLTIMA operação do próprio roteiro — a
      // Galvanização —, não na primeira.
      expect(conjunto).toMatchObject({
        sourceType: 'WORK_CENTER',
        fromWorkCenter: { code: 'SET-GAL-001' },
        fromRoutingStepId: 'rs-con-2',
      });
    });

    it('classifica origem EXTERNAL_OR_STOCK para componente sem roteiro (comprado)', () => {
      const solda = operacao(res, 'SET-SOL-002', 'CON-CHA-003', 1);
      expect(solda.oc[0]).toMatchObject({
        sku: 'PC-LONG',
        quantity: '20',
        sourceType: 'EXTERNAL_OR_STOCK',
        fromWorkCenter: null,
        fromRoutingStepId: null,
      });
    });

    // ── Critério 6: nada some em silêncio ─────────────────────────────────
    it('BomItem sem routingStepId vira pendência UNALLOCATED_COMPONENT com quantidade', () => {
      const pend = res.pendencies.filter((p) => p.code === 'UNALLOCATED_COMPONENT');
      expect(pend).toHaveLength(1);
      expect(pend[0]).toMatchObject({ sku: 'PC-PARAF', quantity: '40' });
      expect(pend[0].detail).toContain('CON-CHA-003');
    });

    it('o parafuso não alocado NÃO aparece em nenhuma OC da Solda', () => {
      const solda = operacao(res, 'SET-SOL-002', 'CON-CHA-003', 1);
      expect(solda.oc.some((i) => i.sku === 'PC-PARAF')).toBe(false);
    });

    it('não inventa inconsistência quando a estrutura está sã', () => {
      expect(res.inconsistencies).toEqual([]);
    });
  });

  // ── Critério 10: NENHUMA escrita ─────────────────────────────────────────
  describe('somente leitura', () => {
    it('não chama nada além de findMany (o mock só expõe leitura)', async () => {
      const { service, prisma } = await montar();
      await service.dispatch(EMPRESA, CARRINHO);

      expect(prisma.product.findMany).toHaveBeenCalled();
      expect(prisma.routingStep.findMany).toHaveBeenCalled();
      expect(prisma.bomVersion.findMany).toHaveBeenCalled();
      // Nem MrpRun, nem Ordem de Produção, nem AuditLog de escrita.
      expect(Object.keys(prisma)).toEqual(['product', 'routingStep', 'workCenter', 'bomVersion']);
      for (const modelo of Object.values(prisma)) {
        expect(Object.keys(modelo)).toEqual(['findMany']);
      }
    });

    it('todas as consultas são escopadas pelo companyId recebido', async () => {
      const { service, prisma } = await montar();
      await service.dispatch(EMPRESA, CARRINHO);

      for (const modelo of Object.values(prisma)) {
        for (const chamada of modelo.findMany.mock.calls) {
          expect(chamada[0].where.companyId).toBe(EMPRESA);
        }
      }
    });
  });

  // ── Critério 7: multi-tenancy ────────────────────────────────────────────
  describe('isolamento entre empresas', () => {
    it('recusa produto que não é da empresa do JWT', async () => {
      const { service } = await montar();
      await expect(
        service.dispatch(EMPRESA, { items: [{ productId: 'p-de-outra-empresa', quantity: 1 }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a mensagem diz qual produto não foi encontrado', async () => {
      const { service } = await montar();
      await expect(
        service.dispatch(EMPRESA, { items: [{ productId: 'p-fantasma', quantity: 1 }] }),
      ).rejects.toThrow(/p-fantasma/);
    });

    it('não devolve dado de outra empresa quando o mesmo id existe nas duas', async () => {
      const { service } = await montar({
        produtos: [
          ...produtosBase(),
          { id: 'p-mod', companyId: 'c2', sku: 'OUTRA', name: 'Outra', unit: 'UN', type: 'FINISHED_GOOD' },
        ],
      });
      const res = await service.dispatch(EMPRESA, CARRINHO);
      expect(res.cart[0].sku).toBe('MOD-CAR-003');
    });
  });

  // ── Critério 8: carrinho vazio ───────────────────────────────────────────
  describe('carrinho vazio', () => {
    it('devolve despacho vazio, sem erro e sem ir ao banco', async () => {
      const { service, prisma } = await montar();
      const res = await service.dispatch(EMPRESA, { items: [] });

      expect(res).toEqual({ cart: [], workCenters: [], markets: [], pendencies: [], inconsistencies: [] });
      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.bomVersion.findMany).not.toHaveBeenCalled();
    });
  });

  // ── Critério 11: BOM ativa ambígua (#981) ────────────────────────────────
  describe('duas BOMs ativas para o mesmo produto', () => {
    const comDuasAtivas = (): BomFake[] => [
      ...bomsBase(),
      {
        id: 'bv-mod-v2',
        companyId: EMPRESA,
        productId: 'p-mod',
        version: 2,
        isActive: true,
        items: [
          { id: 'bi-9', componentId: 'p-paraf', quantity: '99', scrapPct: '0', routingStepId: 'rs-mod-1', unit: 'UN' },
        ],
      },
    ];

    it('escolhe a maior versão e denuncia a ambiguidade', async () => {
      const { service } = await montar({ boms: comDuasAtivas() });
      const res = await service.dispatch(EMPRESA, CARRINHO);

      expect(res.inconsistencies).toHaveLength(1);
      expect(res.inconsistencies[0]).toMatchObject({
        code: 'AMBIGUOUS_ACTIVE_BOM',
        productId: 'p-mod',
      });

      // Venceu a v2: 10 × 99 parafusos, e o conjunto (só na v1) não entra.
      const op = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 1);
      expect(op.oc.find((i) => i.sku === 'PC-PARAF')?.quantity).toBe('990');
    });

    it('a escolha não depende da ordem em que as BOMs voltam do banco', async () => {
      const direta = await montar({ boms: comDuasAtivas() });
      const invertida = await montar({ boms: [...comDuasAtivas()].reverse() });

      const a = await direta.service.dispatch(EMPRESA, CARRINHO);
      const b = await invertida.service.dispatch(EMPRESA, CARRINHO);
      expect(a).toEqual(b);
    });
  });

  // ── Pendências de roteiro ────────────────────────────────────────────────
  describe('pendências de cadastro', () => {
    it('MISSING_ROUTING — item fabricado sem nenhuma operação', async () => {
      const { service } = await montar({
        passos: passosBase().filter((s) => s.productId !== 'p-con'),
      });
      const res = await service.dispatch(EMPRESA, CARRINHO);

      const pend = res.pendencies.find((p) => p.code === 'MISSING_ROUTING');
      expect(pend).toMatchObject({ sku: 'CON-CHA-003', quantity: '10' });
      // E o conjunto não aparece como OS em setor nenhum.
      expect(res.workCenters.some((w) => w.operations.some((o) => o.os.sku === 'CON-CHA-003'))).toBe(
        false,
      );
    });

    it('MISSING_WORK_CENTER — a operação existe mas não aponta para setor', async () => {
      const { service } = await montar({
        passos: passosBase().map((s) =>
          s.id === 'rs-con-1' ? { ...s, workCenterId: null, workCenterRef: null } : s,
        ),
      });
      const res = await service.dispatch(EMPRESA, CARRINHO);

      const pend = res.pendencies.find((p) => p.code === 'MISSING_WORK_CENTER');
      expect(pend).toMatchObject({ sku: 'CON-CHA-003', routingStepId: 'rs-con-1' });
      // O texto diz quantos itens da OC ficaram de fora junto — o tamanho do
      // problema não pode ficar escondido.
      expect(pend?.detail).toContain('1 item(ns) da OC');
      expect(res.workCenters.some((w) => w.code === 'SET-SOL-002')).toBe(false);
    });

    it('MISSING_ACTIVE_BOM — semiacabado sem BOM ativa', async () => {
      const { service } = await montar({ boms: bomsBase().filter((b) => b.productId !== 'p-con') });
      const res = await service.dispatch(EMPRESA, CARRINHO);

      expect(res.pendencies.find((p) => p.code === 'MISSING_ACTIVE_BOM')).toMatchObject({
        sku: 'CON-CHA-003',
        quantity: '10',
      });
    });

    it('componente comprado sem BOM NÃO vira pendência (é o caso normal)', async () => {
      const { service } = await montar();
      const res = await service.dispatch(EMPRESA, CARRINHO);

      expect(res.pendencies.some((p) => p.code === 'MISSING_ACTIVE_BOM')).toBe(false);
    });

    it('ROUTING_STEP_MISMATCH — alocação aponta para operação de outro produto', async () => {
      const { service } = await montar({
        boms: bomsBase().map((b) =>
          b.id === 'bv-con'
            ? { ...b, items: b.items.map((i) => (i.id === 'bi-3' ? { ...i, routingStepId: 'rs-mod-1' } : i)) }
            : b,
        ),
      });
      const res = await service.dispatch(EMPRESA, CARRINHO);

      expect(res.pendencies.find((p) => p.code === 'ROUTING_STEP_MISMATCH')).toMatchObject({
        sku: 'PC-LONG',
        routingStepId: 'rs-mod-1',
      });
      // E a longarina não é entregue na Pré-montagem por engano.
      const preMontagem = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 1);
      expect(preMontagem.oc.some((i) => i.sku === 'PC-LONG')).toBe(false);
    });

    it('as pendências vêm ordenadas de forma estável', async () => {
      const { service } = await montar();
      const a = await service.dispatch(EMPRESA, CARRINHO);
      const b = await service.dispatch(EMPRESA, CARRINHO);
      expect(a.pendencies).toEqual(b.pendencies);
    });
  });

  // ── Ciclo e profundidade (critério 9) ────────────────────────────────────
  describe('estrutura de produto defeituosa', () => {
    it('ciclo de BOM não trava a chamada e vira inconsistência', async () => {
      const { service } = await montar({
        boms: [
          ...bomsBase(),
          {
            id: 'bv-long',
            companyId: EMPRESA,
            productId: 'p-long',
            version: 1,
            isActive: true,
            // A longarina volta a pedir o conjunto que a contém.
            items: [
              { id: 'bi-ciclo', componentId: 'p-con', quantity: '1', scrapPct: '0', routingStepId: null, unit: 'UN' },
            ],
          },
        ],
      });

      const res = await service.dispatch(EMPRESA, CARRINHO);
      expect(res.inconsistencies.some((i) => i.code === 'BOM_CYCLE')).toBe(true);
      // A chamada terminou e o resto da fábrica continua despachado.
      expect(res.workCenters.length).toBeGreaterThan(0);
    });
  });

  // ── Diamante: o mesmo subconjunto usado por dois pais ────────────────────
  //
  // Revisão dirigida (#1017). O risco aqui é dobrado e de sinais opostos:
  // DUPLICAR (emitir as operações do subconjunto duas vezes, uma por pai) ou
  // ELIMINAR (tratar o segundo encontro como ciclo e podar o ramo). O núcleo da
  // #980 detecta ciclo POR CAMINHO justamente para o diamante continuar válido;
  // este bloco prova que o despacho respeita isso de ponta a ponta.
  //
  //   MOD ×10        @ SET-MON-001
  //   ├── CON-A ×1   @ SET-SOL-002 → contém SUB ×2
  //   └── CON-B ×1   @ SET-GAL-001 → contém SUB ×3
  //   SUB (50)       passo 1 @ SET-SOL-002, passo 2 @ SET-GAL-001
  //   └── PC-LONG ×5 (250)
  describe('BOM em diamante', () => {
    const cenarioDiamante: Cenario = {
      produtos: [
        { id: 'p-mod', companyId: EMPRESA, sku: 'MOD-CAR-003', name: 'Carretinha 3', unit: 'UN', type: 'FINISHED_GOOD' },
        { id: 'p-cona', companyId: EMPRESA, sku: 'CON-A', name: 'Conjunto A', unit: 'UN', type: 'SEMI_FINISHED' },
        { id: 'p-conb', companyId: EMPRESA, sku: 'CON-B', name: 'Conjunto B', unit: 'UN', type: 'SEMI_FINISHED' },
        { id: 'p-sub', companyId: EMPRESA, sku: 'SUB-001', name: 'Subconjunto comum', unit: 'UN', type: 'SEMI_FINISHED' },
        { id: 'p-long', companyId: EMPRESA, sku: 'PC-LONG', name: 'Longarina', unit: 'UN', type: 'COMPONENT' },
      ],
      passos: [
        { id: 'rs-mod-1', companyId: EMPRESA, productId: 'p-mod', stepOrder: 1, name: 'Montagem', workCenterId: WC.mon.id, workCenterRef: WC.mon },
        { id: 'rs-cona-1', companyId: EMPRESA, productId: 'p-cona', stepOrder: 1, name: 'Solda A', workCenterId: WC.sol.id, workCenterRef: WC.sol },
        { id: 'rs-conb-1', companyId: EMPRESA, productId: 'p-conb', stepOrder: 1, name: 'Galvaniza B', workCenterId: WC.gal.id, workCenterRef: WC.gal },
        { id: 'rs-sub-1', companyId: EMPRESA, productId: 'p-sub', stepOrder: 1, name: 'Solda SUB', workCenterId: WC.sol.id, workCenterRef: WC.sol },
        { id: 'rs-sub-2', companyId: EMPRESA, productId: 'p-sub', stepOrder: 2, name: 'Galvaniza SUB', workCenterId: WC.gal.id, workCenterRef: WC.gal },
      ],
      boms: [
        {
          id: 'bv-mod', companyId: EMPRESA, productId: 'p-mod', version: 1, isActive: true,
          items: [
            { id: 'bi-a', componentId: 'p-cona', quantity: '1', scrapPct: '0', routingStepId: 'rs-mod-1', unit: 'UN' },
            { id: 'bi-b', componentId: 'p-conb', quantity: '1', scrapPct: '0', routingStepId: 'rs-mod-1', unit: 'UN' },
          ],
        },
        {
          id: 'bv-cona', companyId: EMPRESA, productId: 'p-cona', version: 1, isActive: true,
          items: [{ id: 'bi-a-sub', componentId: 'p-sub', quantity: '2', scrapPct: '0', routingStepId: 'rs-cona-1', unit: 'UN' }],
        },
        {
          id: 'bv-conb', companyId: EMPRESA, productId: 'p-conb', version: 1, isActive: true,
          items: [{ id: 'bi-b-sub', componentId: 'p-sub', quantity: '3', scrapPct: '0', routingStepId: 'rs-conb-1', unit: 'UN' }],
        },
        {
          id: 'bv-sub', companyId: EMPRESA, productId: 'p-sub', version: 1, isActive: true,
          items: [{ id: 'bi-sub-long', componentId: 'p-long', quantity: '5', scrapPct: '0', routingStepId: 'rs-sub-1', unit: 'UN' }],
        },
      ],
    };

    let res: DispatchResult;
    beforeAll(async () => {
      const { service } = await montar(cenarioDiamante);
      res = await service.dispatch(EMPRESA, CARRINHO);
    });

    it('o subconjunto compartilhado NÃO é podado como se fosse ciclo', () => {
      expect(res.inconsistencies).toEqual([]);
      expect(res.pendencies).toEqual([]);
    });

    it('cada operação do subconjunto aparece UMA vez só, não uma por pai', () => {
      const todas = res.workCenters.flatMap((w) =>
        w.operations.filter((o) => o.os.sku === 'SUB-001').map((o) => o.routingStepId),
      );
      expect(todas.sort()).toEqual(['rs-sub-1', 'rs-sub-2']);
    });

    it('a OS do subconjunto traz a quantidade SOMADA dos dois ramos (20 + 30 = 50)', () => {
      expect(operacao(res, 'SET-SOL-002', 'SUB-001', 1).os.quantity).toBe('50');
      expect(operacao(res, 'SET-GAL-001', 'SUB-001', 2).os.quantity).toBe('50');
    });

    it('o componente abaixo do subconjunto é somado uma vez só (50 × 5 = 250)', () => {
      const soldaSub = operacao(res, 'SET-SOL-002', 'SUB-001', 1);
      const longarinas = soldaSub.oc.filter((i) => i.sku === 'PC-LONG');

      expect(longarinas).toHaveLength(1);
      expect(longarinas[0].quantity).toBe('250');
      // Uma única linha de BOM gerou tudo, mesmo tendo sido percorrida 2×.
      expect(longarinas[0].bomItemIds).toEqual(['bi-sub-long']);
    });

    it('cada pai recebe a SUA parcela do subconjunto, sem misturar', () => {
      const a = operacao(res, 'SET-SOL-002', 'CON-A', 1).oc.find((i) => i.sku === 'SUB-001');
      const b = operacao(res, 'SET-GAL-001', 'CON-B', 1).oc.find((i) => i.sku === 'SUB-001');

      expect(a?.quantity).toBe('20');
      expect(b?.quantity).toBe('30');
      expect(a?.bomItemIds).toEqual(['bi-a-sub']);
      expect(b?.bomItemIds).toEqual(['bi-b-sub']);
    });

    it('os dois pais buscam o subconjunto na ÚLTIMA operação do roteiro dele', () => {
      // SUB fica pronto na Galvanização (passo 2), não na Solda (passo 1) —
      // mesmo que um dos pais seja soldado.
      for (const [code, sku] of [
        ['SET-SOL-002', 'CON-A'],
        ['SET-GAL-001', 'CON-B'],
      ]) {
        const sub = operacao(res, code, sku, 1).oc.find((i) => i.sku === 'SUB-001');
        expect(sub).toMatchObject({
          sourceType: 'WORK_CENTER',
          fromWorkCenter: { code: 'SET-GAL-001' },
          fromRoutingStepId: 'rs-sub-2',
        });
      }
    });

    it('o item transferido entre operações aparece UMA única vez na OC seguinte', () => {
      const galvaSub = operacao(res, 'SET-GAL-001', 'SUB-001', 2);
      const proprios = galvaSub.oc.filter((i) => i.sku === 'SUB-001');

      expect(proprios).toHaveLength(1);
      expect(proprios[0]).toMatchObject({
        quantity: '50',
        originKind: 'PREVIOUS_OPERATION',
        fromRoutingStepId: 'rs-sub-1',
      });
      // E é a ÚNICA coisa na OC: o componente da BOM foi alocado ao passo 1.
      expect(galvaSub.oc).toHaveLength(1);
    });
  });

  // ── Todas as quantidades são string, em toda a resposta ──────────────────
  describe('Decimal não vaza para a resposta', () => {
    it('toda quantidade da resposta é string, em qualquer bloco', async () => {
      const { service } = await montar();
      const res = await service.dispatch(EMPRESA, CARRINHO);

      const quantidades: unknown[] = [
        ...res.cart.map((c) => c.quantity),
        ...res.pendencies.map((p) => p.quantity),
        ...res.workCenters.flatMap((w) =>
          w.operations.flatMap((o) => [o.os.quantity, ...o.oc.map((i) => i.quantity)]),
        ),
      ];

      expect(quantidades.length).toBeGreaterThan(0);
      for (const q of quantidades) {
        expect(typeof q).toBe('string');
        // Nada de "220.00000000000003" nem de notação científica escapando.
        expect(q as string).toMatch(/^\d+(\.\d+)?$/);
      }
    });
  });

  // ── Swagger diz a verdade sobre as quantidades ───────────────────────────
  //
  // Revisão dirigida (#1017): o Swagger não documentava a resposta, então
  // ninguém que abrisse o /docs saberia que `quantity` é STRING. Um consumidor
  // que assumisse number faria `qty * preco` e receberia NaN. Este teste trava
  // a documentação junto com o código.
  describe('documentação da resposta (Swagger)', () => {
    const PROPRIEDADE = 'swagger/apiModelProperties';

    it('toda propriedade `quantity` do contrato é documentada como string', () => {
      const dtos = [
        DispatchCartEchoDto,
        DispatchOsDto,
        DispatchCollectItemDto,
        DispatchPendencyDto,
      ];

      for (const Dto of dtos) {
        const meta = Reflect.getMetadata(PROPRIEDADE, Dto.prototype, 'quantity');
        expect(meta).toBeDefined();
        expect(meta.type).toBe('string');
        // O exemplo também precisa ser string — exemplo numérico no /docs
        // convidaria justamente o erro que queremos evitar.
        expect(typeof meta.example).toBe('string');
      }
    });

    it('o endpoint declara o tipo de resposta (não fica sem schema)', () => {
      const respostas = Reflect.getMetadata(
        'swagger/apiResponse',
        ProductionController.prototype.dispatch,
      );
      // `type` guarda a própria classe (uma função), então some no
      // JSON.stringify — a comparação tem de ser pela referência.
      expect(respostas?.['200']?.type).toBe(DispatchResponseDto);
    });
  });

  // ── Quantidades somadas entre ramos ──────────────────────────────────────
  describe('o mesmo componente entrando por dois caminhos', () => {
    it('soma as quantidades dos dois ramos na mesma operação', async () => {
      const { service } = await montar({
        boms: bomsBase().map((b) =>
          b.id === 'bv-mod'
            ? {
                ...b,
                items: [
                  ...b.items,
                  // Segunda linha do MESMO parafuso, na MESMA operação.
                  { id: 'bi-extra', componentId: 'p-paraf', quantity: '5', scrapPct: '0', routingStepId: 'rs-mod-1', unit: 'UN' },
                ],
              }
            : b,
        ),
      });

      const res = await service.dispatch(EMPRESA, CARRINHO);
      const op = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 1);
      const paraf = op.oc.filter((i) => i.sku === 'PC-PARAF');

      // Uma única linha de OC (o setor recebe parafuso uma vez só)...
      expect(paraf).toHaveLength(1);
      // ...com a soma dos dois: 220 + 50.
      expect(paraf[0].quantity).toBe('270');
      // ...e as duas linhas de BOM rastreadas.
      expect(paraf[0].bomItemIds.sort()).toEqual(['bi-2', 'bi-extra']);
    });
  });
});

describe('mercados (#1058 passo 2)', () => {
  const MER = {
    sol: { id: 'wc-mer-sol', code: 'SET-MER-004', name: 'Mercado Solda' },
    gal: { id: 'wc-mer-gal', code: 'SET-MER-005', name: 'Mercado Galvanização' },
    monMetal: { id: 'wc-mer-mon', code: 'SET-MER-006', name: 'Mercado Montagem Metal' },
    marcenaria: { id: 'wc-mer-mar', code: 'SET-MER-007', name: 'Mercado Montagem - Marcenaria' },
    almox: { id: 'wc-mer-alm', code: 'SET-MER-008', name: 'Almoxarifado' },
  };

  /** Cadastro com a cadeia de mercados ligada (como ficou após o passo 1). */
  function centrosComMercado(): CentroFake[] {
    const mk = (wc: { id: string; code: string; name: string }, supply: { id: string; code: string; name: string } | null): CentroFake => ({
      id: wc.id,
      companyId: EMPRESA,
      code: wc.code,
      name: wc.name,
      supplyMarket: supply,
    });
    return [
      mk(WC.sol, MER.sol),
      mk(WC.gal, MER.gal),
      mk(WC.mon, MER.monMetal),
      mk(MER.sol, null),
      mk(MER.gal, null),
      mk(MER.monMetal, null),
      mk(MER.marcenaria, null),
      mk(MER.almox, null),
    ];
  }

  it('linha de OC ganha o mercado do centro CONSUMIDOR (regra geral)', async () => {
    const { service } = await montar({ centros: centrosComMercado() });
    const res = await service.dispatch(EMPRESA, CARRINHO);

    // Longarina consumida na Solda → compra do Mercado Solda.
    const solda = operacao(res, 'SET-SOL-002', 'CON-CHA-003', 1);
    const long = solda.oc.find((i) => i.sku === 'PC-LONG')!;
    expect(long.market?.code).toBe('SET-MER-004');

    // O conjunto chegando na Galvanização vindo da Solda → Mercado Galvanização.
    const galv = operacao(res, 'SET-GAL-001', 'CON-CHA-003', 2);
    const proprio = galv.oc.find((i) => i.originKind === 'PREVIOUS_OPERATION')!;
    expect(proprio.market?.code).toBe('SET-MER-005');
    // A origem crua continua disponível para a visão do mercado.
    expect(proprio.fromWorkCenter?.code).toBe('SET-SOL-002');
  });

  it('exceção da Montagem: comprado vem do Almoxarifado, não do Montagem Metal', async () => {
    const { service } = await montar({ centros: centrosComMercado() });
    const res = await service.dispatch(EMPRESA, CARRINHO);

    const preMontagem = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 1);
    const paraf = preMontagem.oc.find((i) => i.sku === 'PC-PARAF')!;
    expect(paraf.sourceType).toBe('EXTERNAL_OR_STOCK');
    expect(paraf.market?.code).toBe('SET-MER-008');

    // Já o conjunto FABRICADO (vem da galvanização) usa o padrão da Montagem.
    const montagemFinal = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 2);
    const conjunto = montagemFinal.oc.find((i) => i.sku === 'CON-CHA-003')!;
    expect(conjunto.market?.code).toBe('SET-MER-006');
  });

  it('exceção da Montagem: peça vinda da marcenaria compra do mercado da marcenaria', async () => {
    const marWc = { id: 'wc-mar', code: 'SET-MAR-001', name: 'Corte de Madeira' };
    const { service } = await montar({
      produtos: [
        ...produtosBase(),
        { id: 'p-mad', companyId: EMPRESA, sku: 'MAR-LAT-001', name: 'Madeira Lateral', unit: 'UN', type: 'SEMI_FINISHED' },
      ],
      passos: [
        ...passosBase(),
        { id: 'rs-mad-1', companyId: EMPRESA, productId: 'p-mad', stepOrder: 1, name: 'Corte', workCenterId: marWc.id, workCenterRef: marWc },
      ],
      boms: bomsBase().map((b) =>
        b.id === 'bv-mod'
          ? {
              ...b,
              items: [
                ...b.items,
                { id: 'bi-mad', componentId: 'p-mad', quantity: '2', scrapPct: '0', routingStepId: 'rs-mod-2', unit: 'UN' },
              ],
            }
          : b,
      ),
      centros: [
        ...centrosComMercado(),
        { id: marWc.id, companyId: EMPRESA, code: marWc.code, name: marWc.name, supplyMarket: MER.marcenaria },
      ],
    });

    const res = await service.dispatch(EMPRESA, CARRINHO);
    const montagemFinal = operacao(res, 'SET-MON-001', 'MOD-CAR-003', 2);
    const madeira = montagemFinal.oc.find((i) => i.sku === 'MAR-LAT-001')!;
    expect(madeira.sourceType).toBe('WORK_CENTER');
    expect(madeira.market?.code).toBe('SET-MER-007');
  });

  it('monta a visão do operador de mercado: o que chega e o que separar', async () => {
    const { service } = await montar({ centros: centrosComMercado() });
    const res = await service.dispatch(EMPRESA, CARRINHO);

    const almox = res.markets.find((m) => m.code === 'SET-MER-008')!;
    // Chega de compra/estoque (from null) e separa para a Montagem.
    expect(almox.inbound).toHaveLength(1);
    expect(almox.inbound[0].sku).toBe('PC-PARAF');
    expect(almox.inbound[0].from).toBeNull();
    expect(almox.inbound[0].sourceType).toBe('EXTERNAL_OR_STOCK');
    expect(almox.outbound[0].toWorkCenter.code).toBe('SET-MON-001');
    // Quantidade agregada em Decimal: 10 un × 20 × 1,10 de scrap = 220.
    expect(almox.outbound[0].quantity).toBe('220');

    const merGal = res.markets.find((m) => m.code === 'SET-MER-005')!;
    expect(merGal.inbound[0].from?.code).toBe('SET-SOL-002');
    expect(merGal.outbound[0].toWorkCenter.code).toBe('SET-GAL-001');

    // Mercados ordenados por código, resposta estável.
    expect(res.markets.map((m) => m.code)).toEqual([...res.markets.map((m) => m.code)].sort());
  });

  it('sem mercado configurado, market é null e markets vem vazio (compatibilidade)', async () => {
    const { service } = await montar();
    const res = await service.dispatch(EMPRESA, CARRINHO);
    expect(res.markets).toEqual([]);
    for (const wc of res.workCenters)
      for (const op of wc.operations)
        for (const item of op.oc) expect(item.market).toBeNull();
  });
});
