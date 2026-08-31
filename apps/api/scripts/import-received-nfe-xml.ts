/**
 * Compatibilidade: o importador de NF-e RECEBIDA (#608, PR-0) vive agora em
 * `import-nfe-xml.ts`, que atende as duas direções. Este atalho fixa
 * `--direction RECEBIDA` e delega — mesmos argumentos, mesmo protocolo
 * (dry-run padrão, --commit com evidência do dia).
 *
 * Uso:
 *   ts-node scripts/import-received-nfe-xml.ts --dir <pasta> [--report <dir>] [--company <cnpj>] [--limit N] [--commit]
 */
if (!process.argv.includes('--direction')) process.argv.splice(2, 0, '--direction', 'RECEBIDA');
require('./import-nfe-xml');
