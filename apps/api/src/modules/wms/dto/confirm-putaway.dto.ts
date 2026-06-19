import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmPutawayDto {
  @IsString() @IsNotEmpty() locationId: string;
}
