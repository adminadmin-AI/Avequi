import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

/** Cenário B do #531 — devolver veículo 0km à montadora (exige NF-e de devolução) */
export class ReturnManufacturerDto {
  @ApiProperty({ description: 'OV devolvida' })
  @IsString()
  salesOrderId!: string;

  @ApiProperty({ description: 'SerialNumber (chassi) a devolver' })
  @IsString()
  serialNumberId!: string;

  @ApiProperty({ description: 'Chave de acesso da NF-e de DEVOLUÇÃO (44 dígitos)' })
  @IsString()
  @Length(44, 44)
  @Matches(/^\d{44}$/, { message: 'chaveNfeDevolucao deve conter 44 dígitos numéricos' })
  chaveNfeDevolucao!: string;
}
