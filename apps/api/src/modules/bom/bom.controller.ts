import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BomService } from './bom.service';
import { CreateBomDto } from './dto/create-bom.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('bom')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bom')
export class BomController {
  constructor(private readonly bomService: BomService) {}

  @Post()
  @Roles('DIRECTOR', 'MANAGER', 'PRODUCTION')
  @ApiOperation({ summary: 'Criar nova versão de BOM' })
  create(@Body() dto: CreateBomDto, @CurrentUser() user: any) {
    return this.bomService.create(dto, user);
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Listar todas as versões de BOM por produto' })
  @ApiQuery({ name: 'companyId', required: true })
  findByProduct(
    @Param('productId') productId: string,
    @Query('companyId') companyId: string,
  ) {
    return this.bomService.findByProduct(productId, companyId);
  }

  @Get('product/:productId/active')
  @ApiOperation({ summary: 'Obter versão ativa de BOM para produto' })
  @ApiQuery({ name: 'companyId', required: true })
  findActive(
    @Param('productId') productId: string,
    @Query('companyId') companyId: string,
  ) {
    return this.bomService.findActive(productId, companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter versão de BOM por ID' })
  @ApiQuery({ name: 'companyId', required: true })
  findOne(@Param('id') id: string, @Query('companyId') companyId: string) {
    return this.bomService.findOne(id, companyId);
  }

  @Patch(':id/activate')
  @Roles('DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Ativar versão de BOM' })
  @ApiQuery({ name: 'companyId', required: true })
  activate(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @CurrentUser() user: any,
  ) {
    return this.bomService.activate(id, companyId, user);
  }
}
