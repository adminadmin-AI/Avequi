import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
// cookie-parser é CJS puro (sem export .default). O tsconfig tem
// allowSyntheticDefaultImports SEM esModuleInterop: `import x from` compila
// mas o dist chama `.default` inexistente e o boot cai (v1.29.0 nunca passou
// no healthcheck do Railway por isso — o helmet escapa porque exporta
// .default por conta própria). `import = require` emite require() direto.
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { readBuildMeta } from './modules/version/version.util';

async function bootstrap() {
  // rawBody: assinatura X-Hub-Signature-256 do webhook WhatsApp (#508) é HMAC do corpo bruto
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // #349: cookies httpOnly de auth (gdr_access/gdr_refresh/gdr_csrf) — o
  // CsrfGuard e o JwtStrategy leem req.cookies.
  app.use(cookieParser());

  // Security headers (IAM F6.1 #349). CSP em Report-Only para não quebrar o
  // Swagger em /docs — só reporta violações, ainda não bloqueia. Trocar para
  // enforce (reportOnly: false) depois de validar o relatório em produção.
  app.use(
    helmet({
      contentSecurityPolicy: {
        reportOnly: true,
        useDefaults: true,
        directives: {
          // O Swagger UI usa estilos/scripts inline; liberados aqui para que,
          // ao migrar para enforce, /docs continue funcionando.
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'upgrade-insecure-requests': null,
        },
      },
      // X-Frame-Options: DENY — impede o app de ser embutido em iframe.
      frameguard: { action: 'deny' },
      // HSTS: força HTTPS por 1 ano, incluindo subdomínios (efetivo só sob TLS).
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      // Referrer-Policy: strict-origin-when-cross-origin.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // X-Content-Type-Options: nosniff (default do Helmet, explícito por clareza).
      noSniff: true,
    }),
  );

  // Permissions-Policy — o Helmet não define este header por padrão. Bloqueia
  // acesso a câmera, microfone e geolocalização por padrão.
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    next();
  });

  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api');

  // AllExceptionsFilter registrado via APP_FILTER (DI) no app.module (#766)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: [
      process.env.WEB_URL ?? 'http://localhost:3000',
      // Previews do Vercel (validação visual de PRs) — escopado ao TEAM;
      // produção continua vindo só de WEB_URL. Pós-rebrand as URLs de preview
      // saem `avequi-<hash>-...` (sem o `-web-`), o que deixava TODO preview
      // bloqueado por CORS; o prefixo `avequi-` cobre os dois formatos.
      /^https:\/\/avequi-[a-z0-9-]+-adminnexoprimecombrs-projects\.vercel\.app$/,
      // #962 — LP avecchi.ai chama o conector público de leads
      // (POST /crm/public/site-lead) direto do browser.
      'https://avecchi.ai',
      'https://www.avecchi.ai',
    ],
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('GDR ERP API')
    .setDescription('API do sistema ERP da GDR')
    .setVersion(readBuildMeta().version) // #versioning — lê do package.json
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.log(`API rodando em http://localhost:${port}/api`);
  console.log(`Swagger em http://localhost:${port}/docs`);
}

bootstrap();
