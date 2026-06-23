import type { ProductType, UnitOfMeasure, UserRole, CustomerType } from '@/types/api';

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  RAW_MATERIAL: 'Matéria-prima',
  SEMI_FINISHED: 'Semiacabado',
  FINISHED_GOOD: 'Produto acabado',
  CONSUMABLE: 'Consumível',
  SERVICE: 'Serviço',
  COMPONENT: 'Componente',
};

export const UNIT_LABELS: Record<UnitOfMeasure, string> = {
  UN: 'Unidade (UN)',
  KG: 'Quilograma (KG)',
  G: 'Grama (G)',
  M: 'Metro (M)',
  M2: 'Metro² (M2)',
  M3: 'Metro³ (M3)',
  L: 'Litro (L)',
  PC: 'Peça (PC)',
  CX: 'Caixa (CX)',
  PR: 'Par (PR)',
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  DIRECTOR: 'Diretor',
  MANAGER: 'Gerente',
  COMMERCIAL: 'Comercial',
  PRODUCTION: 'Produção',
  QUALITY: 'Qualidade',
  WAREHOUSE: 'Estoque',
  FINANCIAL: 'Financeiro',
  STORE: 'Loja',
  READER: 'Leitor',
};

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  INDIVIDUAL: 'Pessoa Física',
  COMPANY: 'Pessoa Jurídica',
};

/** Helper para montar <option> a partir de um mapa de labels. */
export function enumOptions<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
}
