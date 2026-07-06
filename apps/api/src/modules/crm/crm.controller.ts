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

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(
    private readonly leadIntake: LeadIntakeService,
    private readonly crm: CrmService,
  ) {}

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
