import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * #1005 (IAM C6): CRUD da matriz de alçadas de aprovação.
 *
 * `approverRoles` são CODES de perfil v2 (Role.code) — o service ainda valida
 * cada um contra os perfis ativos, porque DTO não enxerga o banco.
 *
 * A condição é sempre sobre `amount` (único conditionField que o motor de
 * `getRequiredLevels` avalia); o par op+valor é opcional — sem ele, o nível
 * vale para qualquer valor.
 */
export class CreateApprovalMatrixDto {
  @ApiProperty({ enum: ['PO', 'PR'], description: 'Tipo de documento' })
  @IsIn(['PO', 'PR'])
  entityType!: string;

  @ApiProperty({ example: 1, description: 'Nível de aprovação (1 = primeiro)' })
  @IsInt()
  @Min(1)
  level!: number;

  @ApiPropertyOptional({ enum: ['gte', 'gt', 'lte', 'lt'], description: 'Operador da condição de valor' })
  @IsOptional()
  @IsIn(['gte', 'gt', 'lte', 'lt'])
  conditionOp?: string;

  @ApiPropertyOptional({ example: 5000, description: 'Valor de corte da condição (R$)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  conditionValue?: number;

  @ApiProperty({
    example: ['GERENTE_GERAL', 'DIRETOR'],
    description: 'Codes dos perfis v2 que aprovam este nível',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  approverRoles!: string[];
}

export class UpdateApprovalMatrixDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  level?: number;

  @ApiPropertyOptional({ enum: ['gte', 'gt', 'lte', 'lt'] })
  @IsOptional()
  @IsIn(['gte', 'gt', 'lte', 'lt'])
  conditionOp?: string;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  conditionValue?: number;

  @ApiPropertyOptional({ example: ['DIRETOR'] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  approverRoles?: string[];
}
