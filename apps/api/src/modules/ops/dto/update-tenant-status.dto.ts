import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PATCH /ops/tenants/:id/status — OPS WP1 (#908).
 * `reason` é OBRIGATÓRIO para SUSPENDED e CHURNED (validado no service, onde
 * a regra depende do status alvo) — suspensão sem motivo não é auditável.
 */
export class UpdateTenantStatusDto {
  @ApiProperty({ enum: TenantStatus, description: 'Novo status do tenant' })
  @IsEnum(TenantStatus)
  status: TenantStatus;

  @ApiPropertyOptional({
    description: 'Motivo da mudança — obrigatório para SUSPENDED/CHURNED',
    minLength: 5,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason?: string;
}
