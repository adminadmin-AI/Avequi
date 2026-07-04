import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  // #345: PasswordPolicyService (IamModule) — política aplicada também no
  // create/update de usuário pelo admin.
  imports: [IamModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
