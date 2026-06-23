import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString } from 'class-validator';

export class StatementQueryDto {
  @ApiProperty({ description: 'ID da conta bancária' })
  @IsString()
  bankAccountId!: string;

  @ApiProperty({ description: 'Data início (ISO 8601)', example: '2026-01-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: 'Data fim (ISO 8601)', example: '2026-01-31' })
  @IsDateString()
  endDate!: string;
}
