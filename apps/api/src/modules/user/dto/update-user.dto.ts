import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    example: false,
    description:
      'Ativa/inativa o usuário (toggle da tela de usuários). Campo só de update: ' +
      'criação nasce sempre ativa. Sem ele o ValidationPipe global ' +
      '(forbidNonWhitelisted) rejeitava o PATCH inteiro com "property isActive ' +
      'should not exist" — inativar/reativar pela UI ficava impossível.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
