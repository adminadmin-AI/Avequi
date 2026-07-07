import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationController } from './notification.controller';
import { PushService } from './push.service';

/** CRM V2.1 (#568) — web push (VAPID) p/ speed-to-lead no celular do vendedor */
@Module({
  imports: [PrismaModule],
  controllers: [NotificationController],
  providers: [PushService],
  exports: [PushService],
})
export class NotificationModule {}
