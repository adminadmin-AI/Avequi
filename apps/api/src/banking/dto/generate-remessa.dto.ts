import { IsString, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateRemessaDto {
  @ApiProperty({ description: 'ID da conta bancária' })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;

  @ApiProperty({ description: 'IDs dos boletos a incluir na remessa', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  boletoIds: string[];
}
