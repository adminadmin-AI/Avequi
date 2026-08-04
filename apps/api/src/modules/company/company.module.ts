import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  // #947: TenantScopeService (IamModule) — o escopo multiempresa passou a ser
  // resolvido por permissão estrutural, não pelo enum legado.
  imports: [IamModule],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
