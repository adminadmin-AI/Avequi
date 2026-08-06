/** AVQ-CT v2 — Capítulos 15 a 27. Transcrição fiel (ver nota no texto-1). */
import { Capitulo, par } from './contract-v2-tipos';

export function capitulos15a27(): Capitulo[] {
  return [
    {
      titulo: 'CAPÍTULO 15 — BACKUP',
      blocos: [
        par(
          '15.1. A AVECCHI executa rotinas automáticas de cópia de segurança do ambiente, com periodicidade mínima ' +
            'diária, armazenamento criptografado e redundância geográfica, conforme detalhado no Anexo III.',
        ),
        par(
          '15.2. O prazo padrão de retenção dos backups é de 30 (trinta) dias corridos, admitida retenção estendida ' +
            'mediante contratação específica.',
        ),
        par(
          '15.3. A restauração é executada em nível de ambiente, para fins de continuidade operacional. ' +
            'Restaurações parciais, seletivas ou pontuais — de registros, tabelas ou períodos específicos — dependem ' +
            'de viabilidade técnica e, quando possíveis, serão orçadas como serviço adicional.',
        ),
        par(
          '15.4. A restauração de backup não desfaz lançamentos, exclusões ou alterações realizadas pela própria ' +
            'CONTRATANTE. A recuperação de dados excluídos por ação de seus Usuários Licenciados, quando ' +
            'tecnicamente viável, é serviço adicional e não está coberta pelo SLA.',
        ),
        par(
          '15.5. O backup mantido pela AVECCHI é medida de continuidade do serviço e não substitui as obrigações ' +
            'legais de guarda de documentos e arquivos da CONTRATANTE, que deverá manter suas próprias cópias por ' +
            'meio dos recursos de exportação do Capítulo 33.',
        ),
        par(
          '15.6. A AVECCHI não garante a integralidade absoluta de qualquer restauração, respondendo apenas pela ' +
            'execução diligente das rotinas contratadas.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 16 — RECUPERAÇÃO DE DESASTRES',
      blocos: [
        par(
          '16.1. A AVECCHI mantém plano de continuidade e recuperação de desastres (DRP) aplicável a eventos de ' +
            'indisponibilidade severa da infraestrutura, com os seguintes objetivos contratuais:',
        ),
        par('a) RTO (Recovery Time Objective): até 24 (vinte e quatro) horas para restabelecimento do Ambiente de Produção;'),
        par('b) RPO (Recovery Point Objective): perda máxima de dados equivalente a 24 (vinte e quatro) horas de operação.'),
        par(
          '16.2. Os objetivos de RTO e RPO são metas técnicas de melhor esforço qualificado e não integram o ' +
            'cálculo de créditos do Capítulo 11, salvo se o evento também caracterizar Indisponibilidade computável.',
        ),
        par(
          '16.3. Em caso de desastre, a AVECCHI priorizará: (i) a preservação da integridade dos dados; (ii) o ' +
            'restabelecimento das funções essenciais; (iii) a comunicação periódica às contas afetadas; e (iv) o ' +
            'restabelecimento das demais funcionalidades.',
        ),
        par(
          '16.4. O plano é testado periodicamente, ao menos uma vez por ano, com registro dos resultados, que ' +
            'poderão ser resumidos à CONTRATANTE mediante solicitação.',
        ),
        par(
          '16.5. Eventos que impliquem descontinuidade definitiva de Terceiro Essencial autorizam a AVECCHI a ' +
            'migrar a infraestrutura para provedor equivalente, comunicando a CONTRATANTE, sem que isso caracterize ' +
            'alteração contratual.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 17 — PROTEÇÃO DE DADOS PESSOAIS (LGPD)',
      blocos: [
        par(
          '17.1. As Partes obrigam-se a cumprir a Lei nº 13.709/2018 (LGPD), a Lei nº 12.965/2014 e a ' +
            'regulamentação da ANPD, observando o Anexo III, que é parte integrante deste contrato e vale como ' +
            'acordo de tratamento de dados pessoais.',
        ),
        par(
          '17.2. Papéis. Quanto aos Dados Pessoais inseridos ou gerados no Sistema pela CONTRATANTE, esta atua como ' +
            'Controladora e a AVECCHI como Operadora, tratando-os exclusivamente conforme as instruções lícitas e ' +
            'documentadas decorrentes deste contrato e do uso regular do Sistema.',
        ),
        par(
          '17.3. A AVECCHI atua como Controladora apenas quanto a: (i) dados cadastrais e de contato dos ' +
            'representantes da CONTRATANTE; (ii) dados de faturamento; (iii) logs técnicos, de segurança e de ' +
            'auditoria; e (iv) dados de uso agregados ou anonimizados, empregados para segurança, prevenção a ' +
            'fraudes, cumprimento legal e melhoria do Sistema.',
        ),
        par(
          '17.4. Bases legais e finalidade. Cabe exclusivamente à CONTRATANTE definir as finalidades, determinar as ' +
            'bases legais, atender aos princípios da LGPD, informar os Titulares e assegurar a licitude dos dados ' +
            'que inserir no Sistema. A AVECCHI não avalia, valida ou fiscaliza o conteúdo tratado pela CONTRATANTE.',
        ),
        par(
          '17.5. Dados sensíveis e de crianças. A CONTRATANTE somente inserirá dados pessoais sensíveis ou de ' +
            'crianças e adolescentes quando estritamente necessário à sua atividade e com base legal adequada, ' +
            'respondendo integralmente por essa decisão.',
        ),
        par('17.6. Obrigações da AVECCHI como Operadora. A AVECCHI obriga-se a:'),
        par('a) tratar os Dados Pessoais apenas conforme as instruções da CONTRATANTE e a finalidade deste contrato;'),
        par('b) manter as medidas de segurança do Capítulo 14 e do Anexo III;'),
        par('c) submeter seus colaboradores e prestadores a obrigações de confidencialidade;'),
        par(
          'd) auxiliar a CONTRATANTE, na medida do tecnicamente razoável, no atendimento de requisições de ' +
            'Titulares, de autoridades e da ANPD;',
        ),
        par(
          'e) comunicar à CONTRATANTE Incidentes de Segurança relevantes na forma da cláusula 14.4, com as ' +
            'informações necessárias para que esta cumpra o artigo 48 da LGPD e a Resolução CD/ANPD nº 15/2024;',
        ),
        par('f) manter registro das operações de tratamento que realizar;'),
        par('g) eliminar ou devolver os Dados Pessoais ao término do contrato, na forma do Capítulo 34.'),
        par(
          '17.7. Direitos dos Titulares. As requisições de Titulares serão atendidas pela CONTRATANTE, na qualidade ' +
            'de Controladora, utilizando os recursos nativos do Sistema. Requisições recebidas diretamente pela ' +
            'AVECCHI serão encaminhadas à CONTRATANTE em até 5 (cinco) Dias Úteis, sem que a AVECCHI responda ' +
            'diretamente ao Titular, salvo determinação legal. O suporte técnico extraordinário a essas requisições, ' +
            'quando exigir esforço relevante, poderá ser orçado.',
        ),
        par(
          '17.8. Comunicação de incidentes. Havendo incidente que possa acarretar risco ou dano relevante aos ' +
            'Titulares, a comunicação à ANPD e aos Titulares é dever da CONTRATANTE, na qualidade de Controladora, ' +
            'cabendo à AVECCHI fornecer, tempestivamente, as informações técnicas de que dispuser.',
        ),
        par(
          '17.9. Retenção e eliminação. Os Dados Pessoais serão retidos enquanto vigente o contrato e pelos prazos ' +
            'previstos no Capítulo 34, ressalvadas as hipóteses do artigo 16 da LGPD, especialmente o cumprimento de ' +
            'obrigação legal ou regulatória, o exercício regular de direitos e a guarda de registros de acesso.',
        ),
        par(
          '17.10. Anonimização. A AVECCHI poderá anonimizar Dados Pessoais e utilizar dados agregados, estatísticos ' +
            'e não identificáveis para desenvolvimento de produto, análise de desempenho, benchmarking de mercado e ' +
            'aprimoramento de recursos, inclusive de inteligência artificial, sem que isso caracterize Tratamento de ' +
            'Dados Pessoais, nos termos do artigo 12 da LGPD. Em nenhuma hipótese serão divulgados dados que ' +
            'permitam identificar a CONTRATANTE ou seus clientes.',
        ),
        par(
          '17.11. Transferência internacional. A CONTRATANTE reconhece e autoriza que a infraestrutura do Sistema ' +
            'poderá envolver transferência internacional de dados, hipótese em que a AVECCHI exigirá dos provedores ' +
            'garantias adequadas, nos termos dos artigos 33 a 36 da LGPD, priorizando, sempre que tecnicamente ' +
            'viável, o armazenamento em território nacional ou em regiões com nível de proteção adequado.',
        ),
        par(
          '17.12. Responsabilidade. Cada Parte responde pelas consequências de suas próprias condutas em matéria de ' +
            'proteção de dados. A CONTRATANTE isentará e indenizará a AVECCHI de reclamações, autuações, condenações ' +
            'e custos decorrentes de: (i) ausência ou inadequação de base legal; (ii) inserção de dados ilícitos ou ' +
            'desnecessários; (iii) instruções contrárias à LGPD; (iv) falhas de gestão de acessos, credenciais ou ' +
            'perfis; e (v) incidentes originados em seu próprio ambiente.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 18 — SUBOPERADORES',
      blocos: [
        par(
          '18.1. A CONTRATANTE autoriza expressamente a AVECCHI a contratar Suboperadores para a execução dos ' +
            'serviços, especialmente para hospedagem, banco de dados, rede de distribuição de conteúdo, envio de ' +
            'e-mails e mensagens, processamento de pagamentos, emissão de documentos fiscais, observabilidade e suporte.',
        ),
        par(
          '18.2. A relação de Suboperadores e provedores relevantes consta do Anexo IV e é mantida atualizada no ' +
            'Portal Avecchi.',
        ),
        par(
          '18.3. A AVECCHI exigirá dos Suboperadores obrigações de proteção de dados e segurança equivalentes às ' +
            'deste contrato e permanecerá responsável perante a CONTRATANTE pela atuação deles no que se refere ao ' +
            'Tratamento de Dados Pessoais, nos limites do Capítulo 37.',
        ),
        par(
          '18.4. Alterações na relação de Suboperadores serão comunicadas com antecedência mínima de 30 (trinta) ' +
            'dias, por e-mail ou pelo Portal Avecchi. A CONTRATANTE poderá se opor, por escrito e de forma ' +
            'fundamentada em risco concreto de proteção de dados, em até 15 (quinze) dias. Não havendo solução ' +
            'técnica alternativa, qualquer das Partes poderá rescindir o contrato sem multa quanto ao Módulo afetado.',
        ),
        par(
          '18.5. Substituições emergenciais, motivadas por risco de segurança, descontinuidade do provedor ou ' +
            'determinação legal, poderão ser realizadas de imediato, com comunicação posterior.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 19 — APIs',
      blocos: [
        par(
          '19.1. A AVECCHI poderá disponibilizar APIs para integração do Sistema com aplicações da CONTRATANTE ou ' +
            'de terceiros, conforme documentação técnica publicada no Portal Avecchi.',
        ),
        par(
          '19.2. O uso das APIs é pessoal, vinculado à conta da CONTRATANTE, e sujeito a: (i) autenticação por ' +
            'chaves ou tokens individualizados; (ii) limites de requisições (rate limits) publicados na ' +
            'Documentação; (iii) limites de volume incluídos no plano contratado; e (iv) registro integral de ' +
            'chamadas para fins de auditoria.',
        ),
        par(
          '19.3. As chaves e tokens são confidenciais. A CONTRATANTE responde integralmente por seu uso, inclusive ' +
            'por terceiros a quem os tenha fornecido, e deverá solicitar revogação imediata em caso de comprometimento.',
        ),
        par(
          '19.4. Excedidos os limites contratados, a AVECCHI poderá, a seu critério e mediante comunicação: (i) ' +
            'aplicar limitação temporária de taxa (throttling); (ii) cobrar o excedente conforme tabela vigente; ou ' +
            '(iii) suspender o acesso à API em caso de uso abusivo que comprometa a estabilidade do ambiente compartilhado.',
        ),
        par(
          '19.5. É vedado o uso das APIs para extração massiva e sistemática de dados com finalidade de replicação ' +
            'do Sistema, criação de produto concorrente ou revenda de acesso.',
        ),
        par(
          '19.6. As APIs podem ser alteradas, versionadas ou descontinuadas. Alterações que quebrem ' +
            'compatibilidade (breaking changes) serão comunicadas com antecedência mínima de 60 (sessenta) dias, com ' +
            'manutenção da versão anterior sempre que tecnicamente viável, ressalvadas alterações emergenciais de ' +
            'segurança ou exigência legal.',
        ),
        par(
          '19.7. A AVECCHI não responde pelo funcionamento, desempenho, segurança ou continuidade de aplicações de ' +
            'terceiros que consumam suas APIs, nem por prejuízos decorrentes de integrações desenvolvidas fora de ' +
            'sua execução.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 20 — INTEGRAÇÕES COM TERCEIROS',
      blocos: [
        par(
          '20.1. O Sistema pode integrar-se a serviços de terceiros, incluindo instituições financeiras, ' +
            'provedores de pagamento e Open Finance (como Pluggy), provedores de mensageria (como WhatsApp Business ' +
            'API), provedores de e-mail, marketplaces, transportadoras, certificadoras digitais e órgãos públicos.',
        ),
        par(
          '20.2. As integrações dependem de contratos, credenciais, habilitações e adimplemento da CONTRATANTE ' +
            'junto aos respectivos terceiros, cujos termos de uso e políticas são de aceitação e responsabilidade ' +
            'exclusiva da CONTRATANTE.',
        ),
        par(
          '20.3. A AVECCHI não é parte nas relações entre a CONTRATANTE e os terceiros integrados e não responde, ' +
            'em nenhuma hipótese, por: (i) indisponibilidade, lentidão, alteração unilateral, bloqueio, suspensão ou ' +
            'descontinuidade dos serviços de terceiros; (ii) alterações de APIs, políticas, tarifas ou regras dos ' +
            'terceiros; (iii) recusa, glosa, bloqueio, estorno ou retenção de valores por instituições financeiras ' +
            'ou provedores de pagamento; (iv) bloqueio de números, contas ou modelos de mensagem por provedores de ' +
            'mensageria; (v) entrega, atraso ou classificação de e-mails como spam por provedores de destino.',
        ),
        par(
          '20.4. Sempre que a indisponibilidade de terceiro impedir uma funcionalidade, a AVECCHI envidará esforços ' +
            'razoáveis para informar a ocorrência e, quando existir, indicar procedimento de contingência. O período ' +
            'correspondente não será computado como Indisponibilidade.',
        ),
        par(
          '20.5. Integrações personalizadas, não catalogadas ou desenvolvidas sob demanda seguem o Capítulo 26 e ' +
            'podem gerar custos de implementação e manutenção.',
        ),
        par(
          '20.6. A descontinuidade definitiva de uma integração por decisão do terceiro não caracteriza ' +
            'inadimplemento da AVECCHI nem gera direito a abatimento, salvo se o Módulo contratado se tornar ' +
            'essencialmente inútil, hipótese em que as Partes negociarão a readequação comercial ou a exclusão do Módulo.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 21 — EMISSÃO DE DOCUMENTOS FISCAIS',
      blocos: [
        par(
          '21.1. Quando contratado Módulo com emissão de documentos fiscais eletrônicos (tais como NF-e, NFC-e, ' +
            'NFS-e, CT-e e MDF-e), o Sistema atuará como ferramenta de geração e transmissão dos arquivos às ' +
            'autoridades competentes.',
        ),
        par(
          '21.2. A CONTRATANTE é a emitente e única responsável pelo conteúdo dos documentos fiscais, incluindo: ' +
            'dados cadastrais, descrição de produtos e serviços, CFOP, NCM, CST, CSOSN, códigos de serviço ' +
            'municipais, alíquotas, bases de cálculo, regimes especiais, benefícios fiscais e obrigações acessórias.',
        ),
        par(
          '21.3. A emissão depende de: (i) certificado digital válido e vigente, de titularidade e responsabilidade ' +
            'da CONTRATANTE; (ii) credenciamento e habilitação junto aos órgãos competentes; (iii) parâmetros ' +
            'fiscais corretamente configurados; e (iv) disponibilidade dos ambientes públicos de autorização.',
        ),
        par(
          '21.4. A AVECCHI não responde por: (i) indisponibilidade, lentidão, rejeição, alteração de leiaute ou ' +
            'mudança de regras da SEFAZ, da Receita Federal, de prefeituras ou de qualquer órgão público; (ii) ' +
            'rejeições decorrentes de dados incorretos ou de parametrização fiscal inadequada; (iii) autuações, ' +
            'multas, glosas ou penalidades fiscais aplicadas à CONTRATANTE; (iv) expiração, revogação ou uso ' +
            'indevido de certificado digital.',
        ),
        par(
          '21.5. A CONTRATANTE deverá conferir cada documento emitido e adotar imediatamente os procedimentos de ' +
            'correção, cancelamento ou inutilização previstos na legislação, dentro dos prazos legais.',
        ),
        par(
          '21.6. Em caso de indisponibilidade dos ambientes oficiais, a CONTRATANTE deverá adotar os procedimentos ' +
            'de contingência previstos na legislação aplicável.',
        ),
        par(
          '21.7. A guarda legal dos arquivos XML e demais documentos fiscais é obrigação da CONTRATANTE, que deverá ' +
            'realizar exportações periódicas. O armazenamento pelo Sistema é funcionalidade de conveniência, ' +
            'limitada à vigência contratual e aos prazos do Capítulo 34.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 22 — ALTERAÇÕES TRIBUTÁRIAS',
      blocos: [
        par(
          '22.1. A AVECCHI envidará esforços para manter o Sistema atualizado quanto às normas fiscais de aplicação ' +
            'geral, observados prazo técnico razoável e a efetiva publicação de leiautes, notas técnicas e ambientes ' +
            'de homologação pelos órgãos competentes.',
        ),
        par(
          '22.2. Regras específicas de um contribuinte — regimes especiais, benefícios setoriais, protocolos, ' +
            'convênios, decisões judiciais individuais, consultas fiscais e particularidades municipais — não ' +
            'integram a atualização geral e, quando tecnicamente viáveis, serão tratadas como parametrização ' +
            'assistida ou desenvolvimento sob demanda.',
        ),
        par(
          '22.3. A CONTRATANTE é responsável por acompanhar, por meio de seus profissionais habilitados, as ' +
            'alterações que lhe sejam aplicáveis e por comunicar tempestivamente a AVECCHI sobre necessidades de ' +
            'configuração.',
        ),
        par(
          '22.4. Alterações legislativas que aumentem, criem ou majorem tributos incidentes sobre o objeto deste ' +
            'contrato, ou que alterem a sistemática de sua apuração, autorizam o repasse integral do impacto ' +
            'econômico ao preço, com efeito a partir da vigência da norma, mediante comunicação com memória de ' +
            'cálculo, preservado o equilíbrio econômico-financeiro original.',
        ),
        par('22.5. Reduções de carga tributária que impactem o preço serão igualmente refletidas, na mesma proporção.'),
      ],
    },
    {
      titulo: 'CAPÍTULO 23 — REFORMA TRIBUTÁRIA',
      blocos: [
        par(
          '23.1. As Partes reconhecem que a Emenda Constitucional nº 132/2023 e a Lei Complementar nº 214/2025 ' +
            'instituíram a Contribuição sobre Bens e Serviços (CBS) e o Imposto sobre Bens e Serviços (IBS), com ' +
            'implantação escalonada e substituição gradual de PIS, COFINS, ICMS e ISS, incluindo período de ' +
            'transição com convivência de sistemáticas.',
        ),
        par(
          '23.2. Os valores pactuados no Anexo I foram calculados com base na carga tributária vigente na data da ' +
            'assinatura. A migração para a nova sistemática, a extinção ou instituição de tributos, a alteração de ' +
            'alíquotas de referência, a modificação de regras de creditamento, de local de incidência ou de ' +
            'repartição, bem como a perda ou redução de benefícios fiscais, constituem fato superveniente apto a ' +
            'ensejar a revisão do preço.',
        ),
        par(
          '23.3. Verificado impacto econômico decorrente da reforma tributária, o preço será ajustado de modo a ' +
            'preservar a margem líquida original da AVECCHI, mediante comunicação escrita acompanhada de memória de ' +
            'cálculo, com antecedência mínima de 30 (trinta) dias da vigência do novo valor.',
        ),
        par(
          '23.4. O ajuste previsto nesta cláusula é cumulativo e independente do reajuste anual do Capítulo 30 e ' +
            'não se confunde com ele.',
        ),
        par(
          '23.5. Caso o novo regime permita à CONTRATANTE a apropriação de créditos sobre os valores pagos, as ' +
            'Partes reconhecem que eventual acréscimo nominal do preço poderá ser neutro ou favorável em termos de ' +
            'custo efetivo, o que será considerado na composição do ajuste.',
        ),
        par(
          '23.6. Discordando do ajuste, a CONTRATANTE poderá rescindir o contrato, sem multa, mediante aviso ' +
            'escrito enviado em até 30 (trinta) dias da comunicação, permanecendo devidos os valores até a data da ' +
            'rescisão. O silêncio ou a continuidade de uso após a vigência do novo valor importam aceitação tácita.',
        ),
        par(
          '23.7. A AVECCHI emitirá seus documentos fiscais conforme a legislação vigente a cada competência, ' +
            'cabendo a cada Parte o cumprimento de suas próprias obrigações principais e acessórias.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 24 — PROPRIEDADE INTELECTUAL',
      blocos: [
        par(
          '24.1. O Avecchi ERP, incluindo código-fonte, código-objeto, arquitetura, modelagem de dados, algoritmos, ' +
            'APIs, interfaces, telas, layouts, fluxos, documentação, manuais, materiais de treinamento, nomes, ' +
            'marcas, domínios e sinais distintivos, é de titularidade exclusiva da AVECCHI, protegido pelas Leis nº ' +
            '9.609/1998 e nº 9.610/1998 e pela legislação de propriedade industrial.',
        ),
        par(
          '24.2. Este contrato concede exclusivamente direito de uso e não transfere, cede ou licencia qualquer ' +
            'outro direito de propriedade intelectual, ainda que parcialmente.',
        ),
        par(
          '24.3. O código-fonte é segredo de negócio da AVECCHI, não sendo objeto de entrega, depósito, custódia ' +
            '(escrow), inspeção ou disponibilização em qualquer hipótese, inclusive em caso de rescisão.',
        ),
        par(
          '24.4. Os Dados do Cliente permanecem de titularidade da CONTRATANTE, que concede à AVECCHI licença ' +
            'limitada, não exclusiva e gratuita para hospedá-los, processá-los, transmiti-los e exibi-los na estrita ' +
            'medida necessária à prestação dos serviços e ao cumprimento deste contrato.',
        ),
        par(
          '24.5. A CONTRATANTE poderá referir-se à AVECCHI como sua fornecedora de tecnologia. A AVECCHI poderá ' +
            'utilizar o nome e o logotipo da CONTRATANTE em sua relação de clientes e em materiais institucionais, ' +
            'de forma sóbria e não depreciativa, facultada à CONTRATANTE revogar essa autorização por comunicação ' +
            'escrita a qualquer tempo.',
        ),
        par(
          '24.6. A AVECCHI garante que o Sistema não viola direitos de propriedade intelectual de terceiros e ' +
            'defenderá a CONTRATANTE em reclamações de terceiros fundadas em alegada violação, desde que: (i) ' +
            'notificada imediatamente; (ii) lhe seja assegurada a condução da defesa e da negociação; e (iii) a ' +
            'CONTRATANTE coopere. Verificada violação, a AVECCHI poderá, a seu critério, modificar o Sistema, ' +
            'substituir a funcionalidade ou rescindir o contrato com devolução proporcional dos valores pagos e não ' +
            'usufruídos, sendo estas as únicas obrigações a esse título.',
        ),
        par(
          '24.7. A garantia da cláusula 24.6 não se aplica a violações decorrentes de uso indevido, modificação, ' +
            'integração não autorizada, combinação com produtos de terceiros ou descumprimento da Documentação pela ' +
            'CONTRATANTE.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 25 — MELHORIAS E SUGESTÕES DO CLIENTE',
      blocos: [
        par('25.1. A AVECCHI incentiva o envio de sugestões, críticas, ideias e pedidos de melhoria pelos canais oficiais.'),
        par(
          '25.2. Todas as sugestões, feedbacks e requisitos funcionais enviados pela CONTRATANTE, bem como as ' +
            'funcionalidades deles decorrentes, são incorporados ao Sistema e passam a integrar a propriedade ' +
            'exclusiva e irrestrita da AVECCHI, sem qualquer contrapartida, remuneração, participação, royalty ou ' +
            'direito de exclusividade em favor da CONTRATANTE.',
        ),
        par(
          '25.3. A CONTRATANTE renuncia, de forma expressa e irrevogável, a qualquer pretensão de coautoria, ' +
            'cotitularidade ou compensação sobre melhorias implementadas a partir de suas sugestões, ainda que originais.',
        ),
        par(
          '25.4. As melhorias, uma vez publicadas, ficam disponíveis a toda a base de clientes da AVECCHI, sem que ' +
            'isso configure quebra de confidencialidade, uso indevido de informação ou violação de qualquer direito, ' +
            'desde que não revelem dados, processos ou informações confidenciais identificáveis da CONTRATANTE.',
        ),
        par(
          '25.5. O envio de sugestão não gera obrigação de desenvolvimento, prazo, prioridade ou resposta. A ' +
            'AVECCHI define livremente seu roteiro de produto (roadmap), que possui caráter meramente indicativo e ' +
            'pode ser alterado a qualquer tempo.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 26 — DESENVOLVIMENTO SOB DEMANDA',
      blocos: [
        par(
          '26.1. Funcionalidades específicas não contempladas no Sistema poderão ser desenvolvidas mediante ' +
            'contratação apartada, formalizada por proposta ou ordem de serviço que contenha escopo, prazo, valor, ' +
            'forma de pagamento e critérios de aceite.',
        ),
        par(
          '26.2. A ordem de serviço aceita — inclusive por e-mail ou pelo Portal Avecchi — integra este contrato ' +
            'como aditivo, permanecendo aplicáveis todas as demais cláusulas.',
        ),
        par(
          '26.3. Salvo estipulação expressa em contrário, toda a propriedade intelectual sobre o desenvolvimento ' +
            'sob demanda, inclusive customizações e integrações, pertence integralmente à AVECCHI, que poderá ' +
            'incorporá-lo ao produto padrão e disponibilizá-lo a outros clientes. A CONTRATANTE recebe direito de ' +
            'uso nos mesmos termos do Capítulo 4.',
        ),
        par(
          '26.4. Exclusividade sobre funcionalidade desenvolvida, quando desejada, dependerá de acordo escrito ' +
            'específico, com prazo determinado e remuneração própria.',
        ),
        par(
          '26.5. Concluído o desenvolvimento, a CONTRATANTE terá 10 (dez) dias corridos para homologação. O ' +
            'silêncio ou a utilização em produção importam aceite tácito, iniciando-se o prazo de garantia de 90 ' +
            '(noventa) dias para correção de defeitos de conformidade com o escopo aprovado.',
        ),
        par(
          '26.6. Alterações de escopo solicitadas durante a execução serão tratadas como nova demanda, com ' +
            'reorçamento e reprogramação de prazos.',
        ),
        par(
          '26.7. A manutenção evolutiva de desenvolvimentos específicos, quando exigida por alterações de terceiros ' +
            'ou de legislação, poderá ser cobrada separadamente.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 27 — CONFIDENCIALIDADE',
      blocos: [
        par(
          '27.1. Considera-se Informação Confidencial toda informação, em qualquer meio, revelada por uma Parte à ' +
            'outra em razão deste contrato, incluindo dados técnicos, comerciais, financeiros, estratégicos, ' +
            'cadastrais, de clientes, preços, propostas, arquitetura, código, credenciais, relatórios de segurança e ' +
            'o próprio teor deste instrumento.',
        ),
        par(
          '27.2. As Partes obrigam-se a: (i) manter sigilo; (ii) utilizar a Informação Confidencial apenas para a ' +
            'execução deste contrato; (iii) restringir o acesso a colaboradores e prestadores que dela necessitem, ' +
            'submetidos a obrigações equivalentes; e (iv) adotar medidas de proteção ao menos tão rigorosas quanto ' +
            'as aplicadas às próprias informações.',
        ),
        par(
          '27.3. Não é confidencial a informação que: (i) seja ou se torne pública sem violação deste contrato; ' +
            '(ii) já fosse legitimamente conhecida da Parte receptora; (iii) seja desenvolvida de forma ' +
            'independente; ou (iv) seja recebida de terceiro sem dever de sigilo.',
        ),
        par(
          '27.4. Havendo determinação legal, judicial ou de autoridade competente para divulgação, a Parte ' +
            'notificada comunicará previamente a outra, salvo proibição expressa, limitando a divulgação ao ' +
            'estritamente exigido.',
        ),
        par(
          '27.5. As obrigações de confidencialidade vigoram durante o contrato e por 5 (cinco) anos após seu ' +
            'término, prazo indeterminado no caso de segredos de negócio, código-fonte e dados pessoais.',
        ),
        par(
          '27.6. Não concorrência quanto ao software. Durante a vigência e por 24 (vinte e quatro) meses após o ' +
            'término, a CONTRATANTE obriga-se a não utilizar, direta ou indiretamente, informações obtidas do ' +
            'Sistema para desenvolver, encomendar, financiar, especificar ou comercializar solução concorrente ao ' +
            'Avecchi ERP, nem a aliciar colaboradores-chave da AVECCHI. Esta restrição não impede a CONTRATANTE de ' +
            'contratar livremente qualquer software de mercado.',
        ),
        par(
          '27.7. A violação desta cláusula sujeita a Parte infratora a multa de R$ 50.000,00 (cinquenta mil reais) ' +
            'por evento, sem prejuízo das perdas e danos excedentes e de tutelas específicas, não se aplicando o ' +
            'limite do Capítulo 37.',
        ),
      ],
    },
  ];
}
