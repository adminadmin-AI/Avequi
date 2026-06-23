import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { CreateMetricDto } from '../dto/create-metric.dto';
import { CreateDimensionDto } from '../dto/create-dimension.dto';

export interface BuiltInMetric {
  name: string;
  displayName: string;
  description: string;
  dataSource: string;
  expression: string;
  unit: string;
  format: string;
  isBuiltIn: true;
  category: string;
}

export interface BuiltInDimension {
  name: string;
  displayName: string;
  description: string;
  dataSource: string;
  field: string;
  hierarchy?: string;
  isBuiltIn: true;
}

@Injectable()
export class SemanticLayerService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Built-in Metrics ────────────────────────────────────────────────────────

  getBuiltInMetrics(): BuiltInMetric[] {
    return [
      {
        name: 'revenue',
        displayName: 'Receita',
        description: 'Soma da receita de vendas no período',
        dataSource: 'sales',
        expression: 'SUM(revenue)',
        unit: 'BRL',
        format: 'currency',
        isBuiltIn: true,
        category: 'COMMERCIAL',
      },
      {
        name: 'quantity_sold',
        displayName: 'Quantidade Vendida',
        description: 'Soma das unidades vendidas no período',
        dataSource: 'sales',
        expression: 'SUM(quantity)',
        unit: 'UN',
        format: 'number',
        isBuiltIn: true,
        category: 'COMMERCIAL',
      },
      {
        name: 'avg_ticket',
        displayName: 'Ticket Médio',
        description: 'Valor médio por pedido de venda',
        dataSource: 'sales',
        expression: 'AVG(avgTicket)',
        unit: 'BRL',
        format: 'currency',
        isBuiltIn: true,
        category: 'COMMERCIAL',
      },
      {
        name: 'order_count',
        displayName: 'Pedidos',
        description: 'Contagem de pedidos de venda',
        dataSource: 'sales',
        expression: 'COUNT(*)',
        unit: 'UN',
        format: 'number',
        isBuiltIn: true,
        category: 'COMMERCIAL',
      },
      {
        name: 'stock_value',
        displayName: 'Valor em Estoque',
        description: 'Valor total do estoque disponível',
        dataSource: 'inventory',
        expression: 'SUM(value)',
        unit: 'BRL',
        format: 'currency',
        isBuiltIn: true,
        category: 'OPERATIONAL',
      },
      {
        name: 'stock_quantity',
        displayName: 'Quantidade em Estoque',
        description: 'Quantidade total disponível em estoque',
        dataSource: 'inventory',
        expression: 'SUM(quantity)',
        unit: 'UN',
        format: 'number',
        isBuiltIn: true,
        category: 'OPERATIONAL',
      },
      {
        name: 'production_cost',
        displayName: 'Custo de Produção',
        description: 'Custo total das ordens de produção',
        dataSource: 'production',
        expression: 'SUM(totalCost)',
        unit: 'BRL',
        format: 'currency',
        isBuiltIn: true,
        category: 'OPERATIONAL',
      },
      {
        name: 'material_cost',
        displayName: 'Custo de Material',
        description: 'Custo de matéria-prima nas ordens de produção',
        dataSource: 'production',
        expression: 'SUM(materialCost)',
        unit: 'BRL',
        format: 'currency',
        isBuiltIn: true,
        category: 'OPERATIONAL',
      },
      {
        name: 'labor_cost',
        displayName: 'Custo de Mão de Obra',
        description: 'Custo de mão de obra nas ordens de produção',
        dataSource: 'production',
        expression: 'SUM(laborCost)',
        unit: 'BRL',
        format: 'currency',
        isBuiltIn: true,
        category: 'OPERATIONAL',
      },
      {
        name: 'revenue_total',
        displayName: 'Receita Financeira',
        description: 'Soma de todas as entradas financeiras',
        dataSource: 'financial',
        expression: 'SUM(revenue)',
        unit: 'BRL',
        format: 'currency',
        isBuiltIn: true,
        category: 'FINANCIAL',
      },
      {
        name: 'expense_total',
        displayName: 'Despesa Total',
        description: 'Soma de todas as saídas financeiras',
        dataSource: 'financial',
        expression: 'SUM(expense)',
        unit: 'BRL',
        format: 'currency',
        isBuiltIn: true,
        category: 'FINANCIAL',
      },
      {
        name: 'profit_margin',
        displayName: 'Margem de Lucro',
        description: 'Percentual de lucro sobre a receita ((receita - despesa) / receita)',
        dataSource: 'financial',
        expression: '(SUM(revenue) - SUM(expense)) / NULLIF(SUM(revenue), 0)',
        unit: '%',
        format: 'percent',
        isBuiltIn: true,
        category: 'FINANCIAL',
      },
      {
        name: 'inventory_turnover',
        displayName: 'Giro de Estoque',
        description: 'Quantidade vendida dividida pelo estoque médio',
        dataSource: 'inventory',
        expression: 'SUM(quantity_sold) / NULLIF(AVG(stock_quantity), 0)',
        unit: 'x',
        format: 'number',
        isBuiltIn: true,
        category: 'OPERATIONAL',
      },
      {
        name: 'days_payable',
        displayName: 'Prazo Médio de Pagamento',
        description: 'Média de dias para pagamento de contas a pagar',
        dataSource: 'financial',
        expression: 'AVG(daysToPayment)',
        unit: 'days',
        format: 'number',
        isBuiltIn: true,
        category: 'FINANCIAL',
      },
      {
        name: 'collection_rate',
        displayName: 'Taxa de Recebimento',
        description: 'Percentual de contas a receber pagas sobre o total',
        dataSource: 'financial',
        expression: 'SUM(paidReceivables) / NULLIF(SUM(totalReceivables), 0)',
        unit: '%',
        format: 'percent',
        isBuiltIn: true,
        category: 'FINANCIAL',
      },
    ];
  }

  // ─── Built-in Dimensions ─────────────────────────────────────────────────────

  getBuiltInDimensions(): BuiltInDimension[] {
    return [
      {
        name: 'product',
        displayName: 'Produto',
        description: 'Produto vendido ou em estoque',
        dataSource: 'sales',
        field: 'productId',
        isBuiltIn: true,
      },
      {
        name: 'customer',
        displayName: 'Cliente',
        description: 'Cliente do pedido de venda',
        dataSource: 'sales',
        field: 'customerId',
        isBuiltIn: true,
      },
      {
        name: 'supplier',
        displayName: 'Fornecedor',
        description: 'Fornecedor de materiais e compras',
        dataSource: 'inventory',
        field: 'supplierId',
        isBuiltIn: true,
      },
      {
        name: 'warehouse',
        displayName: 'Armazém',
        description: 'Localização física do estoque',
        dataSource: 'inventory',
        field: 'warehouseId',
        isBuiltIn: true,
      },
      {
        name: 'region',
        displayName: 'Região',
        description: 'Região geográfica do cliente',
        dataSource: 'sales',
        field: 'region',
        hierarchy: 'region > state > city',
        isBuiltIn: true,
      },
      {
        name: 'state',
        displayName: 'Estado',
        description: 'Estado (UF) do cliente',
        dataSource: 'sales',
        field: 'state',
        hierarchy: 'region > state > city',
        isBuiltIn: true,
      },
      {
        name: 'city',
        displayName: 'Cidade',
        description: 'Cidade do cliente',
        dataSource: 'sales',
        field: 'city',
        hierarchy: 'region > state > city',
        isBuiltIn: true,
      },
      {
        name: 'category',
        displayName: 'Categoria',
        description: 'Categoria do produto',
        dataSource: 'sales',
        field: 'categoryId',
        isBuiltIn: true,
      },
    ];
  }

  // ─── Metrics CRUD ─────────────────────────────────────────────────────────────

  async findMetrics(companyId: string) {
    const builtIn = this.getBuiltInMetrics();
    const custom = await this.prisma.metricDefinition.findMany({
      where: { companyId, isBuiltIn: false },
      orderBy: { createdAt: 'asc' },
    });
    return [...builtIn, ...custom];
  }

  async createMetric(companyId: string, data: CreateMetricDto) {
    const existing = await this.prisma.metricDefinition.findFirst({
      where: { companyId, name: data.name },
    });
    if (existing) {
      throw new BusinessException(
        `Metric '${data.name}' already exists for this company`,
        HttpStatus.CONFLICT,
      );
    }
    const builtInNames = this.getBuiltInMetrics().map((m) => m.name);
    if (builtInNames.includes(data.name)) {
      throw new BusinessException(
        `Cannot override built-in metric '${data.name}'`,
        HttpStatus.CONFLICT,
      );
    }
    return this.prisma.metricDefinition.create({
      data: {
        companyId,
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        dataSource: data.dataSource,
        expression: data.expression,
        unit: data.unit,
        format: data.format,
        category: data.category,
        isBuiltIn: false,
      },
    });
  }

  // ─── Dimensions CRUD ──────────────────────────────────────────────────────────

  async findDimensions(companyId: string) {
    const builtIn = this.getBuiltInDimensions();
    const custom = await this.prisma.dimensionDefinition.findMany({
      where: { companyId, isBuiltIn: false },
      orderBy: { createdAt: 'asc' },
    });
    return [...builtIn, ...custom];
  }

  async createDimension(companyId: string, data: CreateDimensionDto) {
    const existing = await this.prisma.dimensionDefinition.findFirst({
      where: { companyId, name: data.name },
    });
    if (existing) {
      throw new BusinessException(
        `Dimension '${data.name}' already exists for this company`,
        HttpStatus.CONFLICT,
      );
    }
    const builtInNames = this.getBuiltInDimensions().map((d) => d.name);
    if (builtInNames.includes(data.name)) {
      throw new BusinessException(
        `Cannot override built-in dimension '${data.name}'`,
        HttpStatus.CONFLICT,
      );
    }
    return this.prisma.dimensionDefinition.create({
      data: {
        companyId,
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        dataSource: data.dataSource,
        field: data.field,
        hierarchy: data.hierarchy,
        isBuiltIn: false,
      },
    });
  }

  // ─── Data Dictionary ──────────────────────────────────────────────────────────

  async getDataDictionary(companyId: string) {
    const metrics = await this.findMetrics(companyId);
    const dimensions = await this.findDimensions(companyId);

    return {
      metrics: metrics.map((m) => ({
        name: m.name,
        displayName: m.displayName,
        description: m.description ?? null,
        dataSource: m.dataSource,
        expression: m.expression,
        unit: m.unit ?? null,
        format: m.format ?? null,
        category: m.category ?? null,
        isBuiltIn: m.isBuiltIn,
      })),
      dimensions: dimensions.map((d) => ({
        name: d.name,
        displayName: d.displayName,
        description: d.description ?? null,
        dataSource: d.dataSource,
        field: d.field,
        hierarchy: d.hierarchy ?? null,
        isBuiltIn: d.isBuiltIn,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
