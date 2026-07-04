import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTOs da administração de perfis e permissões — issue #352 (IAM F7.2).
 *
 * O escopo por companyId NUNCA vem no body: é sempre o do JWT (anti-IDOR).
 * Perfis system (isSystem=true) são imutáveis por estas rotas — a fonte da
 * verdade deles é o catálogo em código (roles.catalog.ts) + seed.
 */

/** Formato de código de perfil: MAIÚSCULO_COM_UNDERSCORE (igual aos system). */
const ROLE_CODE_REGEX = /^[A-Z][A-Z0-9_]*$/;

export class CreateRoleDto {
  @ApiProperty({ description: 'Nome legível do perfil (pt-BR)', example: 'Comprador Júnior' })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Código único (MAIÚSCULO_COM_UNDERSCORE). Se omitido, é derivado do nome.',
    example: 'COMPRADOR_JUNIOR',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  @Matches(ROLE_CODE_REGEX, {
    message: 'code deve ser MAIÚSCULO_COM_UNDERSCORE (ex.: COMPRADOR_JUNIOR)',
  })
  code?: string;

  @ApiPropertyOptional({ description: 'Descrição do perfil' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description:
      'ID de um perfil existente (system ou custom da empresa) cujas permissões serão COPIADAS como ponto de partida (duplicar perfil).',
  })
  @IsOptional()
  @IsString()
  copyFromRoleId?: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ description: 'Nome legível do perfil' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: 'Descrição do perfil' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Perfil ativo? (inativo = ignorado no cálculo de permissões)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetRolePermissionsDto {
  @ApiProperty({
    description:
      'Conjunto COMPLETO de codes de permissão do perfil (substitui o atual, transacional). Codes do catálogo (modulo.recurso.acao).',
    type: [String],
    example: ['sales.orders.view', 'sales.orders.create'],
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  codes!: string[];
}

export class AssignRoleDto {
  @ApiProperty({ description: 'ID do perfil a atribuir ao usuário' })
  @IsString()
  roleId!: string;

  @ApiPropertyOptional({ description: 'ID da filial (null = todas as filiais)' })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Expiração da atribuição (ISO 8601; null = permanente)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class GrantUserPermissionDto {
  @ApiProperty({
    description: 'Code da permissão do catálogo (modulo.recurso.acao)',
    example: 'finance.entries.pay',
  })
  @IsString()
  permissionCode!: string;

  @ApiPropertyOptional({
    description: 'true = grant (concede além dos perfis); false = deny (bloqueia mesmo que um perfil conceda). Default: true.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  granted?: boolean;

  @ApiPropertyOptional({ description: 'Expiração da exceção (ISO 8601; null = permanente)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Justificativa da exceção (auditável)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
