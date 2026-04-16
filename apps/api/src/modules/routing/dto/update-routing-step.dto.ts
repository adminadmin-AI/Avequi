import { PartialType } from '@nestjs/swagger';
import { CreateRoutingStepDto } from './create-routing-step.dto';

export class UpdateRoutingStepDto extends PartialType(CreateRoutingStepDto) {}
