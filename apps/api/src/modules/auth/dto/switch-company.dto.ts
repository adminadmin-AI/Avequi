import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * POST /auth/switch-company — troca a empresa ativa da sessão (#1119).
 *
 * O alvo vem do BODY, e isso é deliberado: não é "companyId do cliente
 * mandando escopo de consulta" (o padrão IDOR que o #450 eliminou dos DTOs),
 * é o usuário escolhendo em qual empresa quer trabalhar. O escopo continua
 * saindo do JWT — só que o JWT é reemitido depois de o backend confirmar que
 * a pessoa tem vínculo vigente na empresa destino E que ela está no mesmo
 * grupo econômico da empresa de cadastro.
 */
export class SwitchCompanyDto {
  @ApiProperty({ description: 'Id da empresa que passa a ser a ativa da sessão' })
  @IsString()
  @MinLength(1)
  companyId: string;
}
