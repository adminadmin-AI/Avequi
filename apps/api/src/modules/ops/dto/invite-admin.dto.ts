import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /ops/tenants/:id/provisioning/admin — OPS WP2 (#909), passo do admin.
 * Cria (ou reaproveita) o usuário admin do tenant e envia o convite de
 * primeiro acesso por e-mail. Chamar de novo REENVIA (revoga o token antigo).
 */
export class InviteAdminDto {
  @ApiProperty({ example: 'Maria Souza' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'maria@crd.com.br' })
  @IsEmail()
  email: string;
}
