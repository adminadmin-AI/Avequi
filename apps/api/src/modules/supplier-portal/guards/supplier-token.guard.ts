import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SupplierTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string = request.headers['authorization'] ?? '';
    const xToken: string = request.headers['x-supplier-token'] ?? '';

    const raw = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : xToken;
    if (!raw) throw new UnauthorizedException('Token de fornecedor não fornecido');

    const tokenRecord = await this.prisma.supplierToken.findUnique({
      where: { token: raw },
      include: { supplier: true },
    });

    if (!tokenRecord) throw new UnauthorizedException('Token inválido');
    if (tokenRecord.revokedAt) throw new UnauthorizedException('Token revogado');
    if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Token expirado');
    }

    // Update lastUsedAt (fire and forget)
    this.prisma.supplierToken
      .update({
        where: { id: tokenRecord.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    request.supplier = {
      id: tokenRecord.supplier.id,
      name: tokenRecord.supplier.name,
      companyId: tokenRecord.supplier.companyId,
      tokenId: tokenRecord.id,
    };

    return true;
  }
}
