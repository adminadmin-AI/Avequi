import { PartialType } from '@nestjs/swagger';
import { CreateBoletoDto } from './create-boleto.dto';

export class UpdateBoletoDto extends PartialType(CreateBoletoDto) {}
