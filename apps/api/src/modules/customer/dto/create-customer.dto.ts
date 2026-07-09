import {
  IsDateString,
  IsIn, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerType, IcmsIndicator } from '@prisma/client';

export class CreateCustomerDto {
  @ApiPropertyOptional({ enum: CustomerType })
  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @ApiProperty({ description: 'Nome fantasia / apelido comercial' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Razão social (PJ) — DANFE usa quando presente (#474)' })
  @IsOptional()
  @IsString()
  razaoSocial?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  document?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Data de nascimento (PF) — pós-venda/CRM (#476)' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional({ description: 'E-mail para envio de NF-e/boleto (fallback: email)' })
  @IsOptional()
  @IsEmail()
  fiscalEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  complement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ibgeCode?: string;

  @ApiPropertyOptional({ description: 'Inscrição estadual (IE de produtor quando produtor rural)' })
  @IsOptional()
  @IsString()
  ie?: string;

  @ApiPropertyOptional({ enum: IcmsIndicator, description: 'indIEDest da NF-e — explícito (#474)' })
  @IsOptional()
  @IsEnum(IcmsIndicator)
  indIeDest?: IcmsIndicator;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRuralProducer?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isSimplesNacional?: boolean;

  // ── Crédito e cobrança (#475) ──
  @ApiPropertyOptional({ example: 50000, description: 'Limite de crédito (R$) — null = sem limite' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  @ApiPropertyOptional({ default: false, description: 'Bloqueia confirmação de OV (#475)' })
  @IsOptional()
  @IsBoolean()
  billingBlocked?: boolean;

  @ApiPropertyOptional({ example: 'Inadimplência — 3 títulos vencidos' })
  @IsOptional()
  @IsString()
  billingBlockReason?: string;

  // ── Padrões comerciais (#475) — pré-preenchem a OV ──
  @ApiPropertyOptional({ description: 'Vendedor padrão (User) — flui até a comissão' })
  @IsOptional()
  @IsString()
  defaultSellerId?: string;

  @ApiPropertyOptional({ example: '30/60/90', description: 'Condição de pagamento padrão' })
  @IsOptional()
  @IsString()
  defaultPaymentTerms?: string;

  @ApiPropertyOptional({ description: 'Transportadora padrão (Carrier)' })
  @IsOptional()
  @IsString()
  defaultCarrierId?: string;

  @ApiPropertyOptional({ description: 'Observações internas — nunca vão para documentos' })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  // ── Política de crédito (#388) ──
  @ApiPropertyOptional({ enum: ['A', 'B', 'C', 'D', 'E'], description: 'Score de crédito interno' })
  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D', 'E'])
  creditScore?: string;

  @ApiPropertyOptional({ description: 'Observações do analista de crédito' })
  @IsOptional()
  @IsString()
  creditNotes?: string;
}

export class CustomerAddressDto {
  @ApiProperty({ description: 'Rótulo do endereço, ex: "Obra Fazenda Santa Fé"' })
  @IsString()
  label: string;

  @ApiProperty()
  @IsString()
  address: string;

  @ApiPropertyOptional() @IsOptional() @IsString() number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() neighborhood?: string;

  @ApiProperty() @IsString() city: string;
  @ApiProperty() @IsString() state: string;

  @ApiPropertyOptional() @IsOptional() @IsString() zipCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ibgeCode?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
