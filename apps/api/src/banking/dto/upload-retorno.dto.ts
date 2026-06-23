import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadRetornoDto {
  @ApiProperty({ description: 'ID da conta bancária' })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;

  @ApiProperty({ description: 'Nome do arquivo de retorno' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ description: 'Conteúdo do arquivo de retorno (texto CNAB 240)' })
  @IsString()
  @IsNotEmpty()
  fileContent: string;
}
