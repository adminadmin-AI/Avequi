import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'João Silva' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'joao@gdr.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'senha123' })
  @IsString()
  password: string;

  @ApiProperty({ enum: UserRole, example: UserRole.STORE })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({ example: 'cuid-da-empresa' })
  @IsString()
  companyId: string;
}
