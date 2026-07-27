import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SupportListener } from './support.listener';
import { GithubIssueService } from './github-issue.service';
import { TriageProcessor } from './triage.processor';
import { TRIAGE_QUEUE } from './support.types';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: TRIAGE_QUEUE })],
  controllers: [SupportController],
  providers: [SupportService, SupportListener, GithubIssueService, TriageProcessor],
  exports: [SupportService],
})
export class SupportModule {}
