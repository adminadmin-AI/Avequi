import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SELECT_SAFE = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto, companyId: string) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { password: _pw, ...rest } = dto;
    return this.prisma.user.create({
      data: { ...rest, companyId, passwordHash },
      select: SELECT_SAFE,
    });
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
    await this.findOne(id, companyId);
    // Defesa em profundidade: descarta password (hash separado) e qualquer
    // companyId injetado no payload — usuário nunca muda de empresa via update
    const { password, companyId: _ignored, ...rest } = dto as any;
    const data: any = { ...rest };
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }
    return this.prisma.user.update({
      where: { id },
      data,
      select: SELECT_SAFE,
    });
  }
}
