/**
 * Parser mínimo de BR Code PIX (padrão EMV®1 QRCPS-MPM do Bacen).
 *
 * Um "PIX Copia e Cola" é uma string TLV: [id 2 dígitos][tamanho 2 dígitos]
 * [valor]. A chave PIX do recebedor mora no campo Merchant Account Information
 * (ids 26–51), no subcampo 01, quando o subcampo 00 (GUI) é "br.gov.bcb.pix".
 *
 * Usado pela captura inteligente: ao colar um copia-e-cola numa conta cujo
 * fornecedor ainda não tem chave cadastrada, extraímos a chave e oferecemos
 * salvá-la no cadastro do fornecedor.
 */

interface TlvField {
  id: string;
  value: string;
}

/** Decodifica um nível de TLV; null se a string não fechar certinho. */
function parseTlv(s: string): TlvField[] | null {
  const out: TlvField[] = [];
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) return null;
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || Number.isNaN(len)) return null;
    const end = i + 4 + len;
    if (end > s.length) return null;
    out.push({ id, value: s.slice(i + 4, end) });
    i = end;
  }
  return out;
}

const PIX_GUI = 'br.gov.bcb.pix';

/**
 * Extrai a chave PIX de um BR Code (copia e cola). Devolve null quando o texto
 * não é um BR Code válido ou não carrega chave (ex.: QR dinâmico só com URL do
 * PSP no subcampo 25).
 */
export function extractPixKeyFromBrCode(code: string | null | undefined): string | null {
  const s = (code ?? '').trim();
  // BR Code sempre começa no Payload Format Indicator "000201"
  if (!s.startsWith('000201')) return null;
  const fields = parseTlv(s);
  if (!fields) return null;
  for (const f of fields) {
    const id = Number(f.id);
    if (id < 26 || id > 51) continue; // faixa Merchant Account Information
    const subs = parseTlv(f.value);
    if (!subs) continue;
    const gui = subs.find((x) => x.id === '00')?.value?.toLowerCase();
    if (gui !== PIX_GUI) continue;
    const key = subs.find((x) => x.id === '01')?.value?.trim();
    if (key) return key;
  }
  return null;
}
