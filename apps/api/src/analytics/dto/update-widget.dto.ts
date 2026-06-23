import { PartialType } from '@nestjs/swagger';
import { CreateWidgetDto } from './create-widget.dto';

export class UpdateWidgetDto extends PartialType(CreateWidgetDto) {}
