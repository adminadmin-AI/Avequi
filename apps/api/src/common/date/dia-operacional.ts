/**
 * Dia operacional — a única fonte de verdade sobre "que dia é hoje" para regras
 * de negócio (#901).
 *
 * ## O problema que este módulo resolve
 *
 * O container de produção roda com o relógio em UTC, três horas à frente de São
 * Paulo. Perguntar o dia ao relógio do processo (`new Date()` + `setHours(0,0,0,0)`)
 * devolve **amanhã** entre 21h e meia-noite no horário da fábrica. Era isso que
 * fazia a Minha Mesa mostrar como vencido o que vence amanhã, e o cron marcar
 * títulos como OVERDUE três horas antes de o dia acabar.
 *
 * ## Os três conceitos — e por que NÃO são a mesma coisa
 *
 * Misturá-los é o que produz o bug, então este módulo os mantém em tipos
 * diferentes de propósito:
 *
 * 1. **Data operacional** (`DataOperacional`, ex. `'2026-08-14'`) — o dia do
 *    calendário da operação. É uma data, não um instante: não tem hora.
 *
 * 2. **Limite de data pura** (`limiteDeDataPura`, ex. `2026-08-14T00:00:00.000Z`)
 *    — a representação persistida de uma data-calendário. Serve para comparar
 *    contra colunas que guardam DATA, não momento: `dueDate` de título
 *    financeiro, competência. **Não é** "meia-noite física em UTC" — é só a
 *    forma canônica de escrever a data pura `14/08/2026` numa coluna de
 *    data-e-hora.
 *
 * 3. **Instante físico** (`instanteInicioDoDia`, ex. `2026-08-14T03:00:00.000Z`)
 *    — o momento real em que o dia começou em São Paulo. Serve para comparar
 *    contra colunas que guardam MOMENTO: `createdAt`, `invoicedAt`, `paidAt`.
 *
 * Comparar uma data pura contra o instante físico é o erro mais fácil de
 * cometer aqui, e o mais perigoso: `2026-08-14T00:00:00Z` (vence hoje) é
 * anterior a `2026-08-14T03:00:00Z` (início físico de hoje), então o título
 * venceria no próprio dia, o dia inteiro. Por isso as duas funções têm nomes
 * distintos e nenhuma delas se chama apenas "início do dia".
 *
 * ## Regra de vencimento (#901)
 *
 * `dueDate < limiteDeDataPura(dataOperacionalHoje())` → vencido.
 * Vence hoje → não vencido. Vence amanhã → não vencido.
 */

/** Fuso da operação. Ponto único — não espalhar a string pelo código. */
export const FUSO_OPERACIONAL = 'America/Sao_Paulo';

/**
 * Data-calendário de negócio no formato `YYYY-MM-DD`.
 *
 * É um tipo marcado (não uma `string` qualquer) para que o compilador recuse
 * uma string solta ou um `Date` onde se espera uma data operacional — a trava
 * que impede o bug de voltar por descuido.
 */
export type DataOperacional = string & { readonly __dataOperacional: unique symbol };

const FORMATADOR_DATA = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_OPERACIONAL,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const PADRAO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Converte `'2026-08-14'` em `DataOperacional`, validando o formato. */
export function comoDataOperacional(valor: string): DataOperacional {
  if (!PADRAO_DATA.test(valor)) {
    throw new Error(`Data operacional inválida: "${valor}" (esperado YYYY-MM-DD)`);
  }
  return valor as DataOperacional;
}

/**
 * O dia de hoje NO FUSO DA OPERAÇÃO — independente do relógio do processo.
 *
 * Às 22h de 14/08 em São Paulo devolve `'2026-08-14'`, mesmo que o servidor
 * (UTC) já esteja em 15/08.
 */
export function dataOperacionalHoje(agora: Date = new Date()): DataOperacional {
  return FORMATADOR_DATA.format(agora) as DataOperacional;
}

/**
 * A representação canônica de uma data pura: `2026-08-14T00:00:00.000Z`.
 *
 * Use para comparar/persistir colunas que significam DATA (vencimento,
 * competência). Nunca use para comparar contra `createdAt` e afins.
 */
export function limiteDeDataPura(data: DataOperacional): Date {
  return new Date(`${data}T00:00:00.000Z`);
}

/** Soma (ou subtrai, com valor negativo) dias a uma data operacional. */
export function somarDias(data: DataOperacional, dias: number): DataOperacional {
  const base = limiteDeDataPura(data);
  base.setUTCDate(base.getUTCDate() + dias);
  return formatarDataPura(base);
}

/**
 * Lê uma data pura persistida (`2026-08-14T00:00:00.000Z`) de volta como
 * `'2026-08-14'`.
 *
 * Lê em UTC de propósito: formatar essa data no fuso de São Paulo devolveria
 * **13/08 às 21h**, ou seja, o dia anterior. É por isso que existe uma função
 * separada de `formatarInstante`.
 */
export function formatarDataPura(valor: Date): DataOperacional {
  return valor.toISOString().slice(0, 10) as DataOperacional;
}

/**
 * O instante real em que o dia operacional começou — `2026-08-14T03:00:00.000Z`
 * para 14/08 em São Paulo.
 *
 * Use SOMENTE para comparar contra colunas que guardam momento real.
 */
export function instanteInicioDoDia(data: DataOperacional): Date {
  return new Date(limiteDeDataPura(data).getTime() + deslocamentoDoFusoMs(data));
}

/** O último instante do dia operacional (`23:59:59.999` em São Paulo). */
export function instanteFimDoDia(data: DataOperacional): Date {
  return new Date(instanteInicioDoDia(somarDias(data, 1)).getTime() - 1);
}

/**
 * Lê um instante real como a data operacional em que ele aconteceu — uma venda
 * faturada às 23h de 14/08 (02h UTC de 15/08) pertence ao dia 14/08.
 */
export function formatarInstante(valor: Date): DataOperacional {
  return dataOperacionalHoje(valor);
}

/**
 * Quanto o fuso da operação está atrás de UTC, em milissegundos, no dia
 * informado. Calculado a partir do próprio `Intl` para não depender de o
 * Brasil ter ou não horário de verão no futuro.
 */
function deslocamentoDoFusoMs(data: DataOperacional): number {
  const referencia = new Date(`${data}T12:00:00.000Z`);
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_OPERACIONAL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(referencia);

  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)!.value);

  const localComoUtc = Date.UTC(
    parte('year'),
    parte('month') - 1,
    parte('day'),
    parte('hour') % 24,
    parte('minute'),
    parte('second'),
  );

  // Positivo para fusos a oeste de Greenwich (São Paulo → +3h).
  return referencia.getTime() - localComoUtc;
}
