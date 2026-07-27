import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SupportListener } from './support.listener';
import { GithubIssueService } from './github-issue.service';

@Module({
  imports: [PrismaModule],
  controllers: [SupportController],
  providers: [SupportService, SupportListener, GithubIssueService],
  exports: [SupportService],
})
export class SupportModule {}
