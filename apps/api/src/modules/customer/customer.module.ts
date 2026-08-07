import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { IamModule } from '../iam/iam.module';

// IamModule entrou na #1032: exportCsv audita via AuditService (LGPD —
// export de base de clientes é dado saindo do sistema).
@Module({
  imports: [PrismaModule, IamModule],
  controllers: [CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}
