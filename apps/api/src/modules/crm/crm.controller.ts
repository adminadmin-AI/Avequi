import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CrmService } from './crm.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import { LeadIntakeService } from './lead-intake.service';
import { FunnelService } from './funnel.service';
import { LeadConversionService } from './lead-conversion.service';

class ReassignLeadDto {
  @ApiProperty({ description: 'Vendedor destino' })
  @IsString()
  toUserId: string;
}

class ChangeStageDto {
  @ApiProperty({ description: 'Estágio destino' })
  @IsString()
  stageId: string;

  @ApiPropertyOptional({ description: 'Obrigatório quando o estágio destino é Perdido' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;
}

class MoveLeadDto {
  @ApiProperty({ description: 'Estágio destino' })
  @IsString()
  stageId: string;

  @ApiPropertyOptional({ description: 'Lead que fica acima (posição menor)' })
  @IsOptional()
  @IsString()
  beforeLeadId?: string;

  @ApiPropertyOptional({ description: 'Lead que fica abaixo (posição maior)' })
  @IsOptional()
  @IsString()
  afterLeadId?: string;

  @ApiPropertyOptional({ description: 'Obrigatório quando o destino é Perdido' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;
}

class LinkOrderDto {
  @ApiProperty({ description: 'Ordem de venda a vincular ao lead' })
  @IsString()
  salesOrderId: string;
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(
    private readonly leadIntake: LeadIntakeService,
    private readonly crm: CrmService,
    private readonly funnel: FunnelService,
    private readonly conversion: LeadConversionService,
  ) {}

  // ── Funil / kanban (F2.1 #514) ──────────────────────────────────────────────

  @Get('board')
  @ApiOperation({ summary: 'Board kanban do funil (estágios + leads por coluna)' })
  @ApiQuery({ name: 'scope', required: false, enum: ['mine', 'all'] })
  @ApiQuery({ name: 'source', required: false })
  board(
    @CurrentUser() user: any,
    @Query('scope') scope?: 'mine' | 'all',
    @Query('source') source?: string,
  ) {
    return this.funnel.board({
      companyId: user.companyId,
      assignedToId: scope === 'mine' ? user.id : undefined,
      source,
    });
  }

  @Patch('leads/:id/move')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Mover lead no kanban (estágio + posição drag&drop)' })
  move(@Param('id') id: string, @Body() dto: MoveLeadDto, @CurrentUser() user: any) {
    return this.funnel.moveLead(user.companyId, id, dto, user.id);
  }

  @Get('lost-reasons')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Motivos de perda agregados' })
  lostReasons(@CurrentUser() user: any) {
    return this.funnel.lostReasons(user.companyId);
  }

  // ── SLA (F2.3 #516) ─────────────────────────────────────────────────────────

  @Get('sla')
  @ApiOperation({ summary: 'Painel de SLA: leads estourando e esfriando' })
  @ApiQuery({ name: 'scope', required: false, enum: ['mine', 'all'] })
  sla(@CurrentUser() user: any, @Query('scope') scope?: 'mine' | 'all') {
    return this.funnel.slaPanel(user.companyId, scope === 'mine' ? user.id : undefined);
  }

  // ── Conversão (F2.2 #515) ───────────────────────────────────────────────────

  @Post('leads/:id/convert')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Converter lead em cliente (pré-preenche a OV)' })
  convert(@Param('id') id: string, @CurrentUser() user: any) {
    return this.conversion.convertToCustomer(user.companyId, id, user.id);
  }

  @Post('leads/:id/link-order')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Vincular OV criada ao lead (fecha via SALE_INVOICED)' })
  linkOrder(@Param('id') id: string, @Body() dto: LinkOrderDto, @CurrentUser() user: any) {
    return this.conversion.linkSalesOrder(user.companyId, id, dto.salesOrderId);
  }

  // ── Inbox (F1.3 #509) ──────────────────────────────────────────────────────

  @Get('conversations')
  @ApiOperation({ summary: 'Conversas WhatsApp da loja (inbox)' })
  @ApiQuery({ name: 'scope', required: false, enum: ['mine', 'all'] })
  @ApiQuery({ name: 'search', required: false })
  conversations(
    @CurrentUser() user: any,
    @Query('scope') scope?: 'mine' | 'all',
    @Query('search') search?: string,
  ) {
    return this.crm.listConversations(user.companyId, {
      scope: scope === 'mine' ? 'mine' : 'all',
      search,
      userId: user.id,
    });
  }

  @Get('stages')
  @ApiOperation({ summary: 'Estágios do funil da loja' })
  stages(@CurrentUser() user: any) {
    return this.crm.listStages(user.companyId);
  }

  // ── Leads ──────────────────────────────────────────────────────────────────

  @Post('leads')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Registrar lead manualmente (telefone/balcão) — F1.6' })
  create(@Body() dto: IntakeLeadDto, @CurrentUser() user: any) {
    return this.leadIntake.intake(user.companyId, dto);
  }

  @Get('leads/distribution')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Distribuição de leads por vendedor no dia (rodízio)' })
  @ApiQuery({ name: 'day', required: false, description: 'YYYY-MM-DD (default: hoje)' })
  distribution(@CurrentUser() user: any, @Query('day') day?: string) {
    return this.leadIntake.distributionReport(user.companyId, day);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'Detalhe do lead com timeline (painel do inbox)' })
  lead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.crm.getLead(user.companyId, id);
  }

  @Patch('leads/:id/stage')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Troca rápida de estágio (Perdido exige motivo)' })
  changeStage(
    @Param('id') id: string,
    @Body() dto: ChangeStageDto,
    @CurrentUser() user: any,
  ) {
    return this.crm.changeStage(user.companyId, id, dto.stageId, user.id, dto.lostReason);
  }

  @Patch('leads/:id/assignee')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Reatribuir lead a outro vendedor (gerente)' })
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignLeadDto,
    @CurrentUser() user: any,
  ) {
    return this.leadIntake.reassign(user.companyId, id, dto.toUserId, user.id);
  }
}
