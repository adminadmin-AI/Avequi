import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SchedulingService } from './scheduling.service';

@ApiTags('Sequenciamento de Produção')
@ApiBearerAuth()
@Controller('production/schedule')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Post('generate/:workCenterId')
  @RequirePermission('production.scheduling.generate')
  @ApiOperation({ summary: 'Gerar schedule para um WorkCenter (backward scheduling)' })
  generate(@Param('workCenterId') workCenterId: string, @CurrentUser() user: any) {
    return this.schedulingService.generateSchedule(user.companyId, workCenterId);
  }

  @Get()
  @RequirePermission('production.scheduling.view')
  @ApiOperation({ summary: 'Listar schedule de produção' })
  @ApiQuery({ name: 'workCenterId', required: false })
  getSchedule(@CurrentUser() user: any, @Query('workCenterId') workCenterId?: string) {
    return this.schedulingService.getSchedule(user.companyId, workCenterId);
  }

  @Get('gantt')
  @RequirePermission('production.scheduling.view')
  @ApiOperation({ summary: 'Dados para Gantt chart' })
  getGantt(@CurrentUser() user: any) {
    return this.schedulingService.getGanttData(user.companyId);
  }
}
