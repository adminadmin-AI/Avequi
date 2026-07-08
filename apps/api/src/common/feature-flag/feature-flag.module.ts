import { Module } from '@nestjs/common';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Módulo NÃO-global e ainda não importado por ninguém (PR-2 do épico #527).
 * O primeiro consumidor real deve fazer `imports: [FeatureFlagModule]`
 * explicitamente — dependência rastreável, sem poluir o container.
 */
@Module({
  providers: [FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
