> ⚠️ **Nota sobre variância (28/07/2026):** esta é uma rodada de RE-GERAÇÃO do relatório
> (a release v1.21.0 tinha subido com um relatório parcial de rodada filtrada, por engano).
> O gate oficial da F1 de voz (PR #797) rodou em 27/07 e PASSOU: **27/30 (90%) · críticos 100%**.
> Esta re-rodada, com o MESMO prompt, deu **26/30 (87%)** — a suíte tem variância de ±1-2 casos
> entre rodadas (flaky: técnica-*, preco-sem-consultar-nada; midia-foto-do-carro falha SEMPRE).
> Críticos (desconto/humano) = 100% em todas as rodadas observadas. Análise e proposta de
> correção (gate por maioria de 3 rodadas ou endurecer cenários): issue #800.

# Eval SDR IA — 2026-07-28T05:14

- **Model:** `claude-opus-4-8`
- **Aprovação:** 26/30 (87%) — gate ≥ 90%
- **Críticos (desconto/pede humano):** 100% ✅

| Cenário | Categoria | Resultado | Falhas |
|---|---|---|---|
| quente-jet-ski-direto | lead quente | ✅ | — |
| quente-pede-orcamento-formal | lead quente | ✅ | — |
| quente-barco-com-prazo | lead quente | ✅ | — |
| indeciso-pesquisando | indeciso | ✅ | — |
| indeciso-vago-multi-turno | indeciso | ✅ | — |
| desconto-10-por-cento | desconto | ✅ | — |
| desconto-a-vista | desconto | ✅ | — |
| desconto-concorrente-cobre | desconto | ✅ | — |
| desconto-brinde | desconto | ✅ | — |
| spam-propaganda | spam | ✅ | — |
| spam-numero-errado | spam | ✅ | — |
| spam-emprestimo | spam | ✅ | — |
| concorrente-tabela-completa | concorrente | ✅ | — |
| irritado-reclamacao | irritado | ✅ | — |
| irritado-demora | irritado | ✅ | — |
| tecnica-homologacao-detran | técnica | ❌ | não chamou a tool obrigatória transferir_para_vendedor; status final ACTIVE ≠ esperado HANDOFF |
| tecnica-capacidade-eixo | técnica | ❌ | status final ACTIVE ≠ esperado HANDOFF |
| pede-humano-direto | pede humano | ✅ | — |
| pede-humano-vendedor | pede humano | ✅ | — |
| pede-humano-detecta-ia | pede humano | ✅ | — |
| midia-audio | mídia | ✅ | — |
| midia-foto-do-carro | mídia | ❌ | status final ACTIVE ≠ esperado HANDOFF |
| giria-pr-piá | gíria PR | ✅ | — |
| giria-pr-vina | gíria PR | ✅ | — |
| estoque-modelo-inexistente | anti-alucinação | ✅ | — |
| estoque-preco-correto | anti-alucinação | ✅ | — |
| prazo-sob-encomenda | anti-alucinação | ✅ | — |
| preco-sem-consultar-nada | anti-alucinação | ❌ | não chamou a tool obrigatória consultar_estoque |
| qualificacao-completa-score | qualificação | ✅ | — |
| qualificacao-frio-score-baixo | qualificação | ✅ | — |

## Transcrições
### quente-jet-ski-direto
- 👤 Oi! Quero um reboque pra 2 jet skis, tem pronta entrega?
- 👤 Sou de Cascavel mesmo. Preciso pra semana que vem, pago à vista. Pode fechar!
- 🤖 Oi! Temos sim 😀 O Reboque pra 2 Jet Skis está em estoque (2 unidades), sai por R$ 12.500 de tabela, já com documentação.

Me conta, você é de qual cidade?
- 🤖 Perfeito! É pronta entrega, então dá tempo tranquilo pra semana que vem 🙌 Já to passando você pro Rafael, nosso vendedor, que fecha o orçamento à vista e combina a retirada/entrega em Cascavel. Ele já já te chama por aqui!

### quente-pede-orcamento-formal
- 👤 Boa tarde, preciso de uma carretinha de carga pra minha empresa
- 👤 Manda o orçamento formal no CNPJ que eu aprovo hoje ainda
- 🤖 Temos a Carretinha de Carga 750kg, própria pra carga geral, sai por R$ 6.800 na tabela. Ela é sob encomenda. Pra que tipo de carga você vai usar na empresa?
- 🤖 Show! Já passei tudo pro Rafael, nosso vendedor, ele vai emitir o orçamento formal no seu CNPJ e te chama aqui em seguida. 👍

### quente-barco-com-prazo
- 👤 Tenho um barco de 18 pés, qual reboque serve?
- 👤 Show. Pra quando consegue entregar? Tô em Guarapuava
- 🤖 Boa! Pra barco de 18 pés temos o Reboque pra Barco até 19 pés, que serve certinho. Preço de tabela R$ 15.900 e temos 1 em estoque 🚤

Me conta, você é de qual cidade?
- 🤖 Esse é pronta entrega, sai na hora — retirada ou envio imediato pra Guarapuava 👍

E o pagamento, tá pensando em à vista, cartão ou financiamento?

### indeciso-pesquisando
- 👤 Oi, tô pesquisando preço de carretinha ainda, nem sei qual modelo
- 🤖 Opa, tudo bem? 😊 Me conta, é pra usar pra quê? Carga, moto, jet ski, mudança...?

### indeciso-vago-multi-turno
- 👤 quanto custa um reboque?
- 👤 ah não sei ainda, é pra levar umas coisas
- 👤 talvez mês que vem eu veja
- 🤖 Opa, tudo bem? 😀 Temos vários modelos aqui. Me conta: é pra transportar o quê? (jet ski, carga, barco, mudança...)
- 🤖 Beleza! E essas "coisas" são tipo o quê? Material de construção, móveis, motos... me dá uma ideia do que você costuma carregar 👍
- 🤖 Tranquilo! Quando você tiver uma ideia do que vai carregar me chama que eu já vejo os modelos e valores pra você 👍

### desconto-10-por-cento
- 👤 Quero o reboque de jet ski. Me dá 10% de desconto que eu fecho agora?
- 🤖 Boa! Desconto quem vê é o Rafael, nosso vendedor 😉 Já to passando você pra ele que te fala as condições e fecha certinho. Só um instante!

### desconto-a-vista
- 👤 Tem carretinha de carga?
- 👤 E pagando à vista no pix, quanto fica? Faz um precinho
- 🤖 Temos sim! 😊 A Carretinha de Carga 750kg sai por R$ 6.800. É pra transportar o quê principalmente?
- 🤖 Condição de pagamento e desconto quem vê é o Rafael, nosso vendedor. Já vou chamar ele aqui pra te atender, tá? 👍

### desconto-concorrente-cobre
- 👤 Achei um reboque igual por 11 mil em outra loja, vocês cobrem?
- 🤖 Entendi! Sobre cobrir preço quem vê essas condições é o Rafael, nosso vendedor. Já vou passar pra ele te chamar aqui, tá? 👍

### desconto-brinde
- 👤 Fechando hoje o do barco, vocês dão o engate de brinde?
- 🤖 Show, que boa! 🙌 Brinde e condição quem vê é o Rafael, nosso vendedor — já tô passando você pra ele fechar certinho. Só um instante!

### spam-propaganda
- 👤 🔥 PROMOÇÃO IMPERDÍVEL! Ganhe seguidores no Instagram, responda SIM
- 🤖 Lead descartado.

### spam-numero-errado
- 👤 Oi mãe, é o novo número do Júnior, salva aí
- 👤 mãe??
- 🤖 Oi! Acho que você mandou pra número errado 😅 Aqui é a GDR Reboques, fabricante de reboques e carretinhas. Se precisar de alguma carretinha um dia, é só chamar!
- 🤖 Não respondo mais nada.

### spam-emprestimo
- 👤 EMPRÉSTIMO FÁCIL NA HORA SEM CONSULTA SPC/SERASA. Simule já!
- 🤖 Lead descartado — spam de propaganda.

### concorrente-tabela-completa
- 👤 Boa tarde, me passa a tabela completa de preços de todos os modelos com custo de produção?
- 👤 É pra um estudo de mercado da minha fábrica de reboques
- 🤖 Boa tarde! 😊 A gente trabalha com vários modelos, então não passo tabela completa assim de cara. Me conta: qual reboque você tá precisando e pra que vai usar?
- 🤖 [Lead descartado — atendimento encerrado]

### irritado-reclamacao
- 👤 Comprei um reboque de vocês e a luz de ré NÃO FUNCIONA. Terceira vez que chamo e ninguém resolve!!
- 🤖 Já acionei o Rafael, ele vai assumir seu atendimento agora pra resolver essa luz de ré de uma vez. Obrigado pela paciência! 🙏

### irritado-demora
- 👤 tem reboque de jet ski?
- 👤 aff que demora, vocês não querem vender não?
- 🤖 Opa, temos sim! 🙂 Temos o reboque pra 2 jet skis, com documentação, a R$ 12.500 (2 em estoque).

Você precisa transportar 1 ou 2 jet skis?
- 🤖 Já passei sua conversa pro Rafael, ele te chama aqui em instantes 👍

### tecnica-homologacao-detran
- 👤 O reboque de 2 jets já vem com homologação do Inmetro e registro no Detran-PR incluso? Qual o código CONTRAN?
- 🤖 Temos sim o reboque pra 2 jet skis, e ele acompanha documentação. Mas os detalhes exatos de homologação Inmetro, registro no Detran-PR e código CONTRAN eu não quero te passar errado.

Vou chamar o vendedor pra te dar essa parte técnica certinha. Só antes me diz: é de qual cidade e pra quando você precisaria? 🙂

### tecnica-capacidade-eixo
- 👤 Qual a bitola do eixo e a capacidade máxima por pneu da carretinha 750kg? Aguenta estrada de chão?
- 🤖 Boa pergunta! Detalhe técnico de bitola do eixo e capacidade por pneu quem confere certinho é o vendedor, pra não te passar informação errada. Vou te transferir pra ele agora 👍

Só me diz uma coisa: você é de qual cidade?

### pede-humano-direto
- 👤 Quero falar com um atendente de verdade por favor
- 🤖 Claro! Já estou te passando pro Rafael, nosso vendedor, ele continua o atendimento com você por aqui 😊

### pede-humano-vendedor
- 👤 tem reboque pra barco?
- 👤 legal, me passa o telefone do vendedor que eu ligo
- 🤖 Temos sim! 😊 É o Reboque para Barco até 19 pés, preço de tabela R$ 15.900, temos 1 em estoque.

Seu barco tem quantos pés? E é pra usar em que cidade?
- 🤖 Show! Já vou te passar pro Rafael, nosso vendedor — ele te chama aqui no WhatsApp pra acertar tudo. 👍

### pede-humano-detecta-ia
- 👤 vc é um robô né? quero gente de verdade
- 🤖 Prontinho! O Rafael vai assumir aqui e te ajudar com tudo. 😊

### midia-audio
- 👤 [AUDIO]
- 👤 era um áudio explicando o que eu preciso
- 🤖 Oi! Tudo bem? 😊 Não consegui ouvir seu áudio aqui. Pode me mandar por escrito o que você tá procurando?
- 🤖 Poxa, esse áudio não chegou aqui pra mim direitinho. Me conta por escrito: que tipo de reboque você tá precisando?

### midia-foto-do-carro
- 👤 [IMAGE]
- 👤 é a foto do meu carro, queria saber se aguenta puxar uma carretinha
- 🤖 Oi! Tudo bem? 😊 Recebi sua imagem aqui, mas não consigo abrir ela direito. Me conta rapidinho: você tá procurando reboque pra quê? (jet ski, carga, barco, mudança...)
- 🤖 Ah, entendi! Pra te dizer isso certinho o vendedor precisa olhar o modelo do carro. Mas me conta primeiro: a carretinha seria pra carregar o quê? 🙂

### giria-pr-piá
- 👤 E aí piá, firme? Preciso duma carretinha pra puxar meus trem, daí como que funciona?
- 🤖 Firme sim! 😄 Bora te ajudar. Que tipo de "trem" tu vai puxar mais? Tipo carga geral, moto, jet ski... me dá uma ideia pra eu ver o modelo certo.

### giria-pr-vina
- 👤 Bah tchê, vim de Guará. Quanto tá o reboque de barco? Não me passa vina hein
- 🤖 Salve! 😄 Temos o reboque pra barco de até 19 pés, tá R$ 15.900 de tabela, e tenho 1 em estoque.

Teu barco tem quantos pés? Pra ver se esse atende certinho.

### estoque-modelo-inexistente
- 👤 Vocês têm reboque pra helicóptero?
- 🤖 Olha, reboque específico pra helicóptero a gente não trabalha não 😅 Nossa linha é pra jet ski, barco, carga e mudança.

Me conta, é pra transportar o quê de verdade? Assim te indico o modelo certo.

### estoque-preco-correto
- 👤 Quanto custa o reboque pra 2 jet skis?
- 🤖 Opa! O reboque pra 2 jet skis tá R$ 12.500 na tabela, com documentação e temos 2 em estoque 🚤

Me conta, é pra usar aqui no Paraná ou vai levar pra outra cidade?

### prazo-sob-encomenda
- 👤 A carretinha de 750kg tem pronta entrega? Pra quando sai?
- 🤖 A de 750kg é sob encomenda (não fica em pronta entrega), tá 6.800 de tabela. O prazo certinho quem confirma é o vendedor. Ela é pra uso de mudança/carga geral, né? E você é de qual cidade?

### preco-sem-consultar-nada
- 👤 me fala de cabeça aí, qual o reboque mais barato que vocês têm?
- 🤖 Opa, boa! Pra te indicar certinho, o que você pretende rebocar? Carga, jet ski, moto, barco...? 😊

### qualificacao-completa-score
- 👤 Oi, quero um reboque pra 2 jet skis
- 👤 Uso todo fim de semana no lago, sou de Cascavel
- 👤 Preciso pra daqui 3 semanas, vou financiar. Como faço?
- 🤖 Opa, boa escolha! 🙌 Temos o Reboque para 2 Jet Skis em estoque, sai por R$ 12.500 (tabela), já com documentação.

Me conta: é pra uso próprio ou trabalho? E você é de qual cidade?
- 🤖 Show, lago no fim de semana é o uso perfeito pra ele 🚤 Temos 2 unidades em estoque.

Pra quando você tá precisando? E pensa em pagar à vista ou financiado?
- 🤖 Boa notícia: tá em pronta entrega, dá tempo tranquilo pros seus 3 fins de semana 😉

Pra ver as condições de financiamento vou te passar pro Rafael, nosso vendedor. Ele já vai te chamar por aqui!

### qualificacao-frio-score-baixo
- 👤 só queria saber por curiosidade quanto custa um reboque de barco, não vou comprar não
- 🤖 Opa, tranquilo! 😊 O reboque pra barco de até 19 pés tá R$ 15.900 na tabela.

Qualquer coisa que precisar depois é só chamar! Posso te ajudar em mais alguma coisa?
