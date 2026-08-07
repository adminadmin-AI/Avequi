import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Chassis gravados — leitura das tabelas gdr_chassi_* alimentadas pela
 * ferramenta OpenClaw (marcadora de chassi no chão de fábrica). Issue #889.
 *
 * ⚠️ Estas tabelas NÃO têm companyId (decisão da #782 — o chassi é da
 * implantação GDR): o isolamento aqui é por permissão RBAC
 * (production.chassi.view), não por empresa.
 *
 * Os models usam BigInt como id (sem precedente de serialização no repo);
 * convertemos para number na borda do service — ids são autoincrement
 * pequenos, muito abaixo de 2^53.
 */
const num = (v: bigint) => Number(v);

export interface FiltroGravacoes {
  vin?: string;
  tipo?: string;
  status?: string;
  quadroCodigo?: string;
}

const LIMITE_LISTA = 500;

@Injectable()
export class ChassiService {
  constructor(private readonly prisma: PrismaService) {}

  async listarGravacoes(filtro: FiltroGravacoes) {
    const where: Record<string, unknown> = {};
    if (filtro.vin) where.vin = { contains: filtro.vin.toUpperCase() };
    if (filtro.tipo === 'padrao' || filtro.tipo === 'especial') where.tipo = filtro.tipo;
    if (filtro.status) where.status = filtro.status;
    if (filtro.quadroCodigo) where.quadro = { codigo: filtro.quadroCodigo };

    const rows = await this.prisma.gdrChassiGravacao.findMany({
      where,
      include: {
        quadro: { select: { codigo: true, nome: true } },
        serie: { select: { codigo: true, nome: true } },
        // Só as marcações concluídas: a lista mostra "parou onde?" sem
        // precisar abrir o detalhe. São no máximo 3 por gravação (plaqueta,
        // esquerdo, direito), então não infla a resposta.
        eventos: {
          where: { evento: 'etapa_gravada', etapa: { not: null } },
          select: { etapa: true },
        },
      },
      orderBy: { criadoEm: 'desc' },
      take: LIMITE_LISTA,
    });

    return rows.map((g) => ({
      id: num(g.id),
      vin: g.vin,
      tipo: g.tipo,
      observacao: g.observacao,
      numero: g.numero,
      ano: g.ano,
      operador: g.operador,
      status: g.status,
      criadoEm: g.criadoEm,
      concluidoEm: g.concluidoEm,
      quadro: g.quadro ? { codigo: g.quadro.codigo, nome: g.quadro.nome } : null,
      serie: { codigo: g.serie.codigo, nome: g.serie.nome },
      etapasGravadas: [...new Set(g.eventos.map((e) => e.etapa as string))],
    }));
  }

  async detalheGravacao(id: number) {
    const g = await this.prisma.gdrChassiGravacao.findUnique({
      where: { id: BigInt(id) },
      include: {
        quadro: { select: { codigo: true, nome: true } },
        serie: { select: { codigo: true, nome: true, prefixo: true } },
        eventos: { orderBy: { id: 'asc' } },
      },
    });
    if (!g) throw new NotFoundException(`Gravação ${id} não encontrada`);

    return {
      id: num(g.id),
      vin: g.vin,
      tipo: g.tipo,
      observacao: g.observacao,
      numero: g.numero,
      ano: g.ano,
      operador: g.operador,
      status: g.status,
      criadoEm: g.criadoEm,
      concluidoEm: g.concluidoEm,
      quadro: g.quadro ? { codigo: g.quadro.codigo, nome: g.quadro.nome } : null,
      serie: { codigo: g.serie.codigo, nome: g.serie.nome, prefixo: g.serie.prefixo },
      eventos: g.eventos.map((e) => ({
        id: num(e.id),
        evento: e.evento,
        etapa: e.etapa,
        operador: e.operador,
        detalhe: e.detalhe,
        criadoEm: e.criadoEm,
      })),
    };
  }

  /**
   * Painel das séries: faixa, usados/reservados (pool gdr_chassi_numeros,
   * TODOS os anos — o VIN não carrega o ano no prefixo) e restantes.
   */
  async painelSeries() {
    const series = await this.prisma.gdrChassiSerie.findMany({
      where: { ativo: true },
      orderBy: { id: 'asc' },
    });
    const contagens = await this.prisma.gdrChassiNumero.groupBy({
      by: ['serieId', 'status'],
      _count: { _all: true },
    });

    const porSerie = new Map<number, { usados: number; reservados: number }>();
    for (const c of contagens) {
      const chave = num(c.serieId);
      const atual = porSerie.get(chave) ?? { usados: 0, reservados: 0 };
      if (c.status === 'usado') atual.usados += c._count._all;
      else if (c.status === 'reservado') atual.reservados += c._count._all;
      porSerie.set(chave, atual);
    }

    const ALERTA_RESTANTES = 100;
    return series.map((s) => {
      const { usados, reservados } = porSerie.get(num(s.id)) ?? { usados: 0, reservados: 0 };
      const total = s.faixaMax - s.faixaMin + 1;
      const restantes = total - usados - reservados;
      return {
        id: num(s.id),
        codigo: s.codigo,
        nome: s.nome,
        prefixo: s.prefixo,
        eixos: s.eixos,
        faixaMin: s.faixaMin,
        faixaMax: s.faixaMax,
        usados,
        reservados,
        restantes,
        alerta: restantes <= ALERTA_RESTANTES,
      };
    });
  }
}
