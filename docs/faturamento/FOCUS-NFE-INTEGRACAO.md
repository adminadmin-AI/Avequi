# Focus NFe — Guia de Integração para Veículos (NCM 8716)

## 1. Autenticação

**Método:** HTTP Basic Auth (RFC 7617)

```
Username: TOKEN_DA_EMPRESA
Password: (vazio)

Header: Authorization: Basic BASE64(TOKEN:)
```

```bash
# Teste rápido
curl -u "SEU_TOKEN:" https://homologacao.focusnfe.com.br/v2/nfe?ref=teste001
```

## 2. Ambientes

| Ambiente | Base URL | Uso |
|----------|----------|-----|
| Homologação | `https://homologacao.focusnfe.com.br` | Testes (NF-e sem validade fiscal) |
| Produção | `https://api.focusnfe.com.br` | NF-e reais |

**Variáveis de ambiente no Avequi:**
```env
FOCUS_NFE_TOKEN=token_aqui
FOCUS_NFE_URL=https://homologacao.focusnfe.com.br   # trocar para api.focusnfe.com.br em produção
```

## 3. Endpoints Principais

| Operação | Método | Endpoint |
|----------|--------|----------|
| Emitir NF-e | `POST` | `/v2/nfe?ref={ref}` |
| Consultar status | `GET` | `/v2/nfe/{ref}` |
| Cancelar NF-e | `DELETE` | `/v2/nfe/{ref}` |
| Carta de Correção | `POST` | `/v2/nfe/{ref}/carta_correcao` |
| Inutilizar numeração | `POST` | `/v2/nfe/inutilizacao` |

- O `ref` é um identificador alfanumérico único (sem caracteres especiais)
- O `ref` **não pode ser reutilizado** após autorização (mesmo com cancelamento)

## 4. Certificado Digital A1

**Somente A1** é aceito (A3 não funciona em cloud).

### Upload via Painel
1. Acesse `https://app-v2.focusnfe.com.br/`
2. Menu lateral > Cadastros > Empresas
3. Localize a empresa > Editar
4. "Anexar Certificado" > selecionar `.pfx` > informar senha > salvar

### Checklist
- [ ] Certificado eCNPJ modelo A1 (.pfx)
- [ ] Senha do certificado
- [ ] Verificar data de validade (expiração bloqueia emissão)

## 5. Webhook — Notificações Assíncronas

A emissão de NF-e é **assíncrona**. O Focus processa e notifica via webhook.

### Configuração
- Painel Focus NFe > Webhooks > Criar gatilho
- URL de destino: endpoint do Avequi (ex: `https://api.avequi.com/fiscal/webhook`)
- Eventos: autorização, rejeição, cancelamento, CC-e

### Política de Retry (falha no endpoint)
```
1ª tentativa: imediata
2ª: +1 minuto
3ª: +30 minutos
4ª: +1 hora
5ª: +3 horas
6ª: +24 horas (última)
```

## 6. Payload NF-e — Grupo Veículo (`veiculos_novos`)

O grupo veículo é um objeto **dentro do item** (`items[].veiculos_novos`).
Obrigatório quando NCM pertence ao capítulo 87 (veículos).

### Payload Completo — Exemplo Reboque GDR

```json
{
  "natureza_operacao": "VENDA DE PRODUÇÃO PRÓPRIA",
  "forma_pagamento": "0",
  "ref": "venda-gdr-001",
  "data_emissao": "2026-06-30T10:00:00-03:00",
  "local_destino": "2",
  "presenca_comprador": "1",

  "cnpj_emitente": "12345678000199",
  "nome_emitente": "GDR REBOQUES LTDA",
  "inscricao_estadual_emitente": "9012345678",
  "logradouro_emitente": "RUA DA INDUSTRIA",
  "numero_emitente": "500",
  "bairro_emitente": "DISTRITO INDUSTRIAL",
  "municipio_emitente": "GUARAPUAVA",
  "uf_emitente": "PR",
  "cep_emitente": "85000000",
  "codigo_municipio_emitente": "4109401",

  "cnpj_destinatario": "98765432000188",
  "nome_destinatario": "REVENDA REBOQUES SUL LTDA",
  "inscricao_estadual_destinatario": "1234567890",
  "logradouro_destinatario": "AV BRASIL",
  "numero_destinatario": "1200",
  "bairro_destinatario": "CENTRO",
  "municipio_destinatario": "CURITIBA",
  "uf_destinatario": "PR",
  "cep_destinatario": "80000000",
  "codigo_municipio_destinatario": "4106902",

  "items": [
    {
      "numero_item": "1",
      "codigo_produto": "REB-GRAN-3E-45T",
      "descricao": "REBOQUE CARGA SECA GRANELEIRO 3 EIXOS PBT 45.000 KG COR CINZA",
      "cfop": "5101",
      "unidade_comercial": "UN",
      "quantidade_comercial": "1.00",
      "valor_unitario_comercial": "120000.00",
      "valor_bruto": "120000.00",
      "ncm": "87163900",

      "inclui_no_total": "1",
      "origem_mercadoria": "0",

      "icms_situacao_tributaria": "00",
      "icms_modalidade_base_calculo": "3",
      "icms_base_calculo": "120000.00",
      "icms_aliquota": "12.00",
      "icms_valor": "14400.00",

      "ipi_situacao_tributaria": "51",
      "ipi_codigo_enquadramento": "999",
      "ipi_base_calculo": "120000.00",
      "ipi_aliquota": "0.00",
      "ipi_valor": "0.00",

      "pis_situacao_tributaria": "01",
      "pis_base_calculo": "120000.00",
      "pis_aliquota": "0.65",
      "pis_valor": "780.00",

      "cofins_situacao_tributaria": "01",
      "cofins_base_calculo": "120000.00",
      "cofins_aliquota": "3.00",
      "cofins_valor": "3600.00",

      "veiculos_novos": {
        "tipo_operacao": "1",
        "chassi": "9BR00000000000001",
        "codigo_cor": "05",
        "descricao_cor": "CINZA",
        "potencia_motor": "0",
        "cm3": "0",
        "peso_liquido": "2.500",
        "peso_bruto": "45.000",
        "serie": "000001",
        "tipo_combustivel": "99",
        "numero_motor": "000000000000000000000",
        "cmt": "45.000",
        "distancia_eixos": "0",
        "ano_modelo": 2026,
        "ano_fabricacao": 2026,
        "tipo_pintura": "S",
        "tipo": "10",
        "especie": "2",
        "vin": "N",
        "condicao": "1",
        "codigo_marca_modelo": "999999",
        "codigo_cor_denatran": "05",
        "lotacao": "0",
        "restricao": "0"
      }
    }
  ]
}
```

## 7. Campos do Grupo `veiculos_novos` — Referência

| Campo Focus NFe | XML SEFAZ | Obrigatório | Valor p/ Reboque | Descrição |
|-----------------|-----------|-------------|------------------|-----------|
| `tipo_operacao` | `tpOp` | Sim | `1` | 0=Outros, 1=Venda concess., 2=Faturamento direto, 3=Venda direta |
| `chassi` | `chassi` | Sim | VIN 17 chars | Idêntico ao cadastro BIN |
| `codigo_cor` | `cCor` | Sim | Ex: `05` | Código cor conforme montadora |
| `descricao_cor` | `xCor` | Sim | Ex: `CINZA` | Descrição da cor (até 40 chars) |
| `potencia_motor` | `pot` | Sim | `0` | CV — reboque não tem motor |
| `cm3` | `cilin` | Sim | `0` | Cilindrada — reboque não tem motor |
| `peso_liquido` | `pesoL` | Sim | Em toneladas | Peso líquido (decimal) |
| `peso_bruto` | `pesoB` | Sim | Em toneladas | PBT conforme CCT |
| `serie` | `nSerie` | Sim | Nº série | Número de série do veículo |
| `tipo_combustivel` | `tpComb` | Sim | `99` | Sem motor (ver nota abaixo) |
| `numero_motor` | `nMotor` | Sim | `000...` (21 zeros) | Reboque não tem motor |
| `cmt` | `CMT` | Não | Em toneladas | Capacidade máx. tração |
| `distancia_eixos` | `dist` | Não | Em mm | Distância entre eixos |
| `ano_modelo` | `anoMod` | Sim | AAAA | Ano do modelo |
| `ano_fabricacao` | `anoFab` | Sim | AAAA | Ano de fabricação |
| `tipo_pintura` | `tpPint` | Sim | `S` | M=Metálica, S=Sólida, P=Perolizada |
| `tipo` | `tpVeic` | Sim | `10` | Código RENAVAM (ver tabela) |
| `especie` | `espVeic` | Sim | `2` | 1=Passag, 2=Carga, 3=Misto, 4=Corrida, 5=Tração, 6=Especial |
| `vin` | `VIN` | Sim | `N` | N=Normal, R=Remarcado |
| `condicao` | `condVeic` | Sim | `1` | 1=Acabado, 2=Inacabado, 3=Semi-acabado |
| `codigo_marca_modelo` | `cMod` | Sim | Tabela RENAVAM | Código marca/modelo (6 dígitos) |
| `codigo_cor_denatran` | `cCorDENATRAN` | Sim | Ver tabela | Código cor DENATRAN |
| `lotacao` | `lota` | Sim | `0` | Qtd máx. passageiros (reboque = 0) |
| `restricao` | `tpRest` | Sim | `0` | 0=Sem restrição, 1=Alien.Fiduc, 2=Arrend, 3=Res.Dom, 9=Outras |

## 8. Tabelas de Referência

### Tipo de Veículo (tpVeic — RENAVAM)
| Código | Tipo |
|--------|------|
| `06` | Automóvel |
| `07` | Micro-ônibus |
| `08` | Ônibus |
| **`10`** | **Reboque** |
| `13` | Caminhoneta |
| `14` | Caminhão |
| `17` | Cavalo-trator |

### Cor DENATRAN (cCorDENATRAN)
| Código | Cor |
|--------|-----|
| `01` | Amarelo |
| `02` | Azul |
| `03` | Bege |
| `04` | Branca |
| `05` | Cinza |
| `06` | Dourada |
| `07` | Grená |
| `08` | Laranja |
| `09` | Marrom |
| `10` | Prata |
| `11` | Preta |
| `12` | Rosa |
| `13` | Roxa |
| `14` | Verde |
| `15` | Vermelha |
| `16` | Fantasia |

### Tipo de Combustível (tpComb)
| Código | Tipo |
|--------|------|
| `01` | Álcool |
| `02` | Gasolina |
| `03` | Diesel |
| `16` | Álcool/Gasolina |
| **`99`** | **Sem combustível (reboque)** |

> **Nota:** Verificar com SEFAZ do estado se aceita `99` para reboques.
> Alguns estados podem exigir outro código. Testar em homologação primeiro.

## 9. Fluxo de Emissão no Avequi

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  SalesOrder  │────>│ FiscalMapper │────>│ Focus NFe   │────>│    SEFAZ     │
│  (INVOICED)  │     │ (payload)    │     │ (API POST)  │     │ (autoriza)   │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
                                               │                     │
                                               │    ┌────────────────┘
                                               │    │ webhook
                                               ▼    ▼
                                         ┌──────────────┐
                                         │FiscalDocument │
                                         │ (persiste     │
                                         │  chave, XML,  │
                                         │  protocolo)   │
                                         └──────────────┘
                                               │
                                               ▼
                                         ┌──────────────┐
                                         │ Financial     │
                                         │ Entry         │
                                         │ (receivable)  │
                                         └──────────────┘
```

## 10. Regras Tributárias — NCM 8716.39.00

### ICMS — Sem ST em nenhum estado

| Origem | Destino | CFOP | Alíquota | CST | ST? |
|--------|---------|------|----------|-----|-----|
| PR | PR | 5101 | 12% | 000 | Não |
| SC | SC | 5101 | 12% | 000 | Não |
| PR/SC | RS | 6101 | 12% | 000 | Não |
| PR/SC | SP | 6101 | 12% | 000 | Não |
| PR/SC | MG | 6101 | 12% | 000 | Não |

### IPI
- CST: **51** (saída tributada com alíquota zero)
- Alíquota: **0%** — TIPI Decreto 11.158/2022
- BC: valor do produto
- Valor: R$ 0,00

### PIS/COFINS (Lucro Presumido)
- PIS: CST 01, alíquota 0,65%
- COFINS: CST 01, alíquota 3,00%

### Fundamentos
- Sem ICMS-ST: NCM 8716.39.00 (reboque inteiro) não consta nos anexos de ST de nenhum estado
- CESTs 01.077.00 e 01.127.00 são para **peças** (NCM 8716.90.90), não para o veículo completo
- Base: Convênio ICMS 142/2018, consultas SEFA/PR, COPAT/SC, SEFAZ/SP, SEFAZ/MG
