import { IsString, MinLength } from 'class-validator';

export class UploadNfeDto {
  @IsString()
  @MinLength(100)
  xmlContent: string; // raw XML string

  @IsString()
  warehouseId: string; // where goods will be received
}
