import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthRedis } from './health.redis';

/**
 * Health check da API (#1102). Não importa PrismaModule: ele é @Global().
 * Sem dependência nova no package.json — `ioredis` já é usado pelo IAM.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthRedis],
})
export class HealthModule {}
