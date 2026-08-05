import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { CommissionService } from './commission.service';
import { CommissionController } from './commission.controller';

@Module({
  // #1001-C2: o controller resolve `sales.commissions.view-all` no RBAC v2
  // para decidir se a leitura é ampla ou restrita ao próprio usuário.
  imports: [IamModule],
  controllers: [CommissionController],
  providers: [CommissionService],
  exports: [CommissionService],
})
export class CommissionModule {}
