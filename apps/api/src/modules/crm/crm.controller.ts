import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import { LeadIntakeService } from './lead-intake.service';

class ReassignLeadDto {
  @ApiProperty({ description: 'Vendedor destino' })
  @IsString()
  toUserId: string;
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/leads')
export class CrmController {
  constructor(private readonly leadIntake: LeadIntakeService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Registrar lead manualmente (telefone/balcão) — F1.6' })
  create(@Body() dto: IntakeLeadDto, @CurrentUser() user: any) {
    return this.leadIntake.intake(user.companyId, dto);
  }

  @Patch(':id/assignee')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Reatribuir lead a outro vendedor (gerente)' })
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignLeadDto,
    @CurrentUser() user: any,
  ) {
    return this.leadIntake.reassign(user.companyId, id, dto.toUserId, user.id);
  }

  @Get('distribution')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Distribuição de leads por vendedor no dia (rodízio)' })
  @ApiQuery({ name: 'day', required: false, description: 'YYYY-MM-DD (default: hoje)' })
  distribution(@CurrentUser() user: any, @Query('day') day?: string) {
    return this.leadIntake.distributionReport(user.companyId, day);
  }
}
