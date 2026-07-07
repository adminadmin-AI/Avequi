import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateCollectionRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() daysFrom?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() daysTo?: number;
  @ApiPropertyOptional({ type: [String], description: 'EMAIL, WHATSAPP, PHONE, SYSTEM' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoBlock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() escalate?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
