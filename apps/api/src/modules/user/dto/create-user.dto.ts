import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'João Silva' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'joao@gdr.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Exemplo#Forte2026',
    description:
      'Deve cumprir a política de senha (#345): mínimo 10 caracteres, maiúscula, minúscula, número e caractere especial; senhas comuns e contendo nome/e-mail são rejeitadas.',
  })
  @IsString()
  password: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Força o usuário a trocar a senha no próximo login (#345 — primeiro acesso / reset por admin). Default: false.',
  })
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;

  @ApiProperty({ enum: UserRole, example: UserRole.STORE })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({ example: 'cuid-da-empresa' })
  @IsString()
  companyId: string;
}
