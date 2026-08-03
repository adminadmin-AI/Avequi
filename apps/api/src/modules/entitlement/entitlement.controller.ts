import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EntitlementService } from './entitlement.service';

/**
 * EntitlementController — OPS WP4 (#911): o app pergunta o que a PRÓPRIA
 * conta contratou (nav esconde módulo não contratado, mesmo espírito
 * fail-closed do NavItem.permission #351). Qualquer usuário autenticado do
 * tenant pode ler — é o contrato comercial da conta dele, não segredo.
 */
@ApiTags('entitlements')
@ApiBearerAuth()
@Controller('entitlements')
export class EntitlementController {
  constructor(private readonly entitlementService: EntitlementService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Entitlements efetivos da MINHA conta (plano + exceções resolvidos)',
  })
  me(@CurrentUser() user: { companyId: string }) {
    return this.entitlementService.resolve(user.companyId);
  }
}
