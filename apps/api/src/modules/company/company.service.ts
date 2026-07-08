import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/** Recorte mínimo do usuário do JWT usado para o escopo de empresa. */
export interface CompanyScopeUser {
  companyId: string;
  role?: string;
}

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Escopo GLOBAL (multiempresa) — FIX anti-IDOR #620.
   *
   * O modelo de escopo multiempresa/grupo ainda não existe no IAM v2 (é a
   * fase 2 da #347). Até lá, o marcador de escopo global é o SUPER_ADMIN
   * legado, que o seed espelha 1:1 em ADMIN_GLOBAL (mesmo critério já usado
   * pelo SessionService para revogação de sessões). Quando o escopo
   * empresa/grupo for modelado, este método passa a consultá-lo.
   * NOTA: isto é recorte de DADOS (tenant), não gate de rota — o gate é o
   * @RequirePermission('settings.companies.*') no controller.
   */
  private hasGlobalScope(user?: CompanyScopeUser): boolean {
    return user?.role === 'SUPER_ADMIN';
  }

  /** Garante que a empresa `id` está no escopo do usuário; senão, 404
   *  (anti-enumeração: mesma resposta de empresa inexistente). */
  private assertInScope(id: string, user?: CompanyScopeUser): void {
    if (user && !this.hasGlobalScope(user) && id !== user.companyId) {
      throw new NotFoundException(`Empresa ${id} não encontrada`);
    }
  }

  async create(dto: CreateCompanyDto) {
    return this.prisma.company.create({ data: dto });
  }

  async findAll(user?: CompanyScopeUser) {
    if (!user || this.hasGlobalScope(user)) {
      return this.prisma.company.findMany({
        orderBy: { createdAt: 'desc' },
      });
    }
    return this.prisma.company.findMany({
      where: { id: user.companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user?: CompanyScopeUser) {
    this.assertInScope(id, user);
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException(`Empresa ${id} não encontrada`);
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto, user?: CompanyScopeUser) {
    this.assertInScope(id, user);
    await this.findOne(id, user);
    return this.prisma.company.update({ where: { id }, data: dto });
  }
}
