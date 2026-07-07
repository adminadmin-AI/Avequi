import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAcquirerFeeDto } from './create-acquirer-fee.dto';

export class UpdateAcquirerFeeDto extends PartialType(CreateAcquirerFeeDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
