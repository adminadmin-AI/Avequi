import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * #946 (#780): `role` sai do update. O papel do usuário passa a ser DERIVADO
 * dos perfis RBAC v2 (fonte de verdade) — editá-lo direto aqui criava
 * divergência silenciosa: o enum mudava e o UserRoleAssignment ficava para
 * trás. Com o OmitType + ValidationPipe global (forbidNonWhitelisted), mandar
 * `role` no PATCH responde 400 pelo pipeline normal, sem `if` no service.
 * A CRIAÇÃO continua exigindo o papel inicial (CreateUserDto).
 */
export class UpdateUserDto extends OmitType(PartialType(CreateUserDto), ['role'] as const) {
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
