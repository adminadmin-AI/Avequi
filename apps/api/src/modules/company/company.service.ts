import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantScopeService } from '../iam/tenant-scope.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/** Recorte mínimo do usuário do JWT usado para o escopo de empresa. */
export interface CompanyScopeUser {
  /** #947: o escopo passou a ser resolvido por PERMISSÃO, e permissão é do
   *  usuário — por isso o id virou obrigatório aqui. */
  id: string;
  companyId: string;
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  /**
   * Escopo empresarial do usuário — FIX anti-IDOR #620, agora por permissão.
   *
   * ANTES: `user.role === 'SUPER_ADMIN'` → `company.findMany({})`, isto é,
   * TODAS as empresas do banco, de todos os tenants. Agora (#947) a ampliação
   * é a capability `iam.tenant-scope.cross-company` e o alvo dela é o GRUPO
   * (empresa raiz + filiais) — nunca o banco inteiro.
   *
   * NOTA: isto é recorte de DADOS (tenant), não gate de rota — o gate é o
   * @RequirePermission('settings.companies.*') no controller.
   */
  private async escopoDe(user?: CompanyScopeUser): Promise<string[] | null> {
    if (!user) return null; // chamada interna/sistema: sem recorte
    const { companyIds } = await this.tenantScope.resolverEscopo(user.id, user.companyId);
    return companyIds;
  }

  /** Garante que a empresa `id` está no escopo do usuário; senão, 404
   *  (anti-enumeração: mesma resposta de empresa inexistente). */
  private async assertInScope(id: string, user?: CompanyScopeUser): Promise<void> {
    const escopo = await this.escopoDe(user);
    if (escopo && !escopo.includes(id)) {
      throw new NotFoundException(`Empresa ${id} não encontrada`);
    }
  }

  async create(dto: CreateCompanyDto) {
    return this.prisma.company.create({ data: dto });
  }

  async findAll(user?: CompanyScopeUser) {
    const escopo = await this.escopoDe(user);
    return this.prisma.company.findMany({
      // Sem escopo (chamada interna) não filtra; com escopo, SEMPRE uma lista
      // fechada de ids — não existe caminho que devolva "todas" para usuário.
      ...(escopo ? { where: { id: { in: escopo } } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user?: CompanyScopeUser) {
    await this.assertInScope(id, user);
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException(`Empresa ${id} não encontrada`);
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto, user?: CompanyScopeUser) {
    await this.assertInScope(id, user);
    await this.findOne(id, user);
    return this.prisma.company.update({ where: { id }, data: dto });
  }
}
