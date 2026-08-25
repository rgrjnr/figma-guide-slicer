/**
 * The flows narrate themselves as numbered steps ("03 upload the ZIP"), and
 * that stream is what makes determinate progress possible: parse the number,
 * divide by how many steps the flow takes on a normal day, and the spinner
 * becomes a gauge. The totals are the happy path — an expired session adds
 * login screens, so the bar is clamped rather than allowed past full.
 */
export const FLOW_TOTALS: Record<string, number> = {
  audience: 7,
  draft: 8,
  replace: 11,
  schedule: 11,
  test: 5,
  refresh: 6,
};

/** The flows speak English into their run logs; the UI speaks pt-BR. */
const STEP_LABELS: [RegExp, string][] = [
  [/^open the entry point/, "abrindo o Braze"],
  [/^wait for the login/, "aguardando outro login"],
  [/^enter the email/, "login: e-mail"],
  [/^choose the .* identity provider/, "login: SSO"],
  [/^enter username/, "login: usuário"],
  [/^enter password/, "login: senha"],
  [/^enter the one-time code/, "login: código"],
  [/^choose the code authenticator/, "login: autenticador"],
  [/^open Import Users/, "abrindo a importação"],
  [/^choose Attributes and upload/, "enviando a planilha"],
  [/^confirm the column mapping/, "confirmando o mapeamento"],
  [/^ask for a segment/, "pedindo o segmento"],
  [/^start the import/, "iniciando a importação"],
  [/^wait for the segment/, "aguardando o segmento"],
  [/^open Campaigns/, "abrindo Campanhas"],
  [/^start an email campaign/, "criando a campanha"],
  [/^name it/, "nomeando a campanha"],
  [/^upload the ZIP/, "enviando a arte"],
  [/^upload the new ZIP/, "enviando a nova arte"],
  [/^build the message/, "montando a mensagem"],
  [/^fill subject/, "preenchendo o assunto"],
  [/^set subject/, "preenchendo o assunto"],
  [/^save as draft/, "salvando o rascunho"],
  [/^open the campaign/, "abrindo a campanha"],
  [/^add a blank variant/, "criando a variante nova"],
  [/^save the new variant/, "salvando a variante"],
  [/^remove /, "removendo a variante antiga"],
  [/^rename the variant/, "renomeando a variante"],
  [/^verify one variant/, "conferindo as variantes"],
  [/^open the delivery step/, "abrindo o agendamento"],
  [/^set entry frequency/, "configurando a frequência"],
  [/^set \d{4}/, "definindo data e hora"],
  [/^save the schedule/, "salvando o agendamento"],
  [/^target the/, "selecionando o público"],
  [/^remove the A\/B control group/, "removendo o grupo de controle"],
  [/^read back the audience/, "conferindo o público"],
  [/^save the targeting/, "salvando o público"],
  [/^verify the schedule/, "verificando o agendamento"],
  [/^read the reachable-user count/, "contando os alcançáveis"],
  [/^open Preview and test/, "abrindo o teste"],
  [/^add \d+ recipient/, "adicionando destinatários"],
  [/^check Braze will accept/, "validando o teste"],
  [/^send the test/, "enviando o teste"],
  [/^read the compose step/, "lendo a campanha"],
  [/^read the target step/, "lendo o público"],
  [/^confirm we are inside Braze/, "confirmando o acesso"],
];

export function translateStep(label: string): string {
  for (const [pattern, translation] of STEP_LABELS) {
    if (pattern.test(label)) return translation;
  }
  return label;
}

export interface FlowProgress {
  n: number;
  label: string;
}

/** "3/7 · enviando a planilha", clamped so login detours never read >100%. */
export function progressOf(flow: string, progress: FlowProgress | undefined) {
  if (!progress) return null;
  const total = FLOW_TOTALS[flow] ?? 8;
  const n = Math.min(progress.n, total);
  return { n, total, pct: Math.round((n / total) * 100), label: translateStep(progress.label) };
}
