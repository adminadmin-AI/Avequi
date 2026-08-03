import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EntitlementController } from './entitlement.controller';
import { EntitlementService } from './entitlement.service';

/**
 * EntitlementModule — OPS WP4 (#911).
 * @Global porque o EntitlementGuard é APP_GUARD (roda em toda request) e o
 * service é consumido por módulos de domínio (ex.: user p/ maxUsers) — mesmo
 * racional do PrismaModule. O service NÃO é cross-tenant: responde sempre
 * pela conta do companyId recebido.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [EntitlementController],
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
