import axios from 'axios';

/**
 * Cliente HTTP do Portal do Fornecedor (#141).
 *
 * Diferente do `apiClient` (que usa JWT do ERP), o portal autentica por um
 * TOKEN ÚNICO por fornecedor, enviado no header `x-supplier-token` (aceito
 * pelo SupplierTokenGuard do backend). NÃO envia Authorization para não
 * colidir com a sessão do ERP.
 */
export const PORTAL_TOKEN_KEY = 'supplierToken';

export const portalClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api',
});

portalClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(PORTAL_TOKEN_KEY);
    if (token) config.headers['x-supplier-token'] = token;
  }
  return config;
});

export function getPortalToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PORTAL_TOKEN_KEY);
}
export function setPortalToken(token: string) {
  localStorage.setItem(PORTAL_TOKEN_KEY, token);
}
export function clearPortalToken() {
  localStorage.removeItem(PORTAL_TOKEN_KEY);
}
