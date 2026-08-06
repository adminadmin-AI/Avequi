/** AVQ-CT v2 — Capítulos 28 a 43. Transcrição fiel (ver nota no texto-1). */
import { Capitulo, ContratoV2Params, par, PENDENTE, tabela } from './contract-v2-tipos';

export function capitulos28a43(p: ContratoV2Params): Capitulo[] {
  const comarca = p.operadora.comarca ?? PENDENTE;
  return [
    {
      titulo: 'CAPÍTULO 28 — VALORES',
      blocos: [
        par(
          '28.1. Pela licença de uso e pelos serviços, a CONTRATANTE pagará os valores discriminados no Anexo I, ' +
            'que contempla mensalidade, valores de implantação, treinamentos, migração e demais itens contratados.',
        ),
        par(
          '28.2. A mensalidade é devida em razão da disponibilização do Sistema, sendo integralmente exigível ' +
            'independentemente do volume de uso, do número de acessos, do efetivo aproveitamento das funcionalidades ' +
            'ou da conclusão de treinamentos.',
        ),
        par(
          '28.3. Os valores não incluem: (i) tributos incidentes sobre a operação, quando destacáveis; (ii) ' +
            'certificados digitais; (iii) serviços de terceiros; (iv) tarifas bancárias e de meios de pagamento; (v) ' +
            'consumo excedente de APIs, mensagens, armazenamento ou usuários adicionais; (vi) desenvolvimentos sob ' +
            'demanda e serviços adicionais.',
        ),
        par(
          '28.4. Excedentes de consumo serão apurados mensalmente e faturados no ciclo seguinte, conforme tabela ' +
            'vigente publicada no Portal Avecchi.',
        ),
        par(
          '28.5. Alterações de plano, de Módulos ou do número de Usuários Licenciados formalizadas pelo Portal ' +
            'Avecchi, por e-mail ou por proposta aceita integram automaticamente este contrato como aditivo, ' +
            'dispensada nova assinatura, com efeitos a partir do ciclo indicado.',
        ),
        par(
          '28.6. Descontos, bonificações, isenções ou condições promocionais são concedidos por mera liberalidade, ' +
            'têm caráter temporário e não se incorporam ao contrato, podendo ser suprimidos ao término do período ' +
            'pactuado ou em caso de inadimplência.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 29 — FORMA DE PAGAMENTO',
      blocos: [
        par(
          '29.1. O faturamento é mensal, com vencimento no dia indicado no Anexo I, contra fatura, boleto, PIX, ' +
            'cobrança recorrente em cartão ou débito automático, conforme meio escolhido.',
        ),
        par(
          '29.2. A fatura será disponibilizada no Portal Avecchi e/ou encaminhada ao e-mail de cobrança cadastrado, ' +
            'com antecedência mínima de 5 (cinco) dias do vencimento. O não recebimento da fatura não exonera a ' +
            'CONTRATANTE do pagamento, cabendo-lhe solicitar a segunda via em tempo hábil.',
        ),
        par('29.3. O primeiro ciclo poderá ser proporcional (pro rata) aos dias de disponibilização.'),
        par(
          '29.4. Optando a CONTRATANTE por cobrança recorrente automatizada, autoriza desde já os débitos ' +
            'correspondentes, obrigando-se a manter meios de pagamento válidos e com limite suficiente. A recusa da ' +
            'operadora não caracteriza suspensão da exigibilidade.',
        ),
        par(
          '29.5. Os pagamentos são irretratáveis e irrepetíveis, não havendo devolução de valores relativos a ' +
            'períodos já disponibilizados, ainda que não utilizados.',
        ),
        par(
          '29.6. É vedada a compensação unilateral, a retenção ou o abatimento de valores pela CONTRATANTE, ainda ' +
            'que sob alegação de falha na prestação, ressalvados os créditos de serviço do Capítulo 11 formalmente ' +
            'reconhecidos.',
        ),
        par(
          '29.7. Contestações de fatura deverão ser apresentadas por escrito até o vencimento, com fundamentação. A ' +
            'parte incontroversa deverá ser paga no prazo, sob pena de incidência dos encargos do Capítulo 31.',
        ),
        par(
          '29.8. Cada Parte arcará com os tributos que legalmente lhe couberem. Retenções tributárias exigidas por ' +
            'lei serão comprovadas documentalmente pela CONTRATANTE; a ausência de comprovação torna o valor retido ' +
            'devido à AVECCHI.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 30 — REAJUSTES',
      blocos: [
        par(
          '30.1. Os valores serão reajustados a cada 12 (doze) meses, contados da data de assinatura, pela variação ' +
            'acumulada do IPCA/IBGE ou do IGP-M/FGV, aplicando-se o índice de maior variação no período.',
        ),
        par('30.2. Sendo negativa a variação de ambos os índices, o valor vigente será mantido, sem redução.'),
        par(
          '30.3. Extintos, suspensos ou tornados inaplicáveis os índices eleitos, será adotado o índice oficial que ' +
            'os substitua e, na ausência, aquele que melhor reflita a variação de custos do setor de tecnologia, ' +
            'mediante acordo entre as Partes.',
        ),
        par('30.4. Havendo autorização legal para periodicidade inferior a 12 meses, as Partes poderão adotá-la.'),
        par(
          '30.5. Além do reajuste anual, o preço poderá ser revisto, de forma extraordinária e cumulativa, nas ' +
            'hipóteses dos Capítulos 22 e 23 e quando houver elevação superior a 20% (vinte por cento) nos custos de ' +
            'infraestrutura, licenças de terceiros, variação cambial ou serviços essenciais à operação, mediante ' +
            'comunicação com memória de cálculo e antecedência mínima de 30 (trinta) dias, assegurado à CONTRATANTE ' +
            'o direito de rescindir sem multa em 30 (trinta) dias.',
        ),
        par(
          '30.6. O reajuste opera de pleno direito, independentemente de aditivo, bastando a comunicação e a ' +
            'emissão da fatura correspondente.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 31 — INADIMPLÊNCIA',
      blocos: [
        par('31.1. O atraso no pagamento sujeitará a CONTRATANTE, independentemente de notificação, a:'),
        par('a) multa moratória de 2% (dois por cento) sobre o valor em atraso;'),
        par('b) juros de mora de 1% (um por cento) ao mês, pro rata die;'),
        par('c) correção monetária pelo IPCA/IBGE, desde o vencimento até o efetivo pagamento;'),
        par(
          'd) honorários advocatícios de 10% (dez por cento) em caso de cobrança extrajudicial, e o percentual ' +
            'fixado judicialmente em caso de ação.',
        ),
        par('31.2. A régua de cobrança observará as seguintes etapas:'),
        tabela(
          ['Prazo', 'Medida'],
          [
            ['A partir do 3º dia de atraso', 'Lembrete por e-mail e no Sistema'],
            ['A partir do 10º dia', 'Aviso de pendência exibido no Sistema, com bloqueio de emissão de novos usuários'],
            ['A partir do 20º dia', 'Notificação formal de suspensão iminente'],
            ['A partir do 25º dia', 'Suspensão do acesso, na forma do Capítulo 32'],
            ['A partir do 60º dia', 'Faculdade de rescisão por justa causa, independentemente de aviso prévio'],
          ],
        ),
        par(
          '31.3. A AVECCHI poderá, a partir do 30º (trigésimo) dia de atraso, protestar os títulos, negativar a ' +
            'CONTRATANTE junto a órgãos de proteção ao crédito e adotar as medidas judiciais cabíveis, valendo este ' +
            'contrato, acompanhado das faturas, como título executivo extrajudicial, nos termos do artigo 784, ' +
            'inciso III, do Código de Processo Civil.',
        ),
        par(
          '31.4. Havendo mais de uma pendência, os pagamentos serão imputados primeiro aos encargos, depois aos ' +
            'débitos mais antigos.',
        ),
        par(
          '31.5. A tolerância eventual quanto a atrasos não constitui novação, renúncia, alteração de prazo ou ' +
            'precedente.',
        ),
        par(
          '31.6. Verificada inadimplência superior a 30 (trinta) dias, a AVECCHI poderá suspender o atendimento de ' +
            'suporte não crítico e a execução de Serviços Profissionais em andamento, sem que isso configure ' +
            'inadimplemento de sua parte.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 32 — SUSPENSÃO',
      blocos: [
        par('32.1. A AVECCHI poderá suspender, total ou parcialmente, o acesso ao Sistema nas hipóteses de:'),
        par('a) inadimplência, na forma do Capítulo 31;'),
        par('b) violação das limitações de uso da cláusula 4.5;'),
        par('c) uso que comprometa a segurança, a estabilidade ou o desempenho do ambiente compartilhado;'),
        par('d) indício fundado de fraude, ilicitude ou uso do Sistema para atividade contrária à lei;'),
        par('e) determinação de autoridade competente ou decisão judicial;'),
        par('f) risco iminente de dano a dados, à AVECCHI ou a terceiros.'),
        par(
          '32.2. Nas hipóteses das alíneas "c" a "f", a suspensão poderá ser imediata, com comunicação simultânea ' +
            'ou posterior. Nas demais, será precedida de comunicação com antecedência mínima de 5 (cinco) dias.',
        ),
        par(
          '32.3. Durante a suspensão: (i) os dados são preservados, não sendo excluídos; (ii) as mensalidades ' +
            'continuam sendo devidas, pois o ambiente permanece provisionado; (iii) não há aplicação de SLA nem ' +
            'direito a créditos; (iv) permanecem vigentes as obrigações de confidencialidade e proteção de dados.',
        ),
        par(
          '32.4. A reativação ocorrerá em até 3 (três) Dias Úteis contados da quitação integral dos valores em ' +
            'aberto, incluídos encargos, ou da comprovada cessação da causa que motivou a suspensão.',
        ),
        par(
          '32.5. A AVECCHI poderá cobrar taxa de reativação equivalente a 10% (dez por cento) de uma mensalidade, a ' +
            'partir da segunda suspensão por inadimplência dentro de um mesmo período de 12 (doze) meses.',
        ),
        par(
          '32.6. A suspensão não impede a rescisão posterior por justa causa nem a cobrança dos valores devidos.',
        ),
        par(
          '32.7. Mesmo durante a suspensão por inadimplência, a AVECCHI disponibilizará, mediante solicitação ' +
            'escrita e por período de até 5 (cinco) Dias Úteis, acesso restrito para exportação de dados fiscais e ' +
            'contábeis de guarda obrigatória, sem que isso implique restabelecimento do serviço.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 33 — EXPORTAÇÃO DOS DADOS',
      blocos: [
        par(
          '33.1. Durante toda a vigência, a CONTRATANTE poderá exportar seus dados por meio dos recursos nativos do ' +
            'Sistema, em formatos estruturados de uso comum, tais como CSV, XLSX, XML e PDF, conforme a natureza de ' +
            'cada informação.',
        ),
        par(
          '33.2. A exportação é operação de autosserviço, executada pelos próprios Usuários Licenciados com perfil ' +
            'autorizado, sem custo adicional e sem limite de quantidade, respeitados os limites técnicos de volume ' +
            'por requisição.',
        ),
        par(
          '33.3. Extrações extraordinárias, em formatos específicos, com transformações, ou de bases completas em ' +
            'formato de banco de dados, quando tecnicamente viáveis, serão orçadas como serviço adicional, observado ' +
            'o sigilo da estrutura do Sistema.',
        ),
        par(
          '33.4. A AVECCHI não fornece, em nenhuma hipótese, cópia do banco de dados em formato proprietário, dumps ' +
            'completos com estrutura interna, dicionários de dados internos ou quaisquer elementos que revelem a ' +
            'arquitetura do Sistema.',
        ),
        par(
          '33.5. A CONTRATANTE reconhece que a exportação regular e periódica de seus dados é medida de prudência ' +
            'sob sua exclusiva responsabilidade, especialmente quanto a documentos de guarda legal obrigatória.',
        ),
        par('33.6. Encerrado o contrato, aplica-se o Capítulo 34.'),
      ],
    },
    {
      titulo: 'CAPÍTULO 34 — ENCERRAMENTO DA CONTA',
      blocos: [
        par(
          '34.1. Encerrado o contrato, por qualquer motivo, a conta entrará em fase de encerramento programado, com ' +
            'os seguintes prazos, contados da data de término:',
        ),
        tabela(
          ['Fase', 'Prazo', 'Condição'],
          [
            [
              'Janela de exportação',
              '30 (trinta) dias corridos',
              'Acesso restrito, exclusivamente para consulta e exportação de dados, sem inclusão de novos lançamentos',
            ],
            [
              'Retenção pós-janela',
              'mais 30 (trinta) dias corridos',
              'Dados mantidos inacessíveis; recuperação possível mediante taxa técnica',
            ],
            [
              'Exclusão definitiva',
              'a partir do 61º dia',
              'Eliminação dos dados do ambiente de produção, independentemente de nova notificação',
            ],
            ['Expurgo de backups', 'até 90 (noventa) dias após a exclusão', 'Eliminação natural pelos ciclos de retenção de backup'],
          ],
        ),
        par(
          '34.2. A janela de exportação fica condicionada à quitação integral de todos os valores devidos. Havendo ' +
            'débito em aberto, a AVECCHI disponibilizará apenas a exportação de documentos de guarda legal ' +
            'obrigatória, na forma da cláusula 32.7.',
        ),
        par(
          '34.3. A extensão da janela de exportação poderá ser contratada, mediante pagamento de valor equivalente ' +
            'à mensalidade vigente por mês adicional de manutenção do ambiente.',
        ),
        par(
          '34.4. Após a exclusão definitiva, a recuperação dos dados é tecnicamente impossível, o que a ' +
            'CONTRATANTE expressamente reconhece e aceita, isentando a AVECCHI de qualquer responsabilidade a esse título.',
        ),
        par(
          '34.5. A AVECCHI poderá reter, mesmo após a exclusão, os dados estritamente necessários ao cumprimento de ' +
            'obrigação legal ou regulatória, ao exercício regular de direitos em processo e à guarda de registros de ' +
            'acesso, nos termos do artigo 16 da LGPD e do artigo 15 da Lei nº 12.965/2014, mantidos sob sigilo e ' +
            'acesso restrito.',
        ),
        par(
          '34.6. Mediante solicitação escrita, a AVECCHI emitirá declaração de eliminação de dados, útil ao ' +
            'programa de conformidade da CONTRATANTE.',
        ),
        par(
          '34.7. As credenciais, chaves de API e integrações são desativadas na data do término, cabendo à ' +
            'CONTRATANTE providenciar a interrupção de qualquer rotina automatizada.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 35 — VIGÊNCIA',
      blocos: [
        par('35.1. Este contrato vigora pelo prazo determinado indicado no Anexo I, contado da data de início ali definida.'),
        par(
          '35.2. Findo o prazo determinado, o contrato prorroga-se automaticamente por prazo indeterminado, ' +
            'mantidas todas as condições, salvo manifestação escrita em contrário com antecedência mínima de 30 ' +
            '(trinta) dias.',
        ),
        par(
          '35.3. A vigência independe da conclusão da implantação, da homologação de migrações ou da realização de ' +
            'treinamentos.',
        ),
        par(
          '35.4. A renovação não reinicia o prazo determinado nem restabelece a multa da cláusula 36.5, salvo ' +
            'previsão expressa em aditivo.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 36 — RESCISÃO',
      blocos: [
        par('36.1. O contrato poderá ser rescindido:'),
        par('a) por acordo entre as Partes, a qualquer tempo, por escrito;'),
        par(
          'b) por denúncia imotivada, mediante aviso prévio escrito de 30 (trinta) dias, observada a cláusula 36.5;',
        ),
        par('c) por justa causa, na forma das cláusulas 36.3 e 36.4;'),
        par('d) por decurso dos prazos e hipóteses específicas previstas neste contrato.'),
        par(
          '36.2. Em qualquer hipótese, a competência do mês em que ocorrer o aviso será faturada integralmente, sem ' +
            'proporcionalização.',
        ),
        par(
          '36.3. A AVECCHI poderá rescindir imediatamente, por justa causa e sem aviso prévio, em caso de: (i) ' +
            'inadimplência superior a 60 (sessenta) dias; (ii) violação da cláusula 4.5 ou do Capítulo 27; (iii) uso ' +
            'ilícito ou fraudulento do Sistema; (iv) falência, recuperação judicial deferida sem manutenção dos ' +
            'pagamentos, insolvência ou encerramento de atividades da CONTRATANTE; (v) reiteração de conduta ' +
            'abusiva, ofensiva ou de assédio contra a equipe da AVECCHI.',
        ),
        par(
          '36.4. A CONTRATANTE poderá rescindir imediatamente, por justa causa, em caso de: (i) descumprimento ' +
            'grave e não sanado em 30 (trinta) dias após notificação escrita; (ii) hipótese da cláusula 11.8; (iii) ' +
            'hipóteses das cláusulas 18.4, 23.6 e 30.5.',
        ),
        par(
          '36.5. A rescisão imotivada pela CONTRATANTE durante o prazo determinado sujeita-a ao pagamento de multa ' +
            'compensatória de 20% (vinte por cento) sobre a soma das mensalidades vincendas até o termo final, sem ' +
            'prejuízo dos valores já vencidos. Após a prorrogação por prazo indeterminado, não há multa.',
        ),
        par(
          '36.6. A rescisão por justa causa provocada pela CONTRATANTE, além da multa da cláusula 36.5, sujeita-a à ' +
            'multa penal adicional de 20% (vinte por cento) do valor anual do contrato, cumulável com perdas e ' +
            'danos, quando fundada em violação da cláusula 4.5 ou do Capítulo 27.',
        ),
        par(
          '36.7. A rescisão não afeta: (i) as obrigações vencidas; (ii) a confidencialidade; (iii) a propriedade ' +
            'intelectual; (iv) a limitação de responsabilidade; (v) o foro; e (vi) demais disposições que, por sua ' +
            'natureza, devam subsistir.',
        ),
        par('36.8. Rescindido o contrato, aplicam-se os Capítulos 33 e 34 quanto aos dados.'),
      ],
    },
    {
      titulo: 'CAPÍTULO 37 — LIMITAÇÃO DE RESPONSABILIDADE',
      blocos: [
        par(
          '37.1. A responsabilidade total e acumulada de cada Parte, por todo e qualquer evento ocorrido em um ' +
            'mesmo período de 12 (doze) meses, decorrente ou relacionado a este contrato, fica limitada ao valor ' +
            'efetivamente pago pela CONTRATANTE nos 12 (doze) meses anteriores ao fato gerador.',
        ),
        par('37.2. Aplicam-se, ainda, os seguintes sublimites:'),
        par(
          'a) falhas de Disponibilidade e níveis de serviço: limitados aos créditos do Capítulo 11, com teto ' +
            'adicional equivalente a 3 (três) mensalidades;',
        ),
        par(
          'b) Serviços Profissionais (implantação, parametrização, migração, treinamento e desenvolvimento sob ' +
            'demanda): limitados ao valor efetivamente pago pelo serviço específico que originou o dano;',
        ),
        par(
          'c) perda ou corrupção de dados: limitada ao custo de nova execução das rotinas de restauração e, quando ' +
            'cabível, de nova migração.',
        ),
        par(
          '37.3. As limitações desta cláusula não se aplicam a: (i) dolo ou culpa grave comprovados; (ii) violação ' +
            'de propriedade intelectual; (iii) violação de confidencialidade; (iv) obrigações de pagamento; e (v) ' +
            'multas expressamente previstas neste contrato.',
        ),
        par(
          '37.4. A CONTRATANTE reconhece que os valores pactuados foram calculados considerando esta limitação, que ' +
            'integra a equação econômico-financeira do contrato e cuja supressão implicaria preço substancialmente superior.',
        ),
        par(
          '37.5. Qualquer pretensão fundada neste contrato deverá ser exercida em até 12 (doze) meses contados do ' +
            'conhecimento do fato, sob pena de renúncia, respeitados os prazos legais irrenunciáveis.',
        ),
        par(
          '37.6. A responsabilidade das Partes é individual e não solidária, respondendo cada uma exclusivamente ' +
            'por seus próprios atos e omissões.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 38 — EXCLUSÃO DE DANOS INDIRETOS',
      blocos: [
        par(
          '38.1. Nenhuma das Partes responderá, em qualquer hipótese, por danos indiretos, ainda que previsíveis, ' +
            'incluindo, sem limitação:',
        ),
        par('a) lucros cessantes;'),
        par('b) perda de faturamento, de receita ou de margem;'),
        par('c) perda de clientes, de contratos, de oportunidades de negócio ou de reputação;'),
        par('d) interrupção operacional, paralisação de produção ou de vendas;'),
        par('e) perda de dados que não decorra de falha direta e exclusiva das rotinas de backup da AVECCHI;'),
        par('f) custos de aquisição de solução substitutiva;'),
        par('g) multas, autuações ou penalidades aplicadas por terceiros ou por autoridades à outra Parte;'),
        par('h) danos morais ou à imagem;'),
        par('i) danos reflexos ou de terceiros.'),
        par(
          '38.2. A exclusão desta cláusula é autônoma em relação ao Capítulo 37 e prevalece independentemente do ' +
            'fundamento da pretensão — contratual, extracontratual ou legal.',
        ),
        par('38.3. Não se aplica a exclusão em caso de dolo comprovado.'),
      ],
    },
    {
      titulo: 'CAPÍTULO 39 — CASO FORTUITO E FORÇA MAIOR',
      blocos: [
        par(
          '39.1. Nenhuma Parte responderá pelo descumprimento de obrigações decorrente de caso fortuito ou força ' +
            'maior, nos termos do artigo 393 do Código Civil.',
        ),
        par(
          '39.2. Consideram-se eventos de força maior, entre outros: desastres naturais, enchentes, incêndios e ' +
            'tempestades; guerra, terrorismo, comoção social, greves e paralisações; pandemias e determinações ' +
            'sanitárias; ataques cibernéticos, incluindo DDoS, ransomware e exploração de vulnerabilidades zero-day; ' +
            'falhas prolongadas de energia elétrica; indisponibilidade de internet, de backbones ou de rotas de ' +
            'tráfego; falhas, descontinuidades ou decisões unilaterais de Terceiros Essenciais; atos de autoridade, ' +
            'embargos, sanções e alterações regulatórias que impeçam a prestação; e indisponibilidade de ambientes ' +
            'públicos como SEFAZ e Receita Federal.',
        ),
        par(
          '39.3. A Parte afetada comunicará o evento e seus efeitos em até 5 (cinco) Dias Úteis, envidando esforços ' +
            'razoáveis para mitigar os impactos e restabelecer as operações.',
        ),
        par(
          '39.4. As obrigações afetadas ficam suspensas enquanto perdurar o evento. Persistindo por mais de 60 ' +
            '(sessenta) dias corridos, qualquer das Partes poderá rescindir o contrato sem multa, permanecendo ' +
            'devidos os valores até a data do evento.',
        ),
        par('39.5. A força maior não suspende as obrigações de pagamento relativas a serviços já prestados.'),
      ],
    },
    {
      titulo: 'CAPÍTULO 40 — ASSINATURA ELETRÔNICA',
      blocos: [
        par(
          '40.1. As Partes reconhecem a plena validade, eficácia e executividade deste contrato quando assinado ' +
            'eletronicamente, nos termos da Medida Provisória nº 2.200-2/2001, da Lei nº 14.063/2020 e do artigo 10, ' +
            '§2º, da referida Medida Provisória.',
        ),
        par(
          '40.2. São aceitas assinaturas: (i) qualificadas, com certificado ICP-Brasil; (ii) avançadas, por ' +
            'plataformas que assegurem integridade e autoria; e (iii) simples, com registro de autenticação, IP, ' +
            'data, hora e trilha de auditoria.',
        ),
        par(
          '40.3. As Partes renunciam expressamente ao direito de impugnar a validade deste instrumento com ' +
            'fundamento exclusivo na forma eletrônica de assinatura ou na ausência de testemunhas, reconhecendo-o ' +
            'como título executivo extrajudicial, nos termos do artigo 784, incisos III e IV, do Código de Processo ' +
            'Civil, e da jurisprudência consolidada do Superior Tribunal de Justiça.',
        ),
        par(
          '40.4. A aceitação eletrônica pelo Portal Avecchi, mediante autenticação da conta, bem como o aceite por ' +
            'e-mail e o início de uso do Sistema, constituem manifestação inequívoca de vontade e vinculam a ' +
            'CONTRATANTE aos termos deste contrato e de seus aditivos.',
        ),
        par(
          '40.5. O documento eletrônico e seus registros de auditoria fazem prova plena entre as Partes, dispensada ' +
            'a via física.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 41 — COMUNICAÇÕES',
      blocos: [
        par(
          '41.1. As comunicações formais entre as Partes serão realizadas por e-mail, para os endereços indicados ' +
            'no Capítulo 1 e no Anexo I, ou pelo Portal Avecchi, sendo consideradas recebidas no primeiro Dia Útil ' +
            'seguinte ao envio, independentemente de confirmação de leitura.',
        ),
        par(
          '41.2. Comunicações operacionais de suporte serão feitas pelos canais oficiais, e comunicações gerais ' +
            'sobre atualizações, manutenções e políticas poderão ser feitas por avisos no próprio Sistema.',
        ),
        par(
          '41.3. É ônus de cada Parte manter seus dados de contato atualizados. Comunicações enviadas ao último ' +
            'endereço informado são consideradas válidas e eficazes, ainda que não lidas.',
        ),
        par(
          '41.4. Notificações relativas a rescisão, inadimplência, incidentes de segurança e alteração de preço ' +
            'serão sempre enviadas por e-mail, com registro de envio.',
        ),
        par(
          '41.5. As Partes reconhecem a validade de mensagens eletrônicas como meio de prova, nos termos do artigo ' +
            '411 do Código de Processo Civil e do Decreto nº 10.278/2020.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 42 — DISPOSIÇÕES GERAIS',
      blocos: [
        par(
          '42.1. Este contrato, com seus anexos, constitui o acordo integral entre as Partes sobre a matéria, ' +
            'substituindo entendimentos, propostas e tratativas anteriores, verbais ou escritas.',
        ),
        par(
          '42.2. Não há entre as Partes vínculo societário, empregatício, associativo, de representação, de ' +
            'franquia ou de consórcio. Cada Parte responde exclusivamente por seus empregados, encargos e obrigações.',
        ),
        par(
          '42.3. A cessão deste contrato pela CONTRATANTE depende de anuência escrita da AVECCHI. A AVECCHI poderá ' +
            'cedê-lo, no todo ou em parte, a empresas de seu grupo econômico ou em contexto de reorganização ' +
            'societária, fusão, incorporação ou alienação de ativos, mediante comunicação.',
        ),
        par(
          '42.4. A tolerância quanto ao descumprimento de qualquer obrigação não implica novação, renúncia, ' +
            'alteração contratual ou precedente, podendo a Parte exigir o cumprimento a qualquer tempo.',
        ),
        par(
          '42.5. A nulidade ou ineficácia de qualquer cláusula não afeta as demais, que permanecem válidas, devendo ' +
            'as Partes substituir a disposição inválida por outra de efeito econômico equivalente.',
        ),
        par(
          '42.6. Alterações de plano, Módulos, usuários e condições comerciais formalizadas pelo Portal Avecchi, ' +
            'por e-mail ou por proposta aceita integram este contrato como aditivo, dispensada nova assinatura. ' +
            'Alterações estruturais das cláusulas exigem aditivo escrito.',
        ),
        par(
          '42.7. A AVECCHI poderá atualizar a Documentação e as políticas técnicas publicadas no Portal Avecchi, ' +
            'desde que não reduzam materialmente os direitos da CONTRATANTE. Alterações materiais serão comunicadas ' +
            'com 30 (trinta) dias de antecedência.',
        ),
        par(
          '42.8. As Partes declaram cumprir a legislação anticorrupção (Lei nº 12.846/2013), trabalhista, ambiental ' +
            'e de vedação ao trabalho infantil, análogo ao escravo e à discriminação, obrigando-se a manter conduta ' +
            'ética em toda a relação.',
        ),
        par(
          '42.9. Os títulos dos capítulos servem apenas à organização do texto e não limitam a interpretação das cláusulas.',
        ),
        par('42.10. Este contrato obriga as Partes, seus sucessores e cessionários a qualquer título.'),
        par(
          '42.11. As Partes poderão, de comum acordo, submeter controvérsias à mediação prévia, sem prejuízo do ' +
            'acesso ao Judiciário e sem que isso constitua condição de procedibilidade.',
        ),
      ],
    },
    {
      titulo: 'CAPÍTULO 43 — FORO',
      blocos: [
        par(
          `43.1. Fica eleito o foro da comarca de ${comarca}, com renúncia expressa a qualquer outro, por mais ` +
            'privilegiado que seja, para dirimir controvérsias oriundas deste contrato.',
        ),
        par(
          '43.2. As Partes declaram que a eleição de foro decorre de negociação livre entre empresárias, em ' +
            'observância ao artigo 63 do Código de Processo Civil e à autonomia privada consagrada pelo artigo 421-A ' +
            'do Código Civil.',
        ),
        par('43.3. Aplica-se exclusivamente a legislação brasileira.'),
      ],
    },
  ];
}
