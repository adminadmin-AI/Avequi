/**
 * AVQ-CT v2 — Anexos I a IV. Transcrição fiel, com DUAS correções factuais
 * autorizadas pelo Claudio no chat (05/08):
 *  - Anexo I: limite de API reflete o que o sistema PRATICA (60 req/min por
 *    usuário via ThrottlerModule), não os "120/min por conta" do rascunho;
 *  - Anexo IV: infraestrutura REAL (Railway/Focus/Anthropic/OpenAI/Pluggy no
 *    lugar de Cloudflare/OpenPix do rascunho do parceiro).
 * Itens comerciais não contratados (implantação, migração, treinamento) saem
 * como "Não contratado" — nunca valor inventado.
 */
import { Capitulo, ContratoV2Params, par, PENDENTE, tabela } from './contract-v2-tipos';

export function anexos(p: ContratoV2Params): Capitulo[] {
  const emailCli = p.cliente.email ?? PENDENTE;
  return [
    {
      titulo: 'ANEXO I — PLANO, ESCOPO E CONDIÇÕES COMERCIAIS',
      blocos: [
        par('A.1. Identificação'),
        tabela(
          ['Campo', 'Conteúdo'],
          [
            ['CONTRATANTE', p.cliente.razaoSocial],
            ['CNPJ', p.cliente.cnpj],
            ['Endereço', p.cliente.endereco ?? PENDENTE],
            ['E-mail contratual', emailCli],
            ['E-mail de cobrança', emailCli],
            ['Encarregado/contato LGPD', 'Indicado pela CONTRATANTE no Portal Avecchi'],
          ],
        ),
        par('A.2. Escopo contratado'),
        tabela(
          ['Item', 'Condição'],
          [
            ['Produto', 'Avecchi ERP — modelo SaaS, instância única versionada'],
            [
              'Módulos habilitados',
              p.comercial.planoNome
                ? `Conforme o plano "${p.comercial.planoNome}" e a habilitação no Portal Avecchi na data de início`
                : 'Conforme habilitação no Portal Avecchi na data de início',
            ],
            ['Usuários Licenciados', 'Conforme contratação vigente no Portal Avecchi'],
            ['Ambiente', 'Produção em nuvem'],
            ['Armazenamento incluído', 'Conforme plano contratado e Documentação'],
            ['Limite de requisições de API', '60 requisições/minuto por usuário, conforme Documentação'],
            ['Excedentes', 'Cobrados conforme tabela vigente no Portal Avecchi'],
          ],
        ),
        par('A.3. Condições financeiras'),
        tabela(
          ['Item', 'Valor / Condição'],
          [
            [
              'Mensalidade',
              p.comercial.mensalidadePorExtenso
                ? `${p.comercial.mensalidadeFormatada} (${p.comercial.mensalidadePorExtenso})`
                : p.comercial.mensalidadeFormatada,
            ],
            ['Vencimento', `Todo dia ${p.comercial.diaCobranca} de cada mês`],
            ['Implantação', 'Não contratada neste instrumento'],
            ['Migração de dados', 'Não contratada neste instrumento'],
            ['Treinamento incluído', 'Não contratado neste instrumento'],
            ['Hora técnica adicional', 'Conforme tabela vigente no Portal Avecchi'],
            ['Meio de pagamento', 'Boleto / PIX / cobrança recorrente, conforme escolha no Portal'],
            ['Primeiro ciclo', 'Pro rata, se aplicável'],
            ['Reajuste', 'Anual, pelo maior entre IPCA e IGP-M (Capítulo 30)'],
          ],
        ),
        par('A.4. Vigência'),
        tabela(
          ['Item', 'Condição'],
          [
            ['Data de início', p.comercial.inicioVigencia],
            ['Prazo determinado', '12 (doze) meses'],
            ['Prorrogação', 'Automática, por prazo indeterminado (cláusula 35.2)'],
            ['Aviso prévio para denúncia', '30 (trinta) dias'],
            ['Multa por rescisão antecipada no prazo determinado', '20% das mensalidades vincendas (cláusula 36.5)'],
          ],
        ),
        par('A.5. Serviços não contratados'),
        par(
          'Salvo indicação expressa acima, não estão incluídos: desenvolvimento sob demanda, integrações ' +
            'personalizadas, consultoria fiscal ou contábil, atendimento presencial, ambiente de homologação ' +
            'dedicado, retenção estendida de backup e SLA diferenciado.',
        ),
      ],
    },
    {
      titulo: 'ANEXO II — ACORDO DE NÍVEL DE SERVIÇO (SLA) E SUPORTE',
      blocos: [
        par('B.1. Disponibilidade'),
        par('B.1.1. Compromisso de Disponibilidade mensal do Ambiente de Produção: 99,5%.'),
        par(
          'B.1.2. Fórmula de apuração: Disponibilidade (%) = [(T − E − I) ÷ (T − E)] × 100, onde T = total de ' +
            'minutos do mês-calendário; E = minutos excluídos (Janelas de Manutenção, manutenções emergenciais e ' +
            'hipóteses da cláusula 11.5); I = minutos de Indisponibilidade computável.',
        ),
        par(
          'B.1.3. A Indisponibilidade é contada a partir do registro do chamado P1 pela CONTRATANTE ou da detecção ' +
            'pelo monitoramento da AVECCHI — o que ocorrer primeiro — até o restabelecimento do acesso.',
        ),
        par(
          'B.1.4. Interrupções inferiores a 5 (cinco) minutos consecutivos, e degradações que não impeçam o uso, ' +
            'não são computadas.',
        ),
        par(
          'B.1.5. A fonte oficial de apuração é o monitoramento da AVECCHI, cujos registros prevalecem sobre ' +
            'medições unilaterais da CONTRATANTE.',
        ),
        par('B.2. Créditos de serviço'),
        tabela(
          ['Disponibilidade apurada no mês', 'Crédito sobre a mensalidade'],
          [
            ['≥ 99,50%', 'Sem crédito'],
            ['99,00% a 99,49%', '5%'],
            ['98,00% a 98,99%', '10%'],
            ['95,00% a 97,99%', '15%'],
            ['< 95,00%', '25% (teto)'],
          ],
        ),
        par(
          'B.2.1. Solicitação em até 15 dias do encerramento do mês, sob pena de decadência (cláusula 11.6). ' +
            'Crédito aplicado na fatura do mês subsequente, não conversível em dinheiro.',
        ),
        par('B.2.2. Os créditos são o remédio único e exclusivo por falha de Disponibilidade (cláusula 11.4).'),
        par('B.3. Classificação de criticidade e prazos'),
        tabela(
          ['Nível', 'Definição', 'Tempo de resposta', 'Tempo de contorno', 'Tempo de solução'],
          [
            [
              'P1 — Crítico',
              'Sistema totalmente indisponível ou função essencial inoperante para todos os usuários, sem alternativa, com paralisação da operação',
              '1 hora',
              '8 horas úteis',
              '5 Dias Úteis',
            ],
            [
              'P2 — Alta',
              'Função relevante inoperante ou com erro grave, afetando parte da operação, com contorno difícil',
              '4 horas úteis',
              '2 Dias Úteis',
              '10 Dias Úteis',
            ],
            [
              'P3 — Média',
              'Erro que causa transtorno, com alternativa disponível; comportamento divergente da Documentação',
              '8 horas úteis',
              '—',
              '20 Dias Úteis',
            ],
            [
              'P4 — Baixa',
              'Dúvidas de uso, ajustes cosméticos, sugestões e solicitações de melhoria',
              '2 Dias Úteis',
              '—',
              'Conforme roteiro de produto',
            ],
          ],
        ),
        par(
          'B.3.1. "Tempo de resposta" é o prazo para o primeiro retorno humano qualificado. "Tempo de contorno" é o ' +
            'prazo para disponibilizar solução paliativa. "Tempo de solução" é o prazo-alvo para correção definitiva.',
        ),
        par(
          'B.3.2. Os prazos de P1 correm em regime 24x7. Os demais correm em horário comercial (segunda a sexta, ' +
            '08h00–18h00, horário de Brasília, exceto feriados).',
        ),
        par(
          'B.3.3. Os prazos ficam suspensos enquanto pendente informação, acesso, evidência ou validação a cargo da CONTRATANTE.',
        ),
        par('B.3.4. Reclassificações são registradas no chamado com justificativa técnica.'),
        par(
          'B.3.5. Os prazos de solução são metas de melhor esforço qualificado e não geram créditos próprios; ' +
            'somente a Disponibilidade gera créditos.',
        ),
        par('B.4. Canais oficiais de atendimento'),
        tabela(
          ['Canal', 'Uso', 'Disponibilidade'],
          [
            ['Central de chamados no Sistema', 'Todos os níveis — canal preferencial e rastreável', '24x7 para abertura'],
            ['E-mail de suporte divulgado no Portal', 'Todos os níveis', '24x7 para abertura'],
            ['Telefone / plantão', 'Exclusivamente P1', '24x7'],
          ],
        ),
        par('Atendimentos por canais não oficiais não geram obrigação nem contam para o SLA (cláusula 12.6).'),
        par('B.5. Janelas de manutenção'),
        tabela(
          ['Tipo', 'Regra'],
          [
            [
              'Programada',
              'Domingos, das 00h00 às 06h00 (horário de Brasília), limitada a 8 horas por mês, com aviso mínimo de 48 horas',
            ],
            [
              'Emergencial',
              'A qualquer tempo, quando necessária à segurança, à integridade dos dados ou à continuidade, com comunicação simultânea ou imediatamente posterior',
            ],
            ['Atualizações contínuas', 'Publicadas sem interrupção perceptível, não configurando janela'],
          ],
        ),
        par('Nenhuma dessas hipóteses é computada como Indisponibilidade.'),
        par('B.6. Relatórios'),
        par(
          'Mediante solicitação, a AVECCHI fornecerá relatório mensal de Disponibilidade e resumo de chamados por criticidade.',
        ),
      ],
    },
    {
      titulo: 'ANEXO III — TRATAMENTO DE DADOS PESSOAIS (LGPD) E MEDIDAS DE SEGURANÇA',
      blocos: [
        par(
          'Este Anexo integra o contrato e vale como acordo de tratamento de dados pessoais entre Controladora e ' +
            'Operadora, nos termos da Lei nº 13.709/2018.',
        ),
        par('C.1. Quadro do tratamento'),
        tabela(
          ['Elemento', 'Descrição'],
          [
            ['Controladora', 'CONTRATANTE, quanto aos dados que insere e gerencia no Sistema'],
            ['Operadora', 'AVECCHI, quanto ao tratamento realizado por conta da Controladora'],
            [
              'Natureza do tratamento',
              'Coleta por inserção, armazenamento, organização, estruturação, consulta, uso, transmissão a terceiros integrados por ordem da Controladora, arquivamento e eliminação',
            ],
            ['Finalidade', 'Execução das funcionalidades do Avecchi ERP contratadas'],
            ['Duração', 'Vigência do contrato + prazos do Capítulo 34'],
            [
              'Categorias de titulares',
              'Colaboradores, clientes, fornecedores, prestadores, representantes e contatos comerciais da Controladora',
            ],
            [
              'Categorias de dados',
              'Identificação, contato, dados cadastrais e fiscais, dados profissionais, dados financeiros e transacionais, registros de acesso e uso',
            ],
            [
              'Dados sensíveis',
              'Não previstos por padrão; se inseridos, sob exclusiva decisão e responsabilidade da Controladora (cláusula 17.5)',
            ],
            ['Instruções', 'As decorrentes do contrato, da Documentação e do uso regular do Sistema'],
          ],
        ),
        par('C.2. Medidas técnicas'),
        tabela(
          ['Medida', 'Descrição'],
          [
            ['Criptografia em trânsito', 'TLS 1.2 ou superior em todas as conexões'],
            ['Criptografia em repouso', 'Dados e backups armazenados de forma criptografada'],
            ['Segregação', 'Isolamento lógico por conta, com controles de acesso em nível de linha'],
            [
              'Autenticação',
              'Credenciais individuais, política de senha forte, MFA disponível a todos e obrigatório para administradores internos',
            ],
            ['Controle de acesso', 'Perfis e permissões granulares, princípio do menor privilégio, revisão periódica'],
            [
              'Logs',
              'Registro de autenticações, operações relevantes, alterações de configuração e chamadas de API, com usuário, data, hora e IP',
            ],
            [
              'Rastreabilidade',
              'Trilhas de auditoria dos lançamentos, retidas por, no mínimo, 6 (seis) meses, e registros de acesso à aplicação por, no mínimo, 6 (seis) meses, nos termos do artigo 15 da Lei nº 12.965/2014',
            ],
            ['Proteção de borda', 'Mitigação de ataques volumétricos e de aplicação na camada dos provedores de infraestrutura'],
            ['Monitoramento', 'Observabilidade de disponibilidade, desempenho e eventos de segurança, com alertas'],
            ['Gestão de vulnerabilidades', 'Atualização contínua de dependências e correção priorizada por criticidade'],
            [
              'Ambientes',
              'Separação entre desenvolvimento, homologação e produção; vedado o uso de dados reais fora de produção sem anonimização',
            ],
          ],
        ),
        par('C.3. Medidas organizacionais'),
        par(
          'Políticas internas de segurança e privacidade; termos de confidencialidade firmados por colaboradores e ' +
            'prestadores; controle de acesso por necessidade; capacitação periódica em proteção de dados; processo ' +
            'formal de resposta a incidentes; avaliação de segurança de Suboperadores antes da contratação.',
        ),
        par('C.4. Backup e recuperação'),
        tabela(
          ['Item', 'Parâmetro'],
          [
            ['Frequência', 'Diária, automática'],
            ['Armazenamento', 'Criptografado, com redundância geográfica'],
            ['Retenção padrão', '30 dias corridos'],
            ['Recuperação a ponto no tempo', 'Conforme disponibilidade técnica do provedor de banco de dados'],
            ['Teste de restauração', 'Ao menos anual, com registro'],
            ['RTO / RPO em desastre', '24 horas / 24 horas (cláusula 16.1)'],
          ],
        ),
        par('C.5. Incidentes de segurança'),
        tabela(
          ['Etapa', 'Prazo'],
          [
            ['Contenção e mitigação', 'Imediata, a partir do conhecimento'],
            ['Comunicação à Controladora', 'Até 48 horas do conhecimento, havendo risco relevante'],
            [
              'Informações fornecidas',
              'Natureza dos dados afetados, titulares envolvidos (quando identificável), medidas adotadas, riscos e recomendações',
            ],
            ['Relatório de causa-raiz', 'Até 15 dias corridos da contenção'],
            [
              'Comunicação à ANPD e aos titulares',
              'Dever da Controladora, observada a Resolução CD/ANPD nº 15/2024 (3 dias úteis do conhecimento)',
            ],
          ],
        ),
        par('C.6. Direitos dos titulares'),
        par(
          'O Sistema disponibiliza recursos de consulta, correção, exportação e eliminação que permitem à ' +
            'Controladora atender às requisições dos artigos 18 e 19 da LGPD. Requisições recebidas diretamente pela ' +
            'AVECCHI são encaminhadas em até 5 Dias Úteis (cláusula 17.7).',
        ),
        par('C.7. Retenção, anonimização e eliminação'),
        par(
          'Dados retidos durante a vigência e pelos prazos do Capítulo 34; eliminação definitiva a partir do 61º ' +
            'dia após o término, com expurgo de backups em até 90 dias; retenção residual apenas nas hipóteses do ' +
            'artigo 16 da LGPD; dados anonimizados e agregados podem ser utilizados na forma da cláusula 17.10.',
        ),
        par('C.8. Contato'),
        par(
          `Canal de privacidade da AVECCHI: ${p.operadora.email ?? PENDENTE}. Encarregado indicado no Portal Avecchi.`,
        ),
      ],
    },
    {
      titulo: 'ANEXO IV — SUBOPERADORES E PROVEDORES DE INFRAESTRUTURA',
      blocos: [
        par(
          'Relação vigente na data de assinatura, atualizável na forma do Capítulo 18 e publicada no Portal Avecchi.',
        ),
        tabela(
          ['Provedor', 'Função', 'Dados envolvidos'],
          [
            ['Railway', 'Hospedagem e execução da aplicação (API)', 'Dados do Cliente em processamento, logs técnicos'],
            ['Vercel', 'Hospedagem e entrega da aplicação web', 'Dados de requisição, logs técnicos'],
            [
              'Supabase',
              'Banco de dados gerenciado e armazenamento de arquivos',
              'Dados do Cliente e dados pessoais neles contidos',
            ],
            ['Focus NFe', 'Transmissão e retorno de documentos fiscais eletrônicos', 'Dados fiscais e cadastrais'],
            [
              'Anthropic',
              'Processamento de inteligência artificial (assistentes, triagem e recursos de IA do Sistema)',
              'Conteúdo submetido aos recursos de IA habilitados',
            ],
            ['OpenAI', 'Transcrição de áudio dos recursos de IA, quando habilitados', 'Áudios e transcrições'],
            ['Provedor de e-mail transacional', 'Envio de notificações, faturas e comunicações', 'Nome e e-mail de destinatários'],
            [
              'WhatsApp Business API (Meta) e provedor de mensageria',
              'Envio de mensagens quando o Módulo for habilitado',
              'Nome, telefone e conteúdo das mensagens',
            ],
            [
              'Pluggy e demais provedores de pagamento e Open Finance',
              'Geração e conciliação de cobranças',
              'Dados de cobrança e identificação do pagador',
            ],
            ['Ferramentas de observabilidade e suporte', 'Monitoramento, registro de erros e atendimento', 'Logs técnicos e dados de conta'],
          ],
        ),
        par('Observações:'),
        par(
          '1. Órgãos públicos (SEFAZ, Receita Federal, prefeituras) e instituições financeiras não são ' +
            'Suboperadores da AVECCHI: atuam como destinatários legais ou controladores próprios, por determinação ' +
            'da CONTRATANTE ou da lei.',
        ),
        par(
          '2. Alguns provedores podem processar dados fora do território nacional, aplicando-se a cláusula 17.11.',
        ),
        par(
          '3. A AVECCHI seleciona provedores que ofereçam garantias adequadas de segurança e conformidade e exige ' +
            'deles obrigações equivalentes às deste contrato.',
        ),
      ],
    },
  ];
}
