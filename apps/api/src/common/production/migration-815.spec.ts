import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * #815 — garantias da migration.
 *
 * A convenção do projeto é mockar o Prisma nos testes unitários (nunca chamada
 * real ao banco), então aqui validamos duas coisas que NÃO dependem de conexão:
 *
 *  1. estruturalmente, que a migration é aditiva e declara as constraints e
 *     índices certos — a regra do projeto proíbe DROP em migration;
 *  2. semanticamente, que a regra de correspondência do backfill é a esperada,
 *     simulando o predicado do UPDATE.
 */
describe('migration 20260728210000_routing_workcenter_fk_bomitem_step (#815)', () => {
  const MIGRATION_SQL = join(
    __dirname,
    '..',
    '..',
    '..',
    'prisma',
    'migrations',
    '20260728210000_routing_workcenter_fk_bomitem_step',
    'migration.sql',
  );
  const sql = readFileSync(MIGRATION_SQL, 'utf8');
  const semComentarios = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  describe('é estritamente aditiva', () => {
    it('não contém DROP algum', () => {
      expect(semComentarios).not.toMatch(/\bDROP\b/i);
    });

    it('não contém DELETE nem TRUNCATE', () => {
      expect(semComentarios).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(semComentarios).not.toMatch(/\bTRUNCATE\b/i);
    });

    it('não altera nem remove a coluna textual legada workCenter', () => {
      expect(semComentarios).not.toMatch(/ALTER\s+TABLE\s+"gdr_routing_steps"[\s\S]*?ALTER\s+COLUMN\s+"workCenter"/i);
    });

    it('adiciona colunas de forma idempotente', () => {
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "workCenterId"/);
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "routingStepId"/);
    });
  });

  describe('integridade referencial', () => {
    const fks = sql.match(/ADD CONSTRAINT[\s\S]*?;/g) ?? [];

    it('declara exatamente as duas FKs novas', () => {
      expect(fks).toHaveLength(2);
    });

    it('BomItem -> RoutingStep usa ON DELETE RESTRICT', () => {
      // Apagar um passo não pode desassociar alocação de BOM em silêncio.
      expect(sql).toMatch(/gdr_bom_items_routingStepId_fkey[\s\S]*?ON DELETE RESTRICT/);
    });

    it('RoutingStep -> WorkCenter usa ON DELETE RESTRICT', () => {
      // A integridade não pode depender só do guard do serviço: exclusão por
      // script ou console também tem de esbarrar no banco.
      expect(sql).toMatch(/gdr_routing_steps_workCenterId_fkey[\s\S]*?ON DELETE RESTRICT/);
    });

    it('NENHUMA das duas usa CASCADE no delete', () => {
      expect(fks.length).toBeGreaterThan(0);
      for (const fk of fks) {
        expect(fk).not.toMatch(/ON DELETE CASCADE/i);
      }
    });

    it('NENHUMA das duas usa SET NULL', () => {
      expect(fks.length).toBeGreaterThan(0);
      for (const fk of fks) {
        expect(fk).not.toMatch(/ON DELETE SET NULL/i);
      }
      expect(sql).not.toMatch(/ON DELETE SET NULL/i);
    });

    it('as duas FKs referenciam as tabelas e colunas corretas', () => {
      expect(sql).toMatch(
        /"gdr_routing_steps"[\s\S]*?FOREIGN KEY \("workCenterId"\) REFERENCES "gdr_work_centers"\("id"\)/,
      );
      expect(sql).toMatch(
        /"gdr_bom_items"[\s\S]*?FOREIGN KEY \("routingStepId"\) REFERENCES "gdr_routing_steps"\("id"\)/,
      );
    });

    it('cria os dois índices de leitura do despacho, com as colunas certas', () => {
      expect(sql).toMatch(
        /CREATE INDEX IF NOT EXISTS "gdr_routing_steps_companyId_workCenterId_idx"\s*\n?\s*ON "gdr_routing_steps" \("companyId", "workCenterId"\)/,
      );
      expect(sql).toMatch(
        /CREATE INDEX IF NOT EXISTS "gdr_bom_items_routingStepId_idx"\s*\n?\s*ON "gdr_bom_items" \("routingStepId"\)/,
      );
    });

    it('as colunas novas são TEXT, compatíveis com os ids cuid() existentes', () => {
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "workCenterId" TEXT/);
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "routingStepId" TEXT/);
    });
  });

  describe('backfill', () => {
    it('só preenche linhas com workCenterId nulo', () => {
      expect(sql).toMatch(/rs\."workCenterId" IS NULL/);
    });

    it('exige correspondência exata de code E mesma empresa', () => {
      expect(sql).toMatch(/wc\."code" = rs\."workCenter"/);
      expect(sql).toMatch(/wc\."companyId" = rs\."companyId"/);
    });

    it('não altera o campo textual — o backfill só escreve a FK', () => {
      const update = sql.slice(sql.indexOf('UPDATE "gdr_routing_steps"'));
      expect(update).toMatch(/SET "workCenterId" =/);
      expect(update).not.toMatch(/SET[\s\S]*"workCenter"\s*=/);
    });
  });

  /**
   * Simulação do predicado do backfill. Espelha exatamente as 4 condições do
   * WHERE: FK nula, texto presente, code igual e mesma empresa.
   */
  describe('regra de correspondência do backfill (simulada)', () => {
    type Etapa = { workCenterId: string | null; workCenter: string | null; companyId: string };
    type Centro = { id: string; code: string; companyId: string };

    const backfill = (etapas: Etapa[], centros: Centro[]) =>
      etapas.map((rs) => {
        if (rs.workCenterId !== null || rs.workCenter === null) return rs;
        const wc = centros.find((c) => c.code === rs.workCenter && c.companyId === rs.companyId);
        return wc ? { ...rs, workCenterId: wc.id } : rs;
      });

    const CENTRO: Centro = { id: 'wc-solda', code: 'SET-SOL-002', companyId: 'empresa-A' };

    it('COM correspondência: converte', () => {
      const r = backfill(
        [{ workCenterId: null, workCenter: 'SET-SOL-002', companyId: 'empresa-A' }],
        [CENTRO],
      );
      expect(r[0].workCenterId).toBe('wc-solda');
    });

    it('SEM correspondência de código: não converte e preserva o texto', () => {
      const r = backfill(
        [{ workCenterId: null, workCenter: 'Costura', companyId: 'empresa-A' }],
        [CENTRO],
      );
      expect(r[0].workCenterId).toBeNull();
      expect(r[0].workCenter).toBe('Costura');
    });

    it('código igual mas EMPRESA diferente: não converte (isolamento de tenant)', () => {
      const r = backfill(
        [{ workCenterId: null, workCenter: 'SET-SOL-002', companyId: 'empresa-B' }],
        [CENTRO],
      );
      expect(r[0].workCenterId).toBeNull();
    });

    it('linha que já tem FK não é tocada', () => {
      const r = backfill(
        [{ workCenterId: 'wc-corte', workCenter: 'SET-SOL-002', companyId: 'empresa-A' }],
        [CENTRO],
      );
      expect(r[0].workCenterId).toBe('wc-corte');
    });

    it('cenário real da base atual: 4 etapas demo, 0 centros -> ZERO conversões', () => {
      // gdr_work_centers está vazio e as 4 etapas são do produto CAL-001
      // (calçado) na empresa GDR Matriz. Documentado na issue #815.
      const demo: Etapa[] = ['Corte', 'Costura', 'Montagem', 'Acabamento'].map((t) => ({
        workCenterId: null,
        workCenter: t,
        companyId: 'gdr-matriz',
      }));

      const r = backfill(demo, []);

      expect(r.filter((e) => e.workCenterId !== null)).toHaveLength(0);
      // e nada foi perdido
      expect(r.map((e) => e.workCenter)).toEqual(['Corte', 'Costura', 'Montagem', 'Acabamento']);
    });
  });
});
