# -*- coding: utf-8 -*-
"""
Reidratação do histórico fiscal — EXTRACTOR (etapa 1 de 2). SOMENTE LEITURA.

Lê o DB_Financeiro (staging da carga de 18/06) e os XMLs históricos em disco e
produz o dataset de reconstrução consumido por rehydrate-fiscal-history.ts:

    <out>/headers.jsonl   1 linha por chave NF-e (cabeçalhos saída/entrada,
                          totais e metadados do XML: dhEmi/dhRecbto/nProt com
                          offset preservado, confiabilidade, sha256, caminho)
    <out>/items.jsonl     1 linha por item de origem (legacyId item_saida_N /
                          item_entrada_N → campos + origem/modalidadeBC ICMS)
    <out>/manifest.json   contagens e hashes para conferência

O DB_Financeiro/XML é fonte de RECONSTRUÇÃO do histórico, não nova fonte de
verdade permanente. Este script não escreve em banco nenhum.

Uso (na máquina que enxerga o SQL Server local e a pasta de XMLs):

    python rehydrate-extract-source.py --out <dir> \
        [--server RAFAEL] [--database DB_Financeiro] \
        [--xml-dir ~/projetos_claude/projeto_sql_xml/dados/notas_xml]

Requisitos: Python 3.11+, pyodbc, ODBC Driver 17 for SQL Server.
"""
import argparse
import collections
import hashlib
import io
import json
import os
import re
import sys

import pyodbc

DIGITS = re.compile(r"\D")


def norm_cnpj(v):
    return DIGITS.sub("", v or "")


def dec(v):
    """Decimal→string sem float (None → None)."""
    return None if v is None else format(v, "f") if hasattr(v, "as_tuple") else str(v)


def local_dt(v):
    """datetime do SQL Server (hora local do emitente) → 'YYYY-MM-DD HH:MM:SS'."""
    return None if v is None else v.strftime("%Y-%m-%d %H:%M:%S")


def connect(server, database):
    for candidate in [server, "localhost", ".", "(local)"]:
        try:
            return pyodbc.connect(
                "DRIVER={ODBC Driver 17 for SQL Server};"
                f"SERVER={candidate};DATABASE={database};"
                "Trusted_Connection=yes;TrustServerCertificate=yes;",
                timeout=8,
            )
        except pyodbc.Error:
            continue
    raise SystemExit(f"não conectou ao SQL Server ({server}/{database})")


def q(cn, sql):
    cur = cn.cursor()
    cur.execute(sql)
    return cur.fetchall()


def index_xmls(base):
    """chave (44 dígitos no nome do arquivo) → lista de caminhos."""
    files = collections.defaultdict(list)
    for root, _dirs, fns in os.walk(base):
        for fn in fns:
            if not fn.lower().endswith(".xml"):
                continue
            m = re.search(r"(\d{44})", fn)
            if m:
                files[m.group(1)].append(os.path.join(root, fn))
    return files


def xml_meta(chave, paths):
    """Extrai dhEmi/dhRecbto/nProt PRESERVANDO offset; decide confiabilidade.

    Confiável = pelo menos 1 arquivo de nota válido com chave interna
    conferindo e protNFe/infProt completo; havendo VÁRIOS arquivos (ex.: a
    mesma NF-e intra-grupo baixada na pasta de saída da CRD e na de entrada da
    GDR), todos os candidatos válidos têm de CONCORDAR nos 3 campos extraídos
    (dhEmi, dhRecbto, nProt) — bytes diferentes com os mesmos fatos fiscais
    não invalidam a fonte; fatos divergentes sim.
    """
    meta = {
        "found": False, "reliable": False, "path": None, "sha256": None,
        "dhEmi": None, "dhRecbto": None, "nProt": None,
    }
    off = re.compile(r"[+-]\d{2}:\d{2}$")
    candidates = []
    for p in paths:
        try:
            txt = io.open(p, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        if "<nfeProc" not in txt and "<NFe" not in txt:
            continue
        meta["found"] = True
        idm = re.search(r'<infNFe[^>]*Id="NFe(\d{44})"', txt)
        if not idm or idm.group(1) != chave:
            continue
        prot = re.search(r"<protNFe.*?</protNFe>", txt, re.S)
        if not prot:
            continue
        dh_emi = re.search(r"<dhEmi>([^<]+)</dhEmi>", txt)
        dh_rec = re.search(r"<dhRecbto>([^<]+)</dhRecbto>", prot.group(0))
        n_prot = re.search(r"<nProt>([^<]+)</nProt>", prot.group(0))
        if not (dh_emi and dh_rec and n_prot):
            continue
        if not off.search(dh_emi.group(1)) or not off.search(dh_rec.group(1)):
            continue  # sem offset explícito não há como preservar o instante
        candidates.append(
            (p, txt, dh_emi.group(1), dh_rec.group(1), n_prot.group(1))
        )
    if not candidates:
        return meta
    facts = {(c[2], c[3], c[4]) for c in candidates}
    if len(facts) > 1:
        return meta  # arquivos com fatos fiscais divergentes: não confiável
    p, txt, dh_emi, dh_rec, n_prot = candidates[0]
    meta.update(
        reliable=True, path=p,
        sha256=hashlib.sha256(txt.encode("utf-8", "ignore")).hexdigest(),
        dhEmi=dh_emi, dhRecbto=dh_rec, nProt=n_prot,
    )
    return meta


TOTAL_MAP = [
    ("vProd", "valor_produtos"), ("vFrete", "valor_frete"), ("vSeg", "valor_seguro"),
    ("vDesc", "valor_desconto"), ("vOutro", "valor_outros"), ("vIPI", "valor_ipi"),
    ("vICMS", "valor_icms"), ("vICMSUFDest", "valor_icms_uf_dest"),
    ("vFCPUFDest", "valor_fcp_uf_dest"), ("vPIS", "valor_pis"),
    ("vCOFINS", "valor_cofins"), ("vNF", "valor_nota"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--server", default="RAFAEL")
    ap.add_argument("--database", default="DB_Financeiro")
    ap.add_argument(
        "--xml-dir",
        default=os.path.expanduser("~/projetos_claude/projeto_sql_xml/dados/notas_xml"),
    )
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    cn = connect(args.server, args.database)

    # ── cabeçalhos ──
    headers = {}
    for r in q(cn, "SELECT chave_nfe, cnpj_emitente, cpf_cnpj_destinatario, nome_destinatario, numero_nota, serie, data_emissao, natureza_operacao, tipo_nota, protocolo FROM dbo.stg_nota_saida"):
        headers.setdefault(r[0], {"chave": r[0], "saida": None, "entrada": None, "totais": None})
        headers[r[0]]["saida"] = {
            "emitCnpj": norm_cnpj(r[1]), "destCnpj": norm_cnpj(r[2]), "destNome": r[3],
            "numero": int(r[4]), "serie": int(r[5]), "emissaoLocal": local_dt(r[6]),
            "natOp": r[7], "tpNF": int(r[8]) if r[8] is not None else None, "protocolo": r[9],
        }
    for r in q(cn, "SELECT chave_nfe, cnpj_empresa, cnpj_cpf_emitente, nome_emitente, numero_nota, serie, data_emissao, natureza_operacao, tipo_nota, protocolo FROM dbo.stg_nota_entrada"):
        headers.setdefault(r[0], {"chave": r[0], "saida": None, "entrada": None, "totais": None})
        headers[r[0]]["entrada"] = {
            "companyCnpj": norm_cnpj(r[1]), "emitCnpj": norm_cnpj(r[2]), "emitNome": r[3],
            "numero": int(r[4]), "serie": int(r[5]), "emissaoLocal": local_dt(r[6]),
            "natOp": r[7], "tpNF": int(r[8]) if r[8] is not None else None, "protocolo": r[9],
        }

    # ── totais (entrada e saída têm o mesmo layout) ──
    for table in ("stg_total_nota_entrada", "stg_total_nota_saida"):
        cols = ", ".join(src for _dst, src in TOTAL_MAP)
        for r in q(cn, f"SELECT chave_nfe, {cols} FROM dbo.{table}"):
            if r[0] in headers:
                headers[r[0]]["totais"] = {
                    dst: dec(r[i + 1]) for i, (dst, _src) in enumerate(TOTAL_MAP) if r[i + 1] is not None
                }

    # ── impostos por (chave, nItem) ──
    tax = {}
    for table, side in (("stg_item_imposto_saida", "S"), ("stg_item_imposto_entrada", "E")):
        for r in q(cn, f"SELECT chave_nfe, numero_item, origem_icms, modalidade_bc_icms FROM dbo.{table}"):
            tax[(side, r[0], int(r[1]))] = {
                "origemIcms": str(r[2]) if r[2] is not None else None,
                "modalidadeBcIcms": str(r[3]) if r[3] is not None else None,
            }

    # ── itens ──
    items = []
    for table, side, prefix in (
        ("stg_item_nota_saida", "S", "item_saida_"),
        ("stg_item_nota_entrada", "E", "item_entrada_"),
    ):
        for r in q(cn, f"SELECT id, chave_nfe, numero_item, codigo_produto, descricao_produto, ncm, cfop, unidade, quantidade, valor_unitario, valor_total FROM dbo.{table}"):
            t = tax.get((side, r[1], int(r[2])), {})
            items.append({
                "legacyId": f"{prefix}{r[0]}", "chave": r[1], "side": side,
                "nItem": int(r[2]), "cProd": r[3], "descricao": r[4], "ncm": r[5],
                "cfop": r[6], "unidade": r[7], "quantidade": dec(r[8]),
                "valorUnitario": dec(r[9]), "valorTotal": dec(r[10]),
                "origemIcms": t.get("origemIcms"), "modalidadeBcIcms": t.get("modalidadeBcIcms"),
            })

    # ── XML ──
    files = index_xmls(args.xml_dir)
    xml_stats = collections.Counter()
    for chave, h in headers.items():
        h["xml"] = xml_meta(chave, files.get(chave, []))
        xml_stats["reliable" if h["xml"]["reliable"] else ("found_unreliable" if h["xml"]["found"] else "missing")] += 1

    # ── saída ──
    def dump(name, rows):
        path = os.path.join(args.out, name)
        sha = hashlib.sha256()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            for row in rows:
                line = json.dumps(row, ensure_ascii=False, sort_keys=True)
                sha.update(line.encode("utf-8"))
                f.write(line + "\n")
        return sha.hexdigest()

    h_sha = dump("headers.jsonl", (headers[k] for k in sorted(headers)))
    i_sha = dump("items.jsonl", sorted(items, key=lambda x: x["legacyId"]))
    manifest = {
        "generatedAt": None,  # carimbado pelo chamador se necessário; extração é determinística
        "headers": len(headers), "items": len(items),
        "itemsSaida": sum(1 for i in items if i["side"] == "S"),
        "itemsEntrada": sum(1 for i in items if i["side"] == "E"),
        "xml": dict(xml_stats),
        "sha256": {"headers.jsonl": h_sha, "items.jsonl": i_sha},
    }
    io.open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8").write(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    )
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
