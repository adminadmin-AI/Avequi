# GDR — Stack Tecnológica e Padrões Obrigatórios

> Todas as decisões de stack são obrigatórias. Nenhum módulo pode ser desenvolvido em tecnologia diferente sem aprovação explícita. Isso garante que o vibe code produza código integrável entre módulos.

---

## Stack Definida

| Camada | Tecnologia | Versão | Decisão |
|--------|-----------|--------|---------|
| Backend Framework | NestJS (Node.js) | v10+ | Módulos espelham domínios do ERP; TypeScript nativo |
| Linguagem | TypeScript | 5.x | Tipos estáticos obrigatórios; erros em compilação, não produção |
| Banco de Dados | PostgreSQL | 16+ | ACID, row-level locking, JSON nativo |
| ORM / Migrations | Prisma | 5.x | Schema como código, tipos gerados automaticamente |
| Multi-tenant | row-level com `companyId` | — | Mais simples que schema separado; funciona até 50+ filiais |
| Frontend | Next.js + shadcn/ui | 14+ | SSR para dashboards pesados |
| Estado Global | Zustand | — | Estado global simples |
| Cache de Servidor | React Query (TanStack) | — | Cache, refetch, loading states |
| Mobile / Loja | PWA (Next.js) | — | Sem app store; cache offline via Service Worker |
| API Style | REST + OpenAPI | — | Documentação automática via @nestjs/swagger |
| Auth | JWT + Refresh Token | — | Stateless; rotação de refresh token |
| Fila | BullMQ (Redis) | — | Processamento assíncrono: MRP, NF-e, emails |
| Cache | Redis | 7+ | Sessão, filas BullMQ, lock distribuído |
| Fiscal | Focus NFe (API externa) | — | NF-e, NFC-e; R$109/mês + R$0,65/doc |
| Infra | Railway ou Render | — | Deploy simples sem DevOps dedicado |
| DB Gerenciado | Supabase ou Railway PG | — | Backups automáticos, connection pooling |
| Monitoramento | Sentry + Logtail | — | Erros em tempo real; logs estruturados |
| CI/CD | GitHub Actions | — | lint → testes → build → deploy |

---

## Estrutura de Módulos NestJS

Cada domínio = um módulo NestJS independente. Módulos nunca acessam o repositório de outro módulo diretamente.

```
src/
├── auth/           AuthModule       — JWT, login, refresh, guards globais
├── company/        CompanyModule    — empresas, filiais, parâmetros
├── product/        ProductModule    — produto, BOM, roteiro
├── supplier/       SupplierModule   — fornecedores, lead time, preços
├── customer/       CustomerModule   — clientes, histórico
├── stock/          StockModule      — saldo, movimentação, depósitos
├── purchase/       PurchaseModule   — req → PO → recebimento
├── mrp/            MrpModule        — engine MRP, planos, sugestões
├── production/     ProductionModule — OP, apontamento, perdas
├── logistics/      LogisticsModule  — WMS, picking, transferências
├── sales/          SalesModule      — OV, venda loja, devolução
├── finance/        FinanceModule    — CP, CR, fluxo de caixa
├── fiscal/         FiscalModule     — Focus NFe, NF-e, NFC-e
├── audit/          AuditModule      — log de todas as ações (via interceptor global)
└── report/         ReportModule     — dashboards, exportações (read-only)
```

### Regra de Comunicação Entre Módulos

```
PERMITIDO:
  ✅ Service A chama Service B diretamente (injeção de dependência via @Inject)
  ✅ Module A emite evento → Module B ouve via @OnEvent (EventEmitter2)
  ✅ Module A expõe método público que Module B chama

PROIBIDO:
  ❌ Service A acessa Repository/Prisma de outro módulo diretamente
  ❌ Importação circular entre módulos
  ❌ Acesso cross-module sem passar pelo service público do módulo dono
```

---

## Padrões NestJS Obrigatórios

### Guards

```typescript
// Guard global de autenticação — aplicado em todos os controllers
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

// Guard de roles — aplicado onde necessário
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<Role[]>('roles', context.getHandler());
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user.role);
  }
}

// Guard de company isolation — CRÍTICO
@Injectable()
export class CompanyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user, params, body } = context.switchToHttp().getRequest();
    // DIRECTOR pode acessar filiais do grupo; STORE só a própria filial
    if (user.role === 'DIRECTOR') return true;
    return user.companyId === (params.companyId || body.companyId);
  }
}
```

### Interceptor de Auditoria Global

```typescript
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const { user, method, url, body } = context.switchToHttp().getRequest();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      // Registrar após a resposta para ter o entityId
      return next.handle().pipe(
        tap(async (response) => {
          await this.auditService.log({
            userId: user.sub,
            companyId: user.companyId,
            entity: this.resolveEntity(url),
            entityId: response?.id,
            action: this.resolveAction(method),
            payload: body,
          });
        })
      );
    }
    return next.handle();
  }
}
```

### DTOs e Validação

```typescript
// Toda entrada de API usa class-validator + class-transformer
import { IsString, IsDecimal, IsEnum, IsOptional } from 'class-validator';

export class CreateProductDto {
  @IsString()
  sku: string;

  @IsString()
  name: string;

  @IsEnum(ProductType)
  type: ProductType;

  @IsString()
  unit: string;

  @IsOptional()
  @IsString()
  ncm?: string;  // obrigatório se type === FINISHED_GOOD — validar no service
}
```

### Padrão BullMQ — Jobs Assíncronos

```typescript
// Producer — adicionar job à fila
@Injectable()
export class MrpQueueService {
  constructor(@InjectQueue('mrp') private mrpQueue: Queue) {}

  async scheduleMrpRun(companyId: string, horizonDays: number) {
    await this.mrpQueue.add('run-mrp', { companyId, horizonDays }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}

// Consumer — processar job
@Processor('mrp')
export class MrpProcessor {
  @Process('run-mrp')
  async handleMrpRun(job: Job<{ companyId: string; horizonDays: number }>) {
    await this.mrpService.runMrp(job.data.companyId, job.data.horizonDays);
  }
}

// Filas do sistema GDR:
// - 'mrp'       → MRP runs (manual e diário)
// - 'fiscal'    → emissão NF-e / NFC-e via Focus NFe
// - 'email'     → notificações e alertas
// - 'reports'   → geração de relatórios pesados
```

---

## Padrão de Resposta da API

```typescript
// Padrão obrigatório para todas as responses
interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

// Padrão de erro
interface ApiError {
  statusCode: number;
  message: string;
  code: string;       // ex: "INSUFFICIENT_STOCK", "PO_NOT_APPROVED"
  timestamp: string;
}
```

---

## Configuração de Módulo — Exemplo Padrão

```typescript
// produto.module.ts
@Module({
  imports: [
    PrismaModule,           // Prisma sempre importado
    EventEmitterModule,     // para emitir eventos
  ],
  controllers: [ProductController],
  providers: [ProductService, ProductRepository],
  exports: [ProductService], // expor apenas o service, nunca o repository
})
export class ProductModule {}
```

---

## Multi-tenant — Checklist por Endpoint

Antes de qualquer PR, verificar:

- [ ] Toda query tem `where: { companyId: user.companyId }`
- [ ] Todo create tem `companyId: user.companyId` no body
- [ ] Guard de roles aplicado no controller
- [ ] AuditLog gerado via interceptor
- [ ] Eventos emitidos com `companyId` no payload
- [ ] Nenhum dado de outra company pode vazar em nenhuma response

---

## Endpoints Padrão por Módulo

Cada módulo segue o padrão REST:

```
GET    /products              → listar (paginado, filtrado por companyId)
POST   /products              → criar
GET    /products/:id          → detalhe
PUT    /products/:id          → atualizar completo
PATCH  /products/:id          → atualizar parcial
DELETE /products/:id          → desativar (soft delete — active = false)
```

Exceções (ações de negócio):
```
POST /purchase-orders/:id/approve     → aprovar PO
POST /purchase-orders/:id/receive     → registrar recebimento
POST /sales-orders/:id/confirm        → confirmar + reservar estoque
POST /sales-orders/:id/invoice        → faturar + emitir NF-e
POST /production-orders/:id/release   → liberar OP
POST /production-orders/:id/complete  → finalizar OP
POST /mrp/run                         → rodar MRP manualmente
```
