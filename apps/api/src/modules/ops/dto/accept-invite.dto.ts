import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /invite/accept — OPS WP2 (#909), aceite PÚBLICO do convite.
 * A senha passa pela política completa (#345) no service; aqui só o básico
 * estrutural para a mensagem de erro não vazar política antes da hora.
 */
export class AcceptInviteDto {
  @ApiProperty({ description: 'Token recebido por e-mail (uso único)' })
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token: string;

  @ApiProperty({ description: 'Nova senha — política #345 aplicada no aceite' })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;
}
