/**
 * #992/#1025 — Documento contratual vigente do gerador: AVQ-CT v2, minuta do
 * parceiro jurídico do Claudio (05/08/2026), transcrita fielmente do PDF
 * aprovado. Este arquivo só MONTA o documento; o texto vive nos
 * contract-v2-texto-*.ts e contract-v2-anexos.ts. Mudou texto de cláusula →
 * decisão jurídica: subir TEMPLATE_VERSION e registrar na issue.
 */
import { Capitulo, ContratoV2Params, PENDENTE } from './contract-v2-tipos';
import { anexos } from './contract-v2-anexos';
import { capitulos1a14 } from './contract-v2-texto-1';
import { capitulos15a27 } from './contract-v2-texto-2';
import { capitulos28a43 } from './contract-v2-texto-3';

export { ContratoV2Params, PENDENTE } from './contract-v2-tipos';

export const TEMPLATE_VERSION = 'AVQ-CT v2';

export const TITULO_DOCUMENTO =
  'CONTRATO DE LICENÇA DE USO DE SOFTWARE EM NUVEM (SaaS) E PRESTAÇÃO DE SERVIÇOS CORRELATOS';

export const PREAMBULO =
  'Documento AVQ-CT v2 · Instrumento particular, celebrado em caráter empresarial, regido pelos artigos 421 e ' +
  '421-A do Código Civil, pela Lei nº 9.609/1998, pela Lei nº 9.610/1998, pela Lei nº 12.965/2014, pela Lei nº ' +
  '13.709/2018 e pela Lei nº 14.063/2020.';

export interface DocumentoContrato {
  titulo: string;
  preambulo: string;
  capitulos: Capitulo[];
  anexos: Capitulo[];
  /** Local de assinatura ("Cidade/UF") — cadastro da operadora ou pendente. */
  localAssinatura: string;
}

export function montarDocumento(p: ContratoV2Params): DocumentoContrato {
  return {
    titulo: TITULO_DOCUMENTO,
    preambulo: PREAMBULO,
    capitulos: [...capitulos1a14(p), ...capitulos15a27(), ...capitulos28a43(p)],
    anexos: anexos(p),
    localAssinatura: p.operadora.comarca ?? PENDENTE,
  };
}
