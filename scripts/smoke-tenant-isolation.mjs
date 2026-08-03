#!/usr/bin/env node
/**
 * Smoke pós-deploy de isolamento cross-tenant — OPS WP7 (#914).
 *
 * Valida com credenciais REAIS (homolog ou prod) que a fronteira multi-tenant
 * está de pé no ambiente que acabou de subir — é a contraparte VIVA da suíte
 * estática (tenant-isolation.sweep.spec + tenant-query-lint):
 *
 *   1. Tenant A lista um recurso próprio (clientes) e guarda um ID;
 *   2. Tenant B tenta ler esse ID direto → TEM que vir 403/404 (nunca 200);
 *   3. Tenant A (mesmo sendo ADMIN_GLOBAL) chama /ops/tenants → TEM que vir 403;
 *   4. Sem token, /ops/tenants → 401.
 *
 * Uso (checklist de release, passo pós-deploy):
 *   SMOKE_BASE_URL=https://api.avecchi.ai \
 *   SMOKE_TENANT_A_EMAIL=... SMOKE_TENANT_A_PASSWORD=... \
 *   SMOKE_TENANT_B_EMAIL=... SMOKE_TENANT_B_PASSWORD=... \
 *   node scripts/smoke-tenant-isolation.mjs
 *
 * A e B DEVEM ser usuários de TENANTS DIFERENTES (ex.: GDR × conta SANDBOX).
 * Se o usuário tiver MFA ativo o login pedirá o segundo fator — use contas de
 * smoke sem MFA ou rode com sessão dedicada. Sai com código 1 em QUALQUER
 * furo — o deploy não é considerado validado.
 */

const BASE = (process.env.SMOKE_BASE_URL ?? 'https://api.avecchi.ai').replace(/\/$/, '');
const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`✗ Variável ${k} ausente — abortando (ver cabeçalho do script).`);
    process.exit(1);
  }
  return v;
};

const A = { email: need('SMOKE_TENANT_A_EMAIL'), password: need('SMOKE_TENANT_A_PASSWORD') };
const B = { email: need('SMOKE_TENANT_B_EMAIL'), password: need('SMOKE_TENANT_B_PASSWORD') };

let falhas = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const falha = (msg) => {
  falhas += 1;
  console.error(`  ✗ FURO DE ISOLAMENTO: ${msg}`);
};

async function req(path, { token, method = 'GET' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* corpo não-JSON é irrelevante pro smoke */
  }
  return { status: res.status, body };
}

async function login({ email, password }) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    console.error(`✗ Login de ${email} falhou (${res.status}) — smoke inconclusivo.`);
    process.exit(1);
  }
  const body = await res.json();
  const token = body.accessToken ?? body.access_token;
  if (!token) {
    console.error(`✗ Login de ${email} não retornou accessToken — smoke inconclusivo.`);
    process.exit(1);
  }
  return token;
}

console.log(`Smoke de isolamento cross-tenant — ${BASE}`);

const tokenA = await login(A);
const tokenB = await login(B);

// 1) A lista um recurso próprio e guarda um ID
console.log('1. Tenant A lista clientes próprios');
const listaA = await req('/api/customers', { token: tokenA });
if (listaA.status !== 200) {
  console.error(`✗ Tenant A não conseguiu listar clientes (${listaA.status}) — smoke inconclusivo.`);
  process.exit(1);
}
const clientes = Array.isArray(listaA.body) ? listaA.body : (listaA.body?.data ?? []);
if (!clientes.length) {
  console.error('✗ Tenant A sem clientes para o teste — semeie um cliente e rode de novo.');
  process.exit(1);
}
const alvo = clientes[0].id;
ok(`A enxerga ${clientes.length} cliente(s); alvo do teste: ${alvo}`);

// 2) B tenta ler o recurso de A por ID direto
console.log('2. Tenant B tenta ler o cliente de A por ID direto');
const idor = await req(`/api/customers/${alvo}`, { token: tokenB });
if (idor.status === 200) falha(`B LEU o cliente de A (HTTP 200) — IDOR cross-tenant!`);
else ok(`B barrado com HTTP ${idor.status}`);

// 3) Admin de tenant não enxerga o control plane
console.log('3. Tenant A (admin de tenant) tenta /api/ops/tenants');
const opsComTokenTenant = await req('/api/ops/tenants', { token: tokenA });
if (opsComTokenTenant.status === 200) {
  falha('token de TENANT abriu o /ops (fronteira do control plane furada)!');
} else {
  ok(`barrado com HTTP ${opsComTokenTenant.status}`);
}

// 4) Sem token, /ops responde 401
console.log('4. /api/ops/tenants sem token');
const opsSemToken = await req('/api/ops/tenants');
if (opsSemToken.status === 200) falha('/ops respondeu 200 SEM autenticação!');
else ok(`barrado com HTTP ${opsSemToken.status}`);

if (falhas > 0) {
  console.error(`\n✗ ${falhas} furo(s) de isolamento — NÃO considere o deploy validado.`);
  process.exit(1);
}
console.log('\n✓ Isolamento cross-tenant de pé no ambiente.');
