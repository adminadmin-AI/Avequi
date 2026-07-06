import { IsOptional, IsString } from 'class-validator';

export class ConfirmPickTaskDto {
  /** Chassi/serial escolhido na separação — obrigatório p/ produto rastreável (#490) */
  @IsOptional()
  @IsString()
  serialNumberId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
