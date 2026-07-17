import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Reporte de problema pelo usuário. companyId/reportedById vêm do JWT — nunca do body. */
export class CreateIncidentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  /** Rota do app onde ocorreu (capturada pelo front). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  route?: string;

  /** Versão/gitSha do app no momento (capturada pelo front). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  appVersion?: string;

  /** requestId do último erro, para correlação com o log do servidor. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  requestId?: string;
}
