import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsNotEmpty } from 'class-validator';

export class CreateWorkflowVersionDto {
  @ApiProperty({
    description: 'Workflow definition with nodes and edges',
    example: {
      nodes: [
        { id: 'start', type: 'START', config: {} },
        { id: 'approval1', type: 'APPROVAL', config: { level: 1 } },
        { id: 'end', type: 'END', config: {} },
      ],
      edges: [
        { from: 'start', to: 'approval1' },
        { from: 'approval1', to: 'end' },
      ],
    },
  })
  @IsObject()
  @IsNotEmpty()
  definition: Record<string, any>;
}
