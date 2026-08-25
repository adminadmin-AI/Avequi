import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Focus-A (#608): liga/desliga a sincronização de NF-e recebidas por company. */
export class SyncSettingsDto {
  @ApiProperty({ description: 'true = o cron e o POST /sync passam a sincronizar esta empresa; false = nada roda (default)' })
  @IsBoolean()
  enabled!: boolean;
}
