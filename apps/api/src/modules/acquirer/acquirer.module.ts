import { Module } from '@nestjs/common';
import { AcquirerService } from './acquirer.service';
import { AcquirerController } from './acquirer.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AcquirerController],
  providers: [AcquirerService],
  exports: [AcquirerService],
})
export class AcquirerModule {}
