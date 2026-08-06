/**
 * AVQ-CT v2 — Capítulos 1 a 14. Transcrição fiel do documento do parceiro
 * jurídico (05/08/2026), com UMA correção factual autorizada pelo Claudio no
 * chat: a lista de Terceiros Essenciais (2.1.m) reflete a infraestrutura REAL
 * (Railway/Focus NFe/Anthropic/OpenAI/Pluggy) em vez de Cloudflare/OpenPix.
 * Qualquer outra mudança de texto = decisão jurídica, não técnica.
 */
import { Capitulo, ContratoV2Params, par, PENDENTE, tabela } from './contract-v2-tipos';

export function capitulos1a14(p: ContratoV2Params): Capitulo[] {
  const endOp = p.operadora.endereco ?? PENDENTE;
  const endCli = p.cliente.endereco ?? PENDENTE;
  const emailCli = p.cliente.email ?? PENDENTE;

  return [
    {
      titulo: 'CAPÍTULO 1 — QUALIFICAÇÃO DAS PARTES',
      blocos: [
        par(
          `1.1. CONTRATADA. ${p.operadora.razaoSocial}, sociedade empresária limitada inscrita no CNPJ sob o ` +
            `nº ${p.operadora.cnpj}${p.operadora.im ? `, Inscrição Municipal nº ${p.operadora.im}` : ''}, com sede em ` +
            `${endOp}, e-mail de contato contratual ${p.operadora.email ?? PENDENTE}, doravante AVECCHI ou CONTRATADA.`,
        ),
        par(
          `1.2. CONTRATANTE. ${p.cliente.razaoSocial}, inscrita no CNPJ sob o nº ${p.cliente.cnpj}, com sede em ` +
            `${endCli}, e-mail de contato contratual ${emailCli}, doravante CLIENTE ou CONTRATANTE.`,
        ),
        par('1.3. AVECCHI e CLIENTE são referidas em conjunto como Partes e, isoladamente, como Parte.'),
        par(
          '1.4. As Partes declaram que são empresárias, atuam com paridade e simetria negocial, contam com ' +
            'assessoria própria e negociaram livremente este instrumento, aplicando-se integralmente o disposto no ' +
            'artigo 421-A do Código Civil. Este contrato não configura relação de consumo, uma vez que o software é ' +
            'contratado como insumo da atividade econômica da CONTRATANTE.',
        ),
        par('1.5. Integram este contrato, como se nele transcritos estivessem:'),
        tabela(
          ['Anexo', 'Conteúdo', 'Prevalência'],
          [
            ['Anexo I', 'Plano, Escopo e Condições Comerciais', 'Prevalece sobre o corpo do contrato em matéria comercial'],
            ['Anexo II', 'Acordo de Nível de Serviço (SLA) e Suporte', 'Prevalece em matéria de níveis de serviço'],
            [
              'Anexo III',
              'Acordo de Tratamento de Dados Pessoais (LGPD) e Medidas de Segurança',
              'Prevalece em matéria de proteção de dados',
            ],
            ['Anexo IV', 'Relação de Suboperadores e Provedores de Infraestrutura', 'Meramente informativo e atualizável'],
          ],
        ),
        par('1.6. Havendo conflito não resolvido pela tabela acima, prevalece o corpo deste contrato.'),
      ],
    },
    {
      titulo: 'CAPÍTULO 2 — DEFINIÇÕES',
      blocos: [
        par(
          '2.1. Para os fins deste contrato, os termos abaixo têm o significado a seguir atribuído, no singular ou no plural:',
        ),
        par(
          'a) Sistema ou Avecchi ERP: a plataforma de gestão empresarial desenvolvida e mantida pela AVECCHI, ' +
            'disponibilizada em nuvem, incluindo seu código-fonte, código-objeto, banco de dados estrutural, ' +
            'interfaces, APIs, documentação, marcas, layouts e todas as versões, correções e evoluções.',
        ),
        par(
          'b) SaaS (Software as a Service): modelo de fornecimento em que o Sistema é executado na infraestrutura ' +
            'contratada pela AVECCHI e acessado remotamente pela internet, sem instalação nos servidores da ' +
            'CONTRATANTE e sem entrega de cópia do software.',
        ),
        par(
          'c) Módulo: conjunto funcional do Sistema comercializado de forma individualizada, conforme habilitado no Anexo I.',
        ),
        par(
          'd) Usuário Licenciado: pessoa física vinculada à CONTRATANTE, identificada por credencial individual e ' +
            'intransferível, autorizada a acessar o Sistema dentro do limite contratado.',
        ),
        par('e) Ambiente de Produção: instância do Sistema utilizada para a operação real da CONTRATANTE.'),
        par(
          'f) Dados do Cliente: todo conteúdo inserido, gerado, importado ou processado pela CONTRATANTE ou por ' +
            'seus Usuários Licenciados no Sistema, incluindo cadastros, lançamentos, documentos e arquivos.',
        ),
        par(
          'g) Dados Pessoais, Titular, Tratamento, Controlador, Operador, Suboperador, Incidente de Segurança e ' +
            'ANPD: os significados atribuídos pela Lei nº 13.709/2018 (LGPD) e pela regulamentação da Autoridade ' +
            'Nacional de Proteção de Dados.',
        ),
        par(
          'h) Disponibilidade: percentual de tempo, apurado mensalmente, em que o Ambiente de Produção esteve ' +
            'acessível, conforme metodologia do Anexo II.',
        ),
        par(
          'i) Indisponibilidade: interrupção total do acesso ao Ambiente de Produção atribuível à AVECCHI, ' +
            'excluídas as hipóteses previstas na cláusula 11.5 e no Anexo II.',
        ),
        par(
          'j) Janela de Manutenção: período previamente comunicado destinado a manutenções programadas, não ' +
            'computado como Indisponibilidade.',
        ),
        par(
          'k) Serviços Profissionais: implantação, parametrização, migração de dados, treinamentos, integrações e ' +
            'desenvolvimentos sob demanda, contratados isolada ou conjuntamente.',
        ),
        par('l) API: interface de programação disponibilizada pela AVECCHI para integração de sistemas.'),
        par(
          'm) Terceiros Essenciais: provedores externos de infraestrutura ou serviços dos quais o Sistema depende, ' +
            'incluindo, sem limitação, Railway, Vercel, Supabase, provedores de e-mail transacional, provedores de ' +
            'mensageria (WhatsApp Business API), provedores de emissão de documentos fiscais (Focus NFe), ' +
            'provedores de inteligência artificial (Anthropic, OpenAI), provedores de pagamento e Open Finance ' +
            '(Pluggy e congêneres), instituições financeiras, SEFAZ, Receita Federal e demais órgãos públicos.',
        ),
        par(
          'n) Portal Avecchi: ambiente digital da AVECCHI no qual são disponibilizados planos, faturas, ' +
            'documentação técnica, canais oficiais de suporte, políticas e aditivos.',
        ),
        par(
          'o) Documentação: manuais, materiais de ajuda, políticas técnicas e conteúdos publicados pela AVECCHI no ' +
            'Portal Avecchi, que descrevem o funcionamento e os limites do Sistema.',
        ),
        par(
          'p) Dia Útil: dia de expediente bancário na cidade sede da AVECCHI, de segunda a sexta-feira, excetuados ' +
            'feriados nacionais, estaduais e municipais.',
        ),
        par(
          '2.2. Termos técnicos não definidos neste capítulo terão o significado usualmente adotado no mercado de ' +
            'tecnologia da informação.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 3 — OBJETO',
      blocos: [
        par('3.1. Este contrato tem por objeto:'),
        par(
          'a) a concessão, pela AVECCHI à CONTRATANTE, de licença de uso não exclusiva, onerosa, intransferível e ' +
            'por prazo determinado do Avecchi ERP, no modelo SaaS, limitada aos Módulos e ao número de Usuários ' +
            'Licenciados descritos no Anexo I; e',
        ),
        par(
          'b) a prestação dos serviços de hospedagem, manutenção corretiva e evolutiva, atualização contínua, ' +
            'suporte técnico e demais Serviços Profissionais contratados.',
        ),
        par(
          '3.2. O Sistema é fornecido no estado em que se encontra publicado, com as funcionalidades efetivamente ' +
            'disponíveis na data de cada acesso. A AVECCHI não assume obrigação de desenvolver funcionalidades ' +
            'específicas, salvo quando expressamente contratadas na forma do Capítulo 26.',
        ),
        par(
          '3.3. A obrigação da AVECCHI quanto ao funcionamento do Sistema é de meio no que se refere a resultados ' +
            'operacionais, contábeis, fiscais ou financeiros da CONTRATANTE, e de resultado exclusivamente quanto à ' +
            'disponibilização do Sistema nos níveis de serviço do Anexo II.',
        ),
        par(
          '3.4. O Sistema é uma ferramenta de apoio à gestão. As decisões negociais, contábeis e fiscais, bem como ' +
            'a conferência das informações lançadas e dos documentos emitidos, permanecem sob exclusiva ' +
            'responsabilidade da CONTRATANTE e de seus profissionais habilitados.',
        ),
        par(
          '3.5. A contratação não implica exclusividade de qualquer natureza, sendo livre à AVECCHI licenciar o ' +
            'Sistema a quaisquer terceiros, inclusive concorrentes da CONTRATANTE.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 4 — LICENÇA DE USO DO SOFTWARE',
      blocos: [
        par(
          '4.1. A AVECCHI concede à CONTRATANTE, durante a vigência deste contrato e enquanto adimplentes as ' +
            'obrigações financeiras, licença não exclusiva, intransferível, revogável, não sublicenciável e limitada ' +
            'ao território nacional, para acesso e uso do Sistema exclusivamente em suas atividades empresariais internas.',
        ),
        par(
          '4.2. A licença é concedida sob a modalidade de instância única e versionada: todas as contas operam ' +
            'sempre na versão corrente publicada pela AVECCHI, não havendo direito à manutenção de versões ' +
            'anteriores, à customização isolada do ambiente ou à recusa de atualizações.',
        ),
        par(
          '4.3. A licença é dimensionada por Módulos habilitados e por número de Usuários Licenciados. Cada ' +
            'credencial é individual, nominal e intransferível, sendo vedado o compartilhamento de contas entre ' +
            'pessoas distintas. A identificação de compartilhamento autoriza a AVECCHI a cobrar retroativamente os ' +
            'Usuários Licenciados excedentes, sem prejuízo das demais medidas cabíveis.',
        ),
        par(
          '4.4. A CONTRATANTE poderá ampliar Módulos ou Usuários Licenciados a qualquer tempo pelo Portal Avecchi, ' +
            'com efeitos financeiros proporcionais a partir do ciclo seguinte. A redução somente produz efeitos no ' +
            'ciclo subsequente à solicitação e não gera devolução de valores já faturados.',
        ),
        par('4.5. É expressamente vedado à CONTRATANTE, por si, por seus Usuários Licenciados ou por terceiros:'),
        par(
          'a) copiar, reproduzir, distribuir, ceder, alugar, emprestar, sublicenciar, comercializar ou ' +
            'disponibilizar o Sistema, no todo ou em parte, a qualquer título;',
        ),
        par(
          'b) realizar engenharia reversa, descompilação, desmontagem, extração de código, tentativa de acesso ao ' +
            'código-fonte ou à estrutura interna do Sistema, ressalvadas as hipóteses legalmente irrenunciáveis;',
        ),
        par('c) modificar, adaptar, traduzir ou criar obras derivadas do Sistema;'),
        par(
          'd) utilizar o Sistema para prestar serviços a terceiros, em regime de bureau, service provider, revenda, ' +
            'white label ou similar;',
        ),
        par(
          'e) empregar robôs, crawlers, scrapers, automações não autorizadas ou quaisquer mecanismos de extração ' +
            'massiva de dados fora das APIs oficiais e de seus limites;',
        ),
        par(
          'f) contornar, desativar ou testar controles de segurança, autenticação, auditoria ou limitação de uso, ' +
            'bem como realizar testes de intrusão sem autorização prévia e escrita da AVECCHI;',
        ),
        par(
          'g) utilizar o Sistema, ou os dados dele extraídos, para desenvolver, treinar, especificar ou aprimorar ' +
            'produto concorrente ao Avecchi ERP, obrigação que subsiste por 24 (vinte e quatro) meses após o término ' +
            'deste contrato;',
        ),
        par(
          'h) remover, ocultar ou alterar marcas, avisos de titularidade, identificadores de versão ou registros de auditoria;',
        ),
        par(
          'i) inserir no Sistema conteúdo ilícito, malicioso, que viole direitos de terceiros ou que comprometa a ' +
            'segurança e a estabilidade do ambiente compartilhado.',
        ),
        par(
          '4.6. A violação de qualquer item da cláusula 4.5 constitui infração grave e autoriza a AVECCHI a ' +
            'suspender imediatamente o acesso e a rescindir o contrato por justa causa, sem prejuízo da multa ' +
            'prevista na cláusula 36.6 e da reparação integral das perdas e danos, que não se sujeita ao limite do Capítulo 37.',
        ),
        par(
          '4.7. Nenhuma disposição deste contrato transfere à CONTRATANTE qualquer direito de propriedade sobre o ' +
            'Sistema. A CONTRATANTE recebe direito de uso, e não a propriedade do software, nos termos da Lei nº 9.609/1998.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 5 — IMPLANTAÇÃO',
      blocos: [
        par(
          '5.1. A implantação compreende a criação do ambiente da CONTRATANTE, a habilitação dos Módulos ' +
            'contratados, a configuração inicial e a orientação para início de operação, conforme escopo e prazo do Anexo I.',
        ),
        par(
          '5.2. A implantação é projeto conjunto. A CONTRATANTE designará um Gestor do Projeto com autonomia ' +
            'decisória e disponibilizará, tempestivamente, informações, documentos, acessos e pessoas necessários à execução.',
        ),
        par(
          '5.3. O cronograma será suspenso, com prorrogação automática e proporcional, sempre que a CONTRATANTE ' +
            'deixar de cumprir suas dependências por mais de 5 (cinco) Dias Úteis. Paralisações imputáveis à ' +
            'CONTRATANTE por mais de 60 (sessenta) dias corridos autorizam a AVECCHI a encerrar a fase de ' +
            'implantação, considerando-a concluída e faturável na integralidade.',
        ),
        par(
          '5.4. Concluídas as atividades previstas no escopo, a AVECCHI comunicará a conclusão. Não havendo ' +
            'manifestação escrita e fundamentada da CONTRATANTE em 10 (dez) dias corridos, a implantação será ' +
            'considerada aceita tacitamente.',
        ),
        par(
          '5.5. O início da cobrança da mensalidade independe da conclusão da implantação e observará o disposto no ' +
            'Anexo I, salvo se o atraso decorrer exclusivamente de causa imputável à AVECCHI.',
        ),
        par(
          '5.6. Valores de implantação não são reembolsáveis, ainda que o contrato seja rescindido antes da ' +
            'conclusão do projeto por causa não imputável à AVECCHI.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 6 — PARAMETRIZAÇÃO',
      blocos: [
        par(
          '6.1. Parametrização é a configuração do Sistema dentro das opções nativamente disponíveis, tais como ' +
            'perfis de acesso, regras fiscais, tabelas, centros de custo, fluxos de aprovação, numerações e layouts padrão.',
        ),
        par(
          '6.2. A parametrização não altera o código-fonte e não constitui desenvolvimento sob demanda. Ajustes que ' +
            'exijam alteração de código serão tratados na forma do Capítulo 26.',
        ),
        par(
          '6.3. As definições de parâmetros de natureza fiscal, contábil ou trabalhista serão fornecidas e validadas ' +
            'pela CONTRATANTE, por meio de seus profissionais habilitados. A AVECCHI executa a configuração conforme ' +
            'as instruções recebidas e não responde por parâmetros incorretos, desatualizados ou inadequados ao ' +
            'regime tributário da CONTRATANTE.',
        ),
        par(
          '6.4. Após o encerramento da implantação, a CONTRATANTE poderá alterar parâmetros por conta própria, no ' +
            'Sistema. Reparametrizações assistidas serão orçadas conforme a tabela de horas técnicas vigente.',
        ),
        par(
          '6.5. A AVECCHI manterá registro (log) das alterações de parâmetros relevantes, com identificação do ' +
            'usuário responsável, data e hora, para fins de auditoria.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 7 — MIGRAÇÃO DE DADOS',
      blocos: [
        par(
          '7.1. A migração de dados, quando contratada, observará o escopo, os tipos de dados e o número de cargas ' +
            'descritos no Anexo I.',
        ),
        par(
          '7.2. A CONTRATANTE é a única responsável pela obtenção, extração, qualidade, integridade, veracidade, ' +
            'licitude e completude dos dados de origem, bem como pela base legal que autorize a transferência de ' +
            'Dados Pessoais à AVECCHI.',
        ),
        par(
          '7.3. Os arquivos de origem deverão ser entregues nos formatos e layouts indicados pela AVECCHI. Dados ' +
            'inconsistentes, duplicados, incompletos, em formatos proprietários ou provenientes de sistemas legados ' +
            'sem exportação estruturada poderão ser recusados ou orçados separadamente.',
        ),
        par(
          '7.4. A AVECCHI executará a migração com diligência técnica, mas não garante a reprodução idêntica de ' +
            'estruturas, históricos, relatórios ou saldos de sistemas de terceiros, dada a diferença de modelos de dados.',
        ),
        par(
          '7.5. Concluída cada carga, a CONTRATANTE terá 10 (dez) dias corridos para conferência e homologação por ' +
            'escrito. O silêncio importa aceitação. Após a homologação, correções decorrentes de erros nos dados de ' +
            'origem serão cobradas como serviço adicional.',
        ),
        par(
          '7.6. A CONTRATANTE deverá manter seus dados de origem e seu sistema anterior acessíveis pelo prazo legal ' +
            'de guarda, não podendo o Avecchi ERP ser considerado repositório único ou arquivo legal de informações ' +
            'anteriores à migração.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 8 — TREINAMENTOS',
      blocos: [
        par(
          '8.1. Os treinamentos contratados constam do Anexo I, com indicação de carga horária, formato (remoto ou ' +
            'presencial), número de participantes e prazo de utilização.',
        ),
        par(
          '8.2. Salvo disposição diversa, os treinamentos são realizados remotamente, em ambiente digital, e podem ' +
            'ser gravados pela AVECCHI para fins de qualidade e referência, sendo vedada a gravação, reprodução ou ' +
            'distribuição pela CONTRATANTE sem autorização escrita.',
        ),
        par(
          '8.3. Sessões agendadas e não canceladas com antecedência mínima de 24 (vinte e quatro) horas, ou com ' +
            'ausência de participantes, serão consideradas realizadas e integralmente devidas.',
        ),
        par(
          '8.4. As horas de treinamento incluídas no pacote de implantação deverão ser utilizadas em até 90 ' +
            '(noventa) dias contados do início da operação, expirando automaticamente após esse prazo, sem direito a ' +
            'reembolso ou conversão.',
        ),
        par(
          '8.5. Treinamentos adicionais, reciclagens e capacitação de novos colaboradores serão contratados à ' +
            'parte, conforme tabela vigente.',
        ),
        par(
          '8.6. Deslocamentos, hospedagem e alimentação em atividades presenciais serão custeados pela ' +
            'CONTRATANTE, mediante aprovação prévia de orçamento.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 9 — OBRIGAÇÕES DA CONTRATADA',
      blocos: [
        par('9.1. A AVECCHI obriga-se a:'),
        par(
          'a) disponibilizar o Sistema em ambiente de nuvem, com os Módulos contratados, observando os níveis de ' +
            'serviço do Anexo II;',
        ),
        par('b) manter equipe técnica qualificada para a operação, manutenção e evolução do Sistema;'),
        par(
          'c) publicar correções, melhorias e atualizações de forma contínua, sem custo adicional, na forma do Capítulo 13;',
        ),
        par('d) prestar suporte técnico pelos canais oficiais, nos prazos do Anexo II;'),
        par(
          'e) adotar e manter medidas técnicas e administrativas de segurança da informação compatíveis com o ' +
            'estado da técnica e com o porte da operação, conforme Capítulo 14 e Anexo III;',
        ),
        par('f) executar rotinas automáticas de cópia de segurança, na forma do Capítulo 15;'),
        par('g) tratar os Dados Pessoais na qualidade de Operadora, conforme o Capítulo 17 e o Anexo III;'),
        par('h) manter sigilo sobre as informações confidenciais da CONTRATANTE, na forma do Capítulo 27;'),
        par('i) disponibilizar recursos de exportação de dados, na forma do Capítulo 33;'),
        par(
          'j) comunicar, com antecedência razoável, alterações relevantes que afetem materialmente a forma de uso do Sistema;',
        ),
        par(
          'k) manter regularidade fiscal e trabalhista quanto às suas próprias obrigações, respondendo ' +
            'exclusivamente por seus empregados e prestadores.',
        ),
        par(
          '9.2. A AVECCHI não se obriga a: (i) garantir que o Sistema atenda a necessidade específica não descrita ' +
            'na Documentação; (ii) assegurar operação ininterrupta ou isenta de qualquer falha; (iii) prestar ' +
            'consultoria contábil, fiscal, jurídica, trabalhista ou de gestão; (iv) responder por atos, omissões, ' +
            'instabilidades ou descontinuidades de Terceiros Essenciais; (v) manter compatibilidade com sistemas, ' +
            'dispositivos, navegadores ou versões fora dos requisitos mínimos publicados na Documentação.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 10 — OBRIGAÇÕES DA CONTRATANTE',
      blocos: [
        par('10.1. A CONTRATANTE obriga-se a:'),
        par('a) pagar pontualmente os valores contratados, na forma dos Capítulos 28 a 30;'),
        par('b) utilizar o Sistema conforme a Documentação, este contrato e a legislação aplicável;'),
        par('c) responder pela veracidade, exatidão, licitude e atualização dos Dados do Cliente inseridos no Sistema;'),
        par(
          'd) gerir os perfis e permissões de seus Usuários Licenciados, revogando imediatamente acessos de ' +
            'pessoas desligadas ou não autorizadas;',
        ),
        par(
          'e) guardar com sigilo as credenciais de acesso, vedado o compartilhamento, respondendo integralmente ' +
            'por operações realizadas com credenciais válidas;',
        ),
        par(
          'f) ativar e manter a autenticação em múltiplos fatores (MFA) para os perfis administrativos e financeiros;',
        ),
        par(
          'g) manter infraestrutura própria adequada, incluindo conexão de internet estável, equipamentos, ' +
            'navegadores atualizados e antivírus;',
        ),
        par(
          'h) designar interlocutores para assuntos técnicos, contratuais e de proteção de dados, mantendo seus ' +
            'contatos atualizados no Portal Avecchi;',
        ),
        par(
          'i) conferir e validar documentos fiscais, obrigações acessórias, relatórios e cálculos gerados pelo ' +
            'Sistema antes de sua utilização, transmissão ou arquivamento;',
        ),
        par(
          'j) manter contratos e credenciais próprios junto a terceiros necessários à operação, tais como ' +
            'certificado digital, contas bancárias, gateways de pagamento, provedores de mensageria e órgãos fiscais;',
        ),
        par(
          'k) comunicar imediatamente à AVECCHI qualquer suspeita de uso indevido, comprometimento de credenciais ' +
            'ou Incidente de Segurança que envolva o Sistema;',
        ),
        par(
          'l) obter e manter as bases legais necessárias ao Tratamento de Dados Pessoais que realizar por meio do ' +
            'Sistema, na qualidade de Controladora;',
        ),
        par('m) não utilizar o Sistema para atividades ilícitas, fraudulentas ou que violem direitos de terceiros.'),
        par(
          '10.2. O descumprimento das obrigações desta cláusula exclui a responsabilidade da AVECCHI pelos efeitos ' +
            'daí decorrentes e afasta a aplicação dos indicadores do Anexo II na exata medida do impacto causado.',
        ),
        par(
          '10.3. A CONTRATANTE reconhece que o desempenho do Sistema depende de fatores externos sob seu controle ' +
            'e que eventuais lentidões decorrentes de sua infraestrutura, rede ou equipamentos não caracterizam ' +
            'Indisponibilidade.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 11 — DISPONIBILIDADE DO SERVIÇO (SLA)',
      blocos: [
        par(
          '11.1. A AVECCHI compromete-se a manter a Disponibilidade mensal do Ambiente de Produção em, no mínimo, ' +
            '99,5% (noventa e nove vírgula cinco por cento), apurada mensalmente conforme metodologia descrita no Anexo II.',
        ),
        par(
          '11.2. A apuração considera o total de minutos do mês-calendário, deduzidos os períodos excluídos pela ' +
            'cláusula 11.5 e pelo Anexo II.',
        ),
        par(
          '11.3. O descumprimento do índice mínimo gera, mediante solicitação da CONTRATANTE, créditos de serviço ' +
            'proporcionais, na forma da tabela do Anexo II, aplicáveis sobre a mensalidade do mês subsequente.',
        ),
        par(
          '11.4. Os créditos de serviço constituem o remédio único e exclusivo da CONTRATANTE por falhas de ' +
            'Disponibilidade, ficando afastada qualquer outra forma de indenização, compensação ou reparação a esse ' +
            'título, salvo dolo comprovado.',
        ),
        par('11.5. Não são computadas como Indisponibilidade, para nenhum efeito:'),
        par('a) Janelas de Manutenção programadas e manutenções emergenciais, nos limites do Anexo II;'),
        par(
          'b) falhas, degradações ou interrupções de Terceiros Essenciais, incluindo provedores de infraestrutura, ' +
            'de e-mail e mensageria, provedores de pagamento, instituições financeiras, SEFAZ, Receita Federal, ' +
            'prefeituras e demais órgãos públicos;',
        ),
        par(
          'c) indisponibilidade da conexão, rede, dispositivos, navegadores, servidores locais ou infraestrutura da CONTRATANTE;',
        ),
        par('d) suspensão por inadimplência ou por violação contratual, na forma dos Capítulos 31 e 32;'),
        par(
          'e) uso do Sistema em desacordo com a Documentação, com os limites contratados ou com os limites de ' +
            'requisições das APIs;',
        ),
        par(
          'f) ataques cibernéticos, incluindo negação de serviço (DDoS), invasões, ransomware e exploração de ' +
            'vulnerabilidades ainda não divulgadas publicamente (zero-day);',
        ),
        par('g) eventos de caso fortuito ou força maior, na forma do Capítulo 39;'),
        par('h) atos ou omissões da CONTRATANTE, de seus Usuários Licenciados ou de terceiros por ela contratados;'),
        par('i) funcionalidades disponibilizadas em caráter experimental, beta, piloto ou de pré-lançamento.'),
        par(
          '11.6. A solicitação de créditos deverá ser formalizada em até 15 (quinze) dias corridos do encerramento ' +
            'do mês de apuração, sob pena de decadência do direito, acompanhada dos registros que a fundamentem.',
        ),
        par(
          '11.7. Os créditos acumulados em um mesmo mês não excederão 25% (vinte e cinco por cento) do valor da ' +
            'mensalidade, e não são conversíveis em dinheiro nem compensáveis com valores em aberto.',
        ),
        par(
          '11.8. Verificada Disponibilidade inferior a 95% (noventa e cinco por cento) por 3 (três) meses ' +
            'consecutivos, por causa exclusivamente imputável à AVECCHI, a CONTRATANTE poderá rescindir o contrato ' +
            'sem multa, mediante aviso escrito enviado em até 30 (trinta) dias do último mês apurado. Esta é a única ' +
            'consequência resolutiva prevista para descumprimento de SLA.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 12 — SUPORTE TÉCNICO',
      blocos: [
        par(
          '12.1. A AVECCHI prestará suporte técnico para esclarecimento de dúvidas de uso, orientação sobre ' +
            'funcionalidades e tratamento de incidentes, exclusivamente pelos canais oficiais divulgados no Portal ' +
            'Avecchi e no próprio Sistema.',
        ),
        par(
          '12.2. O horário padrão de atendimento é de segunda a sexta-feira, das 08h00 às 18h00 (horário de ' +
            'Brasília), exceto feriados, ressalvado o plantão para incidentes classificados como críticos, na forma do Anexo II.',
        ),
        par(
          '12.3. Os chamados são classificados por criticidade em P1 (Crítico), P2 (Alta), P3 (Média) e P4 (Baixa), ' +
            'com tempos de resposta e de atendimento definidos no Anexo II. A classificação inicial é proposta pela ' +
            'CONTRATANTE e validada tecnicamente pela AVECCHI, prevalecendo a classificação técnica em caso de ' +
            'divergência, mediante justificativa registrada.',
        ),
        par(
          '12.4. O suporte não abrange: (i) treinamento de usuários; (ii) consultoria contábil, fiscal, tributária, ' +
            'trabalhista ou jurídica; (iii) correção de dados lançados incorretamente pela CONTRATANTE; (iv) ' +
            'manutenção de equipamentos, redes, impressoras, certificados digitais ou softwares de terceiros; (v) ' +
            'desenvolvimento de funcionalidades; (vi) atendimento fora dos canais oficiais.',
        ),
        par(
          '12.5. Atendimentos fora do escopo, quando aceitos pela AVECCHI, serão prestados como serviço adicional, ' +
            'mediante aprovação prévia de orçamento em horas técnicas.',
        ),
        par(
          '12.6. O atendimento fora dos canais oficiais — inclusive por mensagens pessoais, redes sociais ou ' +
            'contato direto com colaboradores — não gera obrigação, não é rastreável e não conta para fins de SLA.',
        ),
        par(
          '12.7. A CONTRATANTE deverá fornecer informações suficientes para reprodução do incidente. A ausência de ' +
            'informações essenciais suspende a contagem dos prazos de atendimento até a regularização.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 13 — ATUALIZAÇÕES DO SISTEMA',
      blocos: [
        par(
          '13.1. O Avecchi ERP opera em regime de versionamento contínuo e atualização automática. As atualizações ' +
            'são publicadas simultaneamente para todas as contas, sem custo adicional e sem necessidade de ação da CONTRATANTE.',
        ),
        par(
          '13.2. As atualizações compreendem correções de defeitos, melhorias de desempenho, ajustes de segurança, ' +
            'adequações legais e evoluções funcionais.',
        ),
        par(
          '13.3. A CONTRATANTE não poderá recusar, adiar ou reverter atualizações, nem exigir a manutenção de ' +
            'versões anteriores, layouts, telas ou fluxos específicos.',
        ),
        par(
          '13.4. A AVECCHI poderá modificar, reorganizar, substituir ou descontinuar funcionalidades, desde que não ' +
            'descaracterize a natureza essencial dos Módulos contratados. A descontinuidade de funcionalidade ' +
            'relevante será comunicada com antecedência mínima de 60 (sessenta) dias, salvo quando decorrente de ' +
            'exigência legal, determinação de autoridade, risco de segurança ou descontinuidade por Terceiro Essencial.',
        ),
        par(
          '13.5. Funcionalidades poderão ser disponibilizadas em caráter experimental (beta), hipótese em que são ' +
            'fornecidas "no estado em que se encontram", sem SLA, sem garantia e sem responsabilidade da AVECCHI por ' +
            'eventuais efeitos de seu uso.',
        ),
        par(
          '13.6. Adequações decorrentes de novas obrigações legais aplicáveis à generalidade dos clientes serão ' +
            'implementadas dentro de prazo técnico razoável, observados a data de vigência da norma, a publicação de ' +
            'leiautes oficiais e a efetiva disponibilização de ambientes de homologação pelos órgãos competentes. A ' +
            'AVECCHI não responde por atrasos, alterações ou indefinições de origem governamental.',
        ),
        par(
          '13.7. O lançamento de novos Módulos ou de produtos autônomos não integra as atualizações inclusas e ' +
            'poderá ser comercializado separadamente.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 14 — SEGURANÇA DA INFORMAÇÃO',
      blocos: [
        par(
          '14.1. A AVECCHI adota programa de segurança da informação compatível com o estado da técnica, com as ' +
            'boas práticas de mercado e com a natureza dos dados tratados, detalhado no Anexo III, incluindo:',
        ),
        par('a) criptografia de dados em trânsito (TLS 1.2 ou superior) e em repouso;'),
        par('b) segregação lógica de dados entre clientes;'),
        par('c) controle de acesso baseado em perfis, com princípio do menor privilégio;'),
        par(
          'd) autenticação em múltiplos fatores (MFA) disponível para todos os usuários e obrigatória para perfis ' +
            'administrativos internos da AVECCHI;',
        ),
        par(
          'e) registro de logs de autenticação, de operações relevantes e de alterações de configuração, com data, ' +
            'hora, identificação de usuário e endereço IP;',
        ),
        par('f) trilhas de auditoria e rastreabilidade dos lançamentos, preservadas pelo prazo indicado no Anexo III;'),
        par('g) monitoramento de disponibilidade, de desempenho e de eventos de segurança;'),
        par('h) gestão de vulnerabilidades e aplicação tempestiva de correções;'),
        par('i) proteção de borda contra ataques volumétricos e de aplicação;'),
        par(
          'j) políticas internas de segurança, confidencialidade e controle de acesso aplicáveis a colaboradores e prestadores.',
        ),
        par(
          '14.2. Os logs e as trilhas de auditoria são de titularidade da AVECCHI enquanto registros de operação do ' +
            'Sistema, e serão disponibilizados à CONTRATANTE quando necessários à apuração de incidentes, ao ' +
            'exercício de direitos de Titulares ou ao cumprimento de determinação legal.',
        ),
        par(
          '14.3. Segurança de credenciais. A CONTRATANTE é integralmente responsável pela criação, guarda, rotação ' +
            'e revogação das credenciais de seus Usuários Licenciados. Operações realizadas mediante credenciais ' +
            'válidas presumem-se praticadas pela CONTRATANTE, salvo comunicação prévia de comprometimento.',
        ),
        par(
          '14.4. Incidentes de Segurança. Identificado incidente que afete o Sistema, a AVECCHI: (i) adotará ' +
            'medidas imediatas de contenção e mitigação; (ii) comunicará a CONTRATANTE em até 48 (quarenta e oito) ' +
            'horas do conhecimento, quando houver risco relevante aos seus dados; (iii) prestará as informações ' +
            'necessárias ao cumprimento do Capítulo 17; e (iv) elaborará relatório de causa-raiz e plano de ação.',
        ),
        par(
          '14.5. A comunicação de incidente não implica reconhecimento de culpa, responsabilidade ou falha de ' +
            'segurança pela AVECCHI.',
        ),
        par(
          '14.6. A CONTRATANTE poderá solicitar, uma vez por ano, mediante aviso de 30 (trinta) dias, relatório ' +
            'resumido de segurança, certificações ou respostas a questionário de conformidade. Auditorias ' +
            'presenciais ou testes de intrusão dependem de acordo prévio, escrito e específico, e correm às expensas ' +
            'da CONTRATANTE, sem acesso a código-fonte, a dados de outros clientes ou a informações que comprometam ' +
            'a segurança do ambiente compartilhado.',
        ),
        par(
          '14.7. A AVECCHI não responde por incidentes originados em ambiente, dispositivos, redes, credenciais ou ' +
            'integrações sob controle da CONTRATANTE, nem por vazamentos causados por seus próprios usuários.',
        ),
      ],
    },
  ];
}
