import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsArray,
  Min,
} from 'class-validator';

export class CreateApprovalMatrixDto {
  @ApiProperty({ example: 'PURCHASE_ORDER' })
  @IsString()
  @IsNotEmpty()
  entityType: string;

  @ApiPropertyOptional({ example: 'totalAmount' })
  @IsString()
  @IsOptional()
  conditionField?: string;

  @ApiPropertyOptional({ example: 'GT', description: 'GT, GTE, LT, LTE, EQ, NEQ' })
  @IsString()
  @IsOptional()
  conditionOp?: string;

  @ApiPropertyOptional({ example: '10000' })
  @IsString()
  @IsOptional()
  conditionValue?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  level: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  requiredApprovals: number;

  @ApiProperty({ example: ['DIRECTOR', 'MANAGER'] })
  @IsArray()
  @IsString({ each: true })
  approverRoles: string[];
}
