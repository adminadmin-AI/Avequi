import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SELECT_SAFE = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  companyId: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  async create(dto: CreateUserDto) {
    // #345: senha definida pelo admin também passa pela política de
    // complexidade (inclusive não conter o nome/e-mail do NOVO usuário).
    this.passwordPolicy.validateComplexity(dto.password, {
      email: dto.email,
      name: dto.name,
    });

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { password: _pw, ...rest } = dto;
    const user = await this.prisma.user.create({
      // #345: passwordChangedAt marca a criação; mustChangePassword=true
      // (opcional no DTO) força a troca no primeiro login.
      data: { ...rest, passwordHash, passwordChangedAt: new Date() },
      select: SELECT_SAFE,
    });

    // #345: hash inicial entra no histórico — o bloqueio de reuso das
    // últimas 5 senhas vale desde a primeira troca (best-effort).
    await this.passwordPolicy.recordPasswordChange(user.id, null, passwordHash);

    return user;
  }

  async findAll(requestingUser: { role: string; companyId: string }) {
    const where =
      requestingUser.role === 'SUPER_ADMIN'
        ? {}
        : { companyId: requestingUser.companyId };

    return this.prisma.user.findMany({
      where,
      select: SELECT_SAFE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: SELECT_SAFE,
    });
    if (!user) throw new NotFoundException(`Usuário ${id} não encontrado`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto, companyId: string) {
    const existing = await this.findOne(id, companyId);
    const { password, ...rest } = dto;
    const data: any = { ...rest };
    let previousHash: string | null = null;
    if (password) {
      // #345: reset de senha por admin também obedece à política —
      // complexidade + bloqueio de reuso das últimas 5 senhas do usuário.
      this.passwordPolicy.validateComplexity(password, {
        email: dto.email ?? existing.email,
        name: dto.name ?? existing.name,
      });
      await this.passwordPolicy.assertNotReused(id, password);

      // Hash atual ANTES do update — na primeira troca ele entra no histórico.
      const current = await this.prisma.user.findUnique({
        where: { id },
        select: { passwordHash: true },
      });
      previousHash = current?.passwordHash ?? null;

      data.passwordHash = await bcrypt.hash(password, 10);
      data.passwordChangedAt = new Date();
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: SELECT_SAFE,
    });

    if (password) {
      // #345: registra a troca no histórico (best-effort).
      await this.passwordPolicy.recordPasswordChange(id, previousHash, data.passwordHash);
    }

    return updated;
  }
}
