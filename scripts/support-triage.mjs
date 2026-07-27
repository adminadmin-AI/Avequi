#!/usr/bin/env node
// @ts-nocheck
/**
 * Runner repo-aware da triagem de suporte por IA (épico #764 / WP4 #768).
 *
 * Disparado pela GitHub Action `support-triage.yml` via repository_dispatch.
 * Fluxo:
 *   1. Lê o client_payload (já REDIGIDO na origem pela API) via env TRIAGE_PAYLOAD.
 *   2. Monta contexto repo-aware (grep dos arquivos do módulo/rota indicado).
 *   3. Chama a API da Anthropic — modelo BARATO na dedup/classificação e FORTE
 *      no diagnóstico (ids em consts, sobrescrevíveis por env).
 *   4. Valida a saída contra o schema (parse com 1 retry).
 *   5. Assina o corpo (HMAC-SHA256) e faz o PATCH na API.
 *
 * Standalone ESM, sem dependências novas (fetch nativo, Node 20). Sem
 * ANTHROPIC_API_KEY configurada, sai 0 com log claro (não falha o workflow).
 *
 * NOTA de PII: o client_payload já vem redigido da API (redactPii). Este script
 * NÃO recebe stack completo — só stackSignature. Nada de novo dado sensível é
 * introduzido; o que vai ao LLM é o payload + trechos de CÓDIGO do repo.
 */
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Model ids atuais (skill claude-api). Forte no diagnóstico, barato na
// dedup/classificação — sobrescrevíveis por env sem tocar no código.
const MODEL_STRONG = process.env.TRIAGE_MODEL_STRONG || 'claude-opus-4-8';
const MODEL_CHEAP = process.env.TRIAGE_MODEL_CHEAP || 'claude-haiku-4-5';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];

function log(msg) {
  process.stdout.write(`[support-triage] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[support-triage] ERRO: ${msg}\n`);
  process.exit(1);
}

function readPayload() {
  const raw = process.env.TRIAGE_PAYLOAD;
  if (!raw) fail('TRIAGE_PAYLOAD ausente');
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`TRIAGE_PAYLOAD inválido: ${e.message}`);
  }
}

/** route "/app/customers" → candidato de diretório do módulo na API. */
function moduleDirFromRoute(route) {
  if (!route) return null;
  const seg = route.split('/').filter(Boolean)[0];
  if (!seg) return null;
  const base = join('apps', 'api', 'src', 'modules', seg.toLowerCase());
  try {
    if (statSync(base).isDirectory()) return base;
  } catch {
    /* diretório não existe — heurística falhou, segue sem contexto de arquivo */
  }
  return null;
}

/** Lê até `maxFiles` arquivos-fonte do diretório, com corte de tamanho. */
function gatherRepoContext(dir, maxFiles = 6, maxBytesPerFile = 6000) {
  if (!dir) return [];
  let files = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .slice(0, maxFiles);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const content = readFileSync(join(dir, f), 'utf8').slice(0, maxBytesPerFile);
      out.push({ path: join(dir, f), content });
    } catch {
      /* arquivo ilegível — ignora */
    }
  }
  return out;
}

async function anthropic(model, system, user) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic ${model} respondeu ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return text;
}

/** Extrai o primeiro objeto JSON do texto (tolera cercas ```json). */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('sem JSON no texto');
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Chama o modelo forçando JSON, com 1 retry mais explícito. */
async function askJson(model, system, user) {
  try {
    return extractJson(await anthropic(model, system, user));
  } catch (e) {
    log(`parse falhou (${e.message}); 1 retry forçando JSON puro`);
    const strict =
      user + '\n\nIMPORTANTE: responda SOMENTE com um objeto JSON válido, sem texto ao redor, sem cercas de código.';
    return extractJson(await anthropic(model, system, strict));
  }
}

/** Etapa BARATA — dedup + classificação (módulo/severidade). */
async function classify(payload) {
  const system =
    'Você é um classificador de chamados de suporte de um ERP industrial (NestJS/Prisma). ' +
    'Responda em JSON com {"isDuplicateOf": string|null, "module": string, "severity": "P0"|"P1"|"P2"|"P3"}. ' +
    'isDuplicateOf = protocolo de um incidente recente que seja o MESMO problema, ou null.';
  const user = JSON.stringify({
    incident: {
      protocol: payload.protocol,
      route: payload.route,
      description: payload.description,
      stackSignature: payload.stackSignature,
    },
    recentSimilar: payload.recentSimilar || [],
  });
  const out = await askJson(MODEL_CHEAP, system, user);
  return {
    isDuplicateOf:
      typeof out.isDuplicateOf === 'string' && out.isDuplicateOf ? out.isDuplicateOf : null,
    module: typeof out.module === 'string' ? out.module : (payload.route || 'desconhecido'),
    severity: SEVERITIES.includes(out.severity) ? out.severity : 'P2',
  };
}

/** Etapa FORTE — diagnóstico repo-aware. */
async function diagnose(payload, classified, repoContext) {
  const system =
    'Você é um engenheiro sênior triando um bug de um ERP (NestJS 10 + Prisma 5). ' +
    'Com base no incidente e nos trechos de código do repositório, produza um diagnóstico. ' +
    'Responda SOMENTE em JSON com este formato exato: ' +
    '{"probableCause": string, "files": [{"path": string, "line": number, "reason": string}], ' +
    '"suggestedFix": string|null, "safeSelfServiceStep": string|null, ' +
    '"confidence": number (0 a 1), "needsHuman": boolean}. ' +
    'files: arquivos/linhas suspeitos com base no código dado. Se não tiver certeza, needsHuman=true.';
  const user = JSON.stringify({
    incident: {
      protocol: payload.protocol,
      tenant: payload.tenant,
      route: payload.route,
      appVersion: payload.appVersion,
      requestId: payload.requestId,
      stackSignature: payload.stackSignature,
      description: payload.description,
    },
    classification: classified,
    repoContext,
  });
  const out = await askJson(MODEL_STRONG, system, user);
  return {
    probableCause: String(out.probableCause || 'não determinado'),
    files: Array.isArray(out.files)
      ? out.files
          .filter((f) => f && typeof f.path === 'string')
          .map((f) => ({
            path: String(f.path),
            line: Number.isFinite(f.line) ? Math.max(0, Math.trunc(f.line)) : 0,
            reason: String(f.reason || ''),
          }))
      : [],
    suggestedFix: typeof out.suggestedFix === 'string' ? out.suggestedFix : null,
    safeSelfServiceStep:
      typeof out.safeSelfServiceStep === 'string' ? out.safeSelfServiceStep : null,
    confidence:
      typeof out.confidence === 'number' ? Math.min(1, Math.max(0, out.confidence)) : 0.3,
    needsHuman: typeof out.needsHuman === 'boolean' ? out.needsHuman : true,
  };
}

async function writeBack(incidentId, diagnosis) {
  const base = process.env.SUPPORT_API_BASE_URL;
  const secret = process.env.SUPPORT_TRIAGE_HMAC_SECRET;
  if (!base) fail('SUPPORT_API_BASE_URL ausente');
  if (!secret) fail('SUPPORT_TRIAGE_HMAC_SECRET ausente');

  // Corpo assinado EXATAMENTE como enviado (o servidor valida o rawBody).
  const body = JSON.stringify(diagnosis);
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  const url = `${base.replace(/\/$/, '')}/support/incidents/${incidentId}/diagnosis`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-triage-signature': signature,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`write-back ${res.status}: ${text.slice(0, 300)}`);
  }
  log(`write-back OK para incidente ${incidentId}`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    log('ANTHROPIC_API_KEY não configurada — nada a fazer, saindo 0.');
    process.exit(0);
  }
  const payload = readPayload();
  log(`triando ${payload.protocol} (rota ${payload.route || '—'})`);

  const dir = moduleDirFromRoute(payload.route);
  const repoContext = gatherRepoContext(dir);
  log(`contexto repo-aware: ${dir || 'nenhum diretório casado'} (${repoContext.length} arquivos)`);

  const classified = await classify(payload);
  log(`classificação: módulo=${classified.module} sev=${classified.severity} dup=${classified.isDuplicateOf || '—'}`);

  const diag = await diagnose(payload, classified, repoContext);

  // Monta o objeto no schema do UpdateDiagnosisDto.
  const diagnosis = {
    probableCause: diag.probableCause,
    files: diag.files,
    module: classified.module,
    severity: classified.severity,
    isDuplicateOf: classified.isDuplicateOf,
    confidence: diag.confidence,
    suggestedFix: diag.suggestedFix,
    safeSelfServiceStep: diag.safeSelfServiceStep,
    needsHuman: diag.needsHuman,
  };

  await writeBack(payload.incidentId, diagnosis);
  log('concluído.');
}

main().catch((e) => fail(e.message));
