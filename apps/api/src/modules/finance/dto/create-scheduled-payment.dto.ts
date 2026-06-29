import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateScheduledPaymentDto {
  @ApiProperty({ example: 'clxyz...', description: 'ID do lançamento financeiro' })
  @IsString()
  financialEntryId: string;

  @ApiProperty({ example: 'clxyz...', description: 'ID da conta bancária' })
  @IsString()
  bankAccountId: string;

  @ApiProperty({ example: '2026-07-15', description: 'Data agendada para pagamento' })
  @IsDateString()
  scheduledDate: string;

  @ApiProperty({ example: 1500.00, description: 'Valor do pagamento agendado' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'Pagamento fornecedor ABC' })
  @IsOptional()
  @IsString()
  note?: string;
}
