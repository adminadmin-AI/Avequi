import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * TenantMiddleware — sets app.current_company_id on the PostgreSQL session
 * so that RLS policies can enforce tenant isolation at the database level.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const user = (req as any).user;
    if (user?.companyId) {
      await this.prisma.$executeRawUnsafe(
        `SET LOCAL app.current_company_id = '${user.companyId.replace(/'/g, "''")}'`,
      );
    }
    next();
  }
}
