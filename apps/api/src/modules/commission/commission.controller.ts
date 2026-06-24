import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommissionService } from './commission.service';

@ApiTags('commissions')
@ApiBearerAuth()
@Controller('commissions')
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  @Get()
  @ApiOperation({ summary: 'Listar comissões (#191)' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'PAID'] })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  findAll(
    @CurrentUser() user: any,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.commissionService.findAll(user.companyId, { userId, status, from, to });
  }

  @Post('approve-batch')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'FINANCIAL')
  @ApiOperation({ summary: 'Aprovar comissões em lote → gera payables (#191)' })
  approveBatch(
    @Body() body: { commissionIds: string[] },
    @CurrentUser() user: any,
  ) {
    return this.commissionService.approveBatch(user.companyId, body.commissionIds, user.id);
  }

  @Post('rules')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Criar regra de comissão (#191)' })
  createRule(@Body() body: any) {
    return this.commissionService.createRule(body);
  }

  @Get('rules')
  @ApiOperation({ summary: 'Listar regras de comissão' })
  findRules(@CurrentUser() user: any) {
    return this.commissionService.findRules(user.companyId);
  }
}
