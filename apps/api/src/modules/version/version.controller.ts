import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { readBuildMeta } from './version.util';

@ApiTags('version')
@Controller('version')
export class VersionController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Versão do produto + metadados de build (público) (#versioning)' })
  version() {
    const meta = readBuildMeta();
    return {
      name: 'avequi-erp-api',
      version: meta.version,
      gitSha: meta.gitSha,
      builtAt: meta.builtAt,
      env: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    };
  }
}
