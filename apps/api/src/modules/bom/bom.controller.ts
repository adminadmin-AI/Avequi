import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BomService } from './bom.service';
import { CreateBomDto } from './dto/create-bom.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('bom')
@ApiBearerAuth()
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
  findByProduct(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.bomService.findByProduct(productId, user.companyId);
  }

  @Get('product/:productId/active')
  @ApiOperation({ summary: 'Obter versão ativa de BOM para produto' })
  findActive(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.bomService.findActive(productId, user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter versão de BOM por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bomService.findOne(id, user.companyId);
  }

  @Patch(':id/activate')
  @Roles('DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Ativar versão de BOM' })
  activate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bomService.activate(id, user.companyId, user);
  }
}
