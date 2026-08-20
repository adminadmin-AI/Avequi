import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /ops/groups — cria um grupo econômico (#1119). */
export class CreateCompanyGroupDto {
  @ApiProperty({
    description: 'Nome do grupo econômico (ex.: "Grupo GDR")',
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;
}

/** POST /ops/groups/:id/companies — associa um tenant ao grupo (#1119). */
export class AddCompanyToGroupDto {
  @ApiProperty({ description: 'Id da empresa RAIZ (tenant) a associar' })
  @IsString()
  @MinLength(1)
  companyId: string;
}
