import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTOs da estrutura organizacional (Filiais, Departamentos, Equipes) e dos
 * vínculos usuário ↔ departamento/equipe — issue #347 (IAM F5.2, fase 1).
 *
 * FASE 1 = CRUD + vínculos APENAS (Decisão 3 do schema #462): departamentos e
 * equipes NÃO participam do cálculo de permissões ainda. O ENFORCEMENT de
 * escopo (filtro automático de dados por filial/departamento) é a fase 2.
 *
 * O escopo por companyId NUNCA vem no body: é sempre o do JWT (anti-IDOR).
 */

/** Formato de código: MAIÚSCULO, dígitos, hífen e underscore (ex.: CWB, PROD-A). */
const ORG_CODE_REGEX = /^[A-Z][A-Z0-9_-]*$/;

// ─── Filiais ──────────────────────────────────────────────────────────────────

export class CreateBranchDto {
  @ApiProperty({ description: 'Nome da filial', example: 'Filial Curitiba' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    description: 'Código único na empresa (MAIÚSCULO; ex.: CWB, JOI, GUA)',
    example: 'CWB',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  @Matches(ORG_CODE_REGEX, {
    message: 'code deve ser MAIÚSCULO (letras, números, hífen/underscore) — ex.: CWB',
  })
  code!: string;

  @ApiPropertyOptional({ description: 'CNPJ da filial (somente dígitos ou formatado)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnpj?: string;
}

export class UpdateBranchDto {
  @ApiPropertyOptional({ description: 'Nome da filial' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: 'CNPJ da filial' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnpj?: string;

  @ApiPropertyOptional({ description: 'Filial ativa?' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Departamentos ────────────────────────────────────────────────────────────

export class CreateDepartmentDto {
  @ApiProperty({ description: 'Nome do departamento', example: 'Produção' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    description: 'Código único na empresa (MAIÚSCULO; ex.: PRODUCAO, COMERCIAL)',
    example: 'PRODUCAO',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(ORG_CODE_REGEX, {
    message: 'code deve ser MAIÚSCULO (letras, números, hífen/underscore) — ex.: PRODUCAO',
  })
  code!: string;

  @ApiPropertyOptional({
    description: 'ID do departamento pai (hierarquia; null = raiz)',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: 'ID do usuário gerente do departamento' })
  @IsOptional()
  @IsString()
  managerId?: string;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ description: 'Nome do departamento' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    description: 'ID do departamento pai (string vazia ou null remove o pai)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({
    description: 'ID do usuário gerente (string vazia ou null remove)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  managerId?: string | null;

  @ApiPropertyOptional({ description: 'Departamento ativo?' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Equipes ──────────────────────────────────────────────────────────────────

export class CreateTeamDto {
  @ApiProperty({ description: 'Nome da equipe', example: 'Turno A' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ description: 'ID do departamento ao qual a equipe pertence' })
  @IsString()
  departmentId!: string;

  @ApiPropertyOptional({ description: 'ID do usuário líder da equipe' })
  @IsOptional()
  @IsString()
  leaderId?: string;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ description: 'Nome da equipe' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: 'ID do departamento (mover a equipe)' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({
    description: 'ID do usuário líder (string vazia ou null remove)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  leaderId?: string | null;

  @ApiPropertyOptional({ description: 'Equipe ativa?' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Vínculos usuário ↔ departamento / equipe ────────────────────────────────

export class AddUserDepartmentDto {
  @ApiProperty({ description: 'ID do departamento a vincular ao usuário' })
  @IsString()
  departmentId!: string;

  @ApiPropertyOptional({
    description:
      'Departamento principal do usuário? (apenas um por usuário; marcar aqui desmarca o anterior)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class AddUserTeamDto {
  @ApiProperty({ description: 'ID da equipe a vincular ao usuário' })
  @IsString()
  teamId!: string;
}
