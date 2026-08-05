/**
 * #992 — Minuta do Contrato de Prestação de Serviços SaaS da operadora.
 *
 * ESTRUTURA inspirada em contrato de mercado (licença de software Domínio/
 * Thomson Reuters, usado como referência de QUAIS cláusulas existem); o TEXTO
 * é próprio, adaptado ao modelo Avecchi: SaaS multi-tenant single-instance,
 * mensalidade com régua de cobrança (D+3/D+10/D+20, suspensão sempre manual)
 * e dados exportáveis pelo cliente.
 *
 * ⚠️ MINUTA TÉCNICA (AVQ-CT v1): recomendada revisão jurídica antes do uso
 * com cliente real. Mudou o texto → suba a versão em TEMPLATE_VERSION (o
 * rodapé do PDF carimba versão + data de emissão).
 */

export const TEMPLATE_VERSION = 'AVQ-CT v1';

export interface ContractParams {
  operadora: {
    razaoSocial: string;
    cnpj: string;
    im: string | null;
    endereco: string | null; // linha única já montada; null = pendente
    email: string | null;
    cidadeForo: string | null;
  };
  cliente: {
    razaoSocial: string;
    cnpj: string;
    endereco: string | null;
    email: string | null;
  };
  comercial: {
    mensalidadeFormatada: string; // "R$ 1.500,00"
    diaCobranca: number;
    inicioVigencia: string; // "05/08/2026"
    planoNome: string | null; // null = módulos conforme contratação
    propostaAceita: { id: string; decididaEm: string } | null;
  };
}

const PENDENTE = '[● PREENCHER NO CADASTRO DA EMPRESA]';

export function renderClauses(p: ContractParams): Array<{ title: string; body: string }> {
  const modulos = p.comercial.planoNome
    ? `os módulos do plano "${p.comercial.planoNome}"`
    : 'os módulos habilitados na contratação';
  const foro = p.operadora.cidadeForo ?? PENDENTE;

  return [
    {
      title: '1. Objeto',
      body:
        `Licença de uso, não exclusiva e intransferível, do software de gestão AVECCHI ERP, ` +
        `disponibilizado como serviço (SaaS) e acessado exclusivamente pela internet, compreendendo ${modulos}, ` +
        `com hospedagem, manutenção e atualizações inclusas. O software é fornecido em instância única e ` +
        `versionada: todas as contas operam sempre na versão corrente publicada pela CONTRATADA.`,
    },
    {
      title: '2. Acesso e credenciais',
      body:
        `O acesso é individual, por usuário e senha, sendo a CONTRATANTE responsável pela guarda e ` +
        `confidencialidade das credenciais das pessoas que autorizar, vedado o compartilhamento de contas. ` +
        `A CONTRATADA disponibiliza verificação em duas etapas (MFA), cuja ativação é recomendada. ` +
        `Operações realizadas com credenciais válidas presumem-se realizadas pela CONTRATANTE.`,
    },
    {
      title: '3. Dados da contratante',
      body:
        `Os dados lançados no sistema pertencem à CONTRATANTE. A CONTRATADA mantém rotinas de cópia de ` +
        `segurança do ambiente e disponibiliza recursos de exportação. Encerrado o contrato, os dados ` +
        `permanecem disponíveis para consulta e exportação por 30 (trinta) dias, após o que poderão ser ` +
        `definitivamente excluídos, independentemente de notificação.`,
    },
    {
      title: '4. Valor e forma de pagamento',
      body:
        `Pela licença e serviços, a CONTRATANTE pagará a mensalidade de ${p.comercial.mensalidadeFormatada}, ` +
        `com vencimento no dia ${p.comercial.diaCobranca} de cada mês, contra fatura emitida pela CONTRATADA. ` +
        `As obrigações financeiras são devidas enquanto vigorar o contrato, independentemente do volume de uso ` +
        `do sistema. Cada parte arcará com os tributos que lhe couberem na forma da lei.`,
    },
    {
      title: '5. Reajuste',
      body:
        `A mensalidade será reajustada a cada 12 (doze) meses pelo acumulado do IGP-M ou do IPCA, ` +
        `aplicando-se o de maior variação no período. Em caso de variação negativa, o valor vigente será mantido.`,
    },
    {
      title: '6. Inadimplência',
      body:
        `Em caso de atraso: a CONTRATADA enviará lembrete a partir do 3º (terceiro) dia; exibirá aviso de ` +
        `pendência no próprio sistema a partir do 10º (décimo) dia; e, persistindo o atraso por mais de 20 ` +
        `(vinte) dias, poderá suspender o acesso, mediante comunicação. A reativação ocorrerá em até 3 (três) ` +
        `dias úteis após a quitação integral dos valores em aberto. A suspensão não interrompe a fluência das ` +
        `mensalidades nem apaga os dados, que seguem o previsto na cláusula 3.`,
    },
    {
      title: '7. Suporte e atualizações',
      body:
        `A CONTRATADA prestará suporte em horário comercial, pelos canais oficiais divulgados no próprio ` +
        `sistema, para dúvidas de uso e incidentes. Atualizações, correções e evoluções são publicadas de ` +
        `forma contínua para todas as contas, sem custo adicional, podendo a CONTRATADA alterar recursos desde ` +
        `que não descaracterize a natureza essencial do serviço contratado.`,
    },
    {
      title: '8. Obrigações da contratante',
      body:
        `São de responsabilidade da CONTRATANTE: (i) a veracidade e a licitude dos dados que lançar; (ii) a ` +
        `gestão dos acessos que conceder aos seus usuários; (iii) manter meios adequados de acesso à internet; ` +
        `(iv) utilizar o sistema conforme a documentação e a legislação aplicável; e (v) manter seus dados ` +
        `cadastrais e de contato atualizados.`,
    },
    {
      title: '9. Limitações de uso',
      body:
        `Salvo autorização expressa da CONTRATADA, a CONTRATANTE não poderá: vender, sublicenciar, copiar, ` +
        `modificar, realizar engenharia reversa ou explorar comercialmente o software; utilizar robôs ou ` +
        `mecanismos automatizados não autorizados de extração; nem ceder o acesso a terceiros estranhos à sua ` +
        `operação. A propriedade intelectual do software e da marca AVECCHI pertence à CONTRATADA.`,
    },
    {
      title: '10. Vigência e rescisão',
      body:
        `O contrato vigora por 12 (doze) meses a partir de ${p.comercial.inicioVigencia}, prorrogando-se por ` +
        `prazo indeterminado. Qualquer das partes pode rescindir mediante aviso prévio por escrito de 30 ` +
        `(trinta) dias, faturando-se integralmente a competência do aviso. Durante o prazo determinado, a ` +
        `rescisão imotivada sujeita a parte que a der causa a multa de 20% (vinte por cento) das mensalidades ` +
        `restantes; após, não há multa. A rescisão por inadimplência dispensa aviso prévio da CONTRATADA.`,
    },
    {
      title: '11. Proteção de dados (LGPD)',
      body:
        `Para os fins da Lei nº 13.709/2018, a CONTRATANTE é a Controladora dos dados pessoais que lançar no ` +
        `sistema e a CONTRATADA atua como Operadora, tratando-os conforme as instruções decorrentes deste ` +
        `contrato. A CONTRATADA adota medidas técnicas e organizacionais de segurança, comunica incidentes nos ` +
        `prazos legais e poderá utilizar suboperadores de infraestrutura e serviços (hospedagem, banco de ` +
        `dados, emissão fiscal e processamento auxiliar), permanecendo responsável por exigir deles proteção ` +
        `equivalente.`,
    },
    {
      title: '12. Confidencialidade',
      body:
        `As partes manterão sigilo sobre as informações confidenciais a que tiverem acesso em razão deste ` +
        `contrato, ressalvadas as hipóteses de determinação legal ou judicial, caso em que a parte notificada ` +
        `comunicará a outra, salvo proibição da autoridade.`,
    },
    {
      title: '13. Responsabilidade',
      body:
        `A responsabilidade integral de cada parte, por ano, relacionada a este contrato, fica limitada ao ` +
        `total efetivamente pago pela CONTRATANTE nos 12 (doze) meses anteriores ao evento. Nenhuma parte ` +
        `responde por danos indiretos ou lucros cessantes. A limitação não alcança hipóteses de dolo, violação ` +
        `de propriedade intelectual ou obrigações de pagamento.`,
    },
    {
      title: '14. Disposições gerais',
      body:
        `Este contrato não estabelece vínculo societário ou trabalhista entre as partes. Comunicações formais ` +
        `poderão ser feitas pelos e-mails de cadastro. A tolerância quanto ao descumprimento de qualquer ` +
        `cláusula não implica novação ou renúncia. A alteração de plano ou de condições comerciais formalizada ` +
        `no portal da CONTRATADA integra este contrato como aditivo, dispensada nova assinatura.`,
    },
    {
      title: '15. Foro',
      body:
        `Fica eleito o foro da comarca de ${foro}, com renúncia a qualquer outro, por mais privilegiado que ` +
        `seja, para dirimir controvérsias oriundas deste contrato.`,
    },
  ];
}
