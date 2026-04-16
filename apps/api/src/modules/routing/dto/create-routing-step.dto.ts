import { IsString, IsOptional, IsInt, Min, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoutingStepDto {
  @ApiProperty() @IsString() productId: string;
  @ApiProperty() @IsString() companyId: string;
  @ApiProperty() @IsInt() @IsPositive() stepOrder: number;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() workCenter?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) setupTimeMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) runTimeMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
