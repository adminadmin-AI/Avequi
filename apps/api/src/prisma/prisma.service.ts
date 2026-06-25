import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Returns a transactional Prisma client that sets the tenant context
   * for RLS policies before executing any query.
   *
   * Usage:
   *   const result = await this.prisma.$transactionWithTenant(companyId, async (tx) => {
   *     return tx.product.findMany();
   *   });
   */
  async $transactionWithTenant<T>(
    companyId: string,
    fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_company_id = '${companyId.replace(/'/g, "''")}'`,
      );
      return fn(tx);
    });
  }
}
