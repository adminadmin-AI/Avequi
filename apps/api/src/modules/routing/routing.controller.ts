import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoutingService } from './routing.service';
import { CreateRoutingStepDto } from './dto/create-routing-step.dto';
import { UpdateRoutingStepDto } from './dto/update-routing-step.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('routing')
@ApiBearerAuth()
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
  findByProduct(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.routingService.findByProduct(productId, user.companyId);
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
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.routingService.remove(id, user.companyId, user);
  }
}
