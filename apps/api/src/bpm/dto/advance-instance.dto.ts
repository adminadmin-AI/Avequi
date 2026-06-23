import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class AdvanceInstanceDto {
  @ApiPropertyOptional({ example: 'MANUAL' })
  @IsString()
  @IsOptional()
  action?: string;

  @ApiPropertyOptional({ example: 'user-123' })
  @IsString()
  @IsOptional()
  performedBy?: string;
}
