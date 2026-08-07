import { apiClient } from './api-client';

/**
 * Export CSV server-side com cursor (#1032) — baixa o arquivo de um
 * endpoint de export (`/products/export`, `/customers/export`) e dispara o
 * download no browser. Os `params` devem ser os MESMOS filtros ativos na
 * tela: o servidor gera o CSV do conjunto filtrado inteiro (cursor +
 * streaming em lote), não só a página carregada.
 */
export async function baixarCsvServidor(
  url: string,
  params: Record<string, string | number | boolean | undefined>,
  filename: string,
): Promise<void> {
  const res = await apiClient.get<Blob>(url, { params, responseType: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(res.data);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
