import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR B): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #620).
 *
 * FIX anti-IDOR (#620): listar/ver/editar empresa agora é ESCOPADO — usuário
 * comum só enxerga/edita a própria empresa do JWT. Antes, qualquer autenticado
 * listava TODAS as empresas do banco e o update aceitava qualquer id
 * (cross-tenant write).
 *
 * #947: a visão multiempresa deixou de ser o enum SUPER_ADMIN e passou a ser a
 * capability `iam.tenant-scope.cross-company` (TenantScopeService) — e o alvo
 * dela é o GRUPO da empresa (raiz + filiais), não o banco inteiro.
 */
@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @RequirePermission('settings.companies.create')
  @ApiOperation({ summary: 'Criar nova empresa (ação global do sistema)' })
  create(@Body() dto: CreateCompanyDto) {
    return this.companyService.create(dto);
  }

  @Get()
  @RequirePermission('settings.companies.view')
  @ApiOperation({ summary: 'Listar empresas acessíveis (todas só no escopo global)' })
  findAll(@CurrentUser() user: any) {
    return this.companyService.findAll(user);
  }

  @Get(':id')
  @RequirePermission('settings.companies.view')
  @ApiOperation({ summary: 'Buscar empresa por ID (404 fora do escopo)' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.companyService.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission('settings.companies.update')
  @ApiOperation({ summary: 'Atualizar empresa (escopado à própria empresa)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: any,
  ) {
    return this.companyService.update(id, dto, user);
  }
}
