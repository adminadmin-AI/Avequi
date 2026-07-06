import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CrmController } from './crm.controller';
import { LeadIntakeService } from './lead-intake.service';

@Module({
  imports: [PrismaModule],
  controllers: [CrmController],
  providers: [LeadIntakeService],
  exports: [LeadIntakeService],
})
export class CrmModule {}
