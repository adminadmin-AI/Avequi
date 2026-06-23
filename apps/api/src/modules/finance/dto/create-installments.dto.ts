import { IsDateString, IsInt, IsNotEmpty, Min, Max } from 'class-validator';

export class CreateInstallmentsDto {
  @IsInt()
  @Min(2)
  @Max(60)
  numberOfInstallments: number;

  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays: number;

  @IsDateString()
  @IsNotEmpty()
  firstDueDate: string;
}
