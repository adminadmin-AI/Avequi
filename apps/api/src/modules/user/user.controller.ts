import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUiPreferencesDto } from './dto/update-ui-preferences.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
// Dados de usuários são sensíveis: leitura também restrita
/**
 * #341 parte 2 (bloco G): gate unico RBAC v2 (#625). settings.users.* e
 * leitura restrita e o CORTE do legado vale: DIRETOR/GERENTE_GERAL nao
 * criam/editam usuario no v2 (fica com RH e admins - decisao Rafael).
 */
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @RequirePermission('settings.users.create')
  @ApiOperation({ summary: 'Criar novo usuário' })
  create(@Body() dto: CreateUserDto, @CurrentUser() user: any) {
    // #738: user.id (do JWT) é o ATOR — vira grantedBy do vínculo v2 espelho;
    // nunca vem do body.
    return this.userService.create(dto, user.companyId, user.id);
  }

  @Get()
  @RequirePermission('settings.users.view')
  @ApiOperation({ summary: 'Listar usuários (filtro por empresa, exceto SUPER_ADMIN)' })
  findAll(@CurrentUser() user: any) {
    return this.userService.findAll(user);
  }

  // ── Preferências de UI (#975) — dado do PRÓPRIO usuário, qualquer
  // autenticado (mesmo espírito do entitlements/me; sem settings.users.*).
  // Rotas ESTÁTICAS declaradas antes de :id — sentinela #699.

  @Get('me/preferences')
  @ApiOperation({ summary: 'Preferências de UI do usuário logado (favoritos da sidebar)' })
  getUiPreferences(@CurrentUser() user: any) {
    return this.userService.getUiPreferences(user);
  }

  @Put('me/preferences')
  @ApiOperation({ summary: 'Salvar preferências de UI do usuário logado' })
  saveUiPreferences(@Body() dto: UpdateUiPreferencesDto, @CurrentUser() user: any) {
    return this.userService.saveUiPreferences(user, dto);
  }

  @Get(':id')
  @RequirePermission('settings.users.view')
  @ApiOperation({ summary: 'Buscar usuário por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.userService.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission('settings.users.update')
  @ApiOperation({ summary: 'Atualizar usuário' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: any) {
    // user.id (do JWT) identifica o ATOR — usado pelo bloqueio de
    // autoinativação; nunca vem do body.
    return this.userService.update(id, dto, user);
  }
}
