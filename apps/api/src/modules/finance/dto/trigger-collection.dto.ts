import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { CollectionAttemptChannel } from '@prisma/client';

export class TriggerCollectionDto {
  @ApiProperty({ example: ['clxyz1', 'clxyz2'], description: 'IDs dos recebíveis/lançamentos' })
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @ApiProperty({ enum: CollectionAttemptChannel, example: 'EMAIL', description: 'Canal de cobrança' })
  @IsEnum(CollectionAttemptChannel)
  channel: CollectionAttemptChannel;

  @ApiPropertyOptional({ example: 'Lembrete de pagamento vencido' })
  @IsOptional()
  @IsString()
  note?: string;
}
