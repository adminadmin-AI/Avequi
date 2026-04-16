import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RoutingService } from './routing.service';
import { CreateRoutingStepDto } from './dto/create-routing-step.dto';
import { UpdateRoutingStepDto } from './dto/update-routing-step.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('routing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('routing')
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  @Post()
  @Roles('DIRECTOR', 'MANAGER', 'PRODUCTION')
  @ApiOperation({ summary: 'Criar etapa de roteiro de produção' })
  create(@Body() dto: CreateRoutingStepDto, @CurrentUser() user: any) {
    return this.routingService.create(dto, user);
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Listar etapas de roteiro por produto' })
  @ApiQuery({ name: 'companyId', required: true })
  findByProduct(
    @Param('productId') productId: string,
    @Query('companyId') companyId: string,
  ) {
    return this.routingService.findByProduct(productId, companyId);
  }

  @Patch(':id')
  @Roles('DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Atualizar etapa de roteiro' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoutingStepDto,
    @CurrentUser() user: any,
  ) {
    return this.routingService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Remover etapa de roteiro' })
  @ApiQuery({ name: 'companyId', required: true })
  remove(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @CurrentUser() user: any,
  ) {
    return this.routingService.remove(id, companyId, user);
  }
}
