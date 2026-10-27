// GET /painel?turma=7A&testes=0  — tabela aluno x fase
// GET /csv?turma=7A&tipo=resumo|cliques|teclas

import {
  cabecalhoFiltros, celulaCsv, esc, filtrosDaUrl, formatarTempo, html, layout, linkCom,
} from "./util.js";

// Registros antigos (antes de "resultado" existir) só têm "venceu".
const RESULTADO = `COALESCE(json_extract(dados, '$.resultado'),
  CASE WHEN json_extract(dados, '$.venceu') THEN 'vitoria' ELSE 'derrota' END)`;

export async function painel(url, env) {
  const f = filtrosDaUrl(url);
  const filtros = await cabecalhoFiltros(env, url, "/painel");

  let conteudo = '<p class="nota">Escolha uma turma acima.</p>';

  if (f.turma) {
    const where = ["fase LIKE 'Fase%'", "tipo IN ('batalha', 'fase', 'evento')", ...f.where];
    const { results } = await env.DB.prepare(
      `SELECT aluno,
              MAX(aluno_nome) AS nome,
              fase,
              SUM(CASE WHEN tipo = 'batalha' THEN COALESCE(acertos, 0) ELSE 0 END) AS acertos,
              SUM(CASE WHEN tipo = 'batalha' THEN COALESCE(erros, 0) ELSE 0 END)   AS erros,
              SUM(CASE WHEN tipo = 'fase' THEN duracao_s END) AS tempo_fase,
              SUM(tipo = 'fase') AS concluida,
              SUM(tipo = 'batalha' AND ${RESULTADO} = 'vitoria') AS vitorias,
              SUM(tipo = 'batalha' AND ${RESULTADO} = 'derrota') AS derrotas,
              SUM(tipo = 'batalha' AND ${RESULTADO} = 'fuga')    AS fugas,
              SUM(tipo = 'batalha' AND ${RESULTADO} IN ('feitico', 'reinicio')) AS reinicios,
              SUM(tipo = 'evento' AND json_extract(dados, '$.evento') = 'saiu') AS saiu
         FROM registros
        WHERE ${where.join(" AND ")}
        GROUP BY aluno, fase`
    ).bind(...f.binds).all();

    const { results: alunos } = await env.DB.prepare(
      `SELECT aluno, MAX(aluno_nome) AS nome, COUNT(DISTINCT sessao) AS sessoes,
              MAX(COALESCE(cliente_em, criado_em)) AS ultimo
         FROM registros WHERE ${f.where.join(" AND ") || "1"}
        GROUP BY aluno`
    ).bind(...f.binds).all();

    conteudo = montarTabela(results, alunos) + `
<p class="nota">Célula: acertos / erros · tempo na fase. Embaixo: batalhas
<b>V</b>itória, <b>D</b>errota, <b>F</b>uga, <b>R</b>einício. Fundo verde = fase concluída.
<b>saiu</b> = fechou o jogo nessa fase sem concluir.</p>
<p class="nota">Acertos: nas Fases 2_4 e 2_5, a conta certa. Nas outras, escolher a arma que dava o maior dano possível.</p>`;
  }

  const { turma, testes } = f;
  const csv = f.turma
    ? `<p>Baixar CSV da turma:
        <a class="botao" href="${esc(linkCom("/csv", { turma, testes }))}">Resumo</a>
        <a class="botao" href="${esc(linkCom("/csv", { turma, testes, tipo: "cliques" }))}">Cliques</a>
        <a class="botao" href="${esc(linkCom("/csv", { turma, testes, tipo: "teclas" }))}">Teclas</a></p>`
    : "";

  return html(layout("Resultados", "/painel", `<h1>Resultados</h1>${filtros}${csv}${conteudo}`, {
    estilo: `
      td.celula { text-align: center; line-height: 1.25; }
      td.feita { background: var(--feita); }
      .ok { color: var(--bom-texto); font-weight: 600; }
      .err { color: var(--critico); font-weight: 600; }
      .t, .vdf { color: var(--texto-2); font-size: 0.75rem; }
      .saiu { color: var(--critico); font-size: 0.72rem; font-weight: 600; }
      td.nome { font-weight: 600; }`,
  }));
}

function montarTabela(linhas, alunos) {
  if (alunos.length === 0) return '<p class="nota">Sem registros para esta turma.</p>';

  const fases = [...new Set(linhas.map((l) => l.fase))].sort();
  const porAluno = new Map(alunos.map((a) => [a.aluno, { ...a, fases: {} }]));
  for (const l of linhas) porAluno.get(l.aluno).fases[l.fase] = l;

  const cabecalho = `<tr><th>Aluno</th><th class="num">Sessões</th><th>Última atividade</th>${fases.map((f) => `<th>${esc(f)}</th>`).join("")}</tr>`;

  const corpo = [...porAluno.values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((a) => {
      const celulas = fases.map((f) => {
        const c = a.fases[f];
        if (!c) return `<td class="celula vazio">—</td>`;
        const tempo = c.tempo_fase ? ` <span class="t">${formatarTempo(c.tempo_fase)}</span>` : "";
        const vdf = [["V", c.vitorias], ["D", c.derrotas], ["F", c.fugas], ["R", c.reinicios]]
          .filter(([, n]) => n > 0).map(([l, n]) => `${n}${l}`).join(" ");
        const saiu = c.saiu > 0 && !c.concluida ? ' <span class="saiu">saiu</span>' : "";
        return `<td class="celula${c.concluida > 0 ? " feita" : ""}"><span class="ok">${c.acertos}</span> / <span class="err">${c.erros}</span>${tempo}${saiu}` +
          (vdf ? `<br><span class="vdf">${vdf}</span>` : "") + `</td>`;
      });
      const ultimo = new Date(a.ultimo).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
      return `<tr><td class="nome">${esc(a.nome)}</td><td class="num">${a.sessoes}</td><td>${ultimo}</td>${celulas.join("")}</tr>`;
    })
    .join("");

  return `<div class="rolagem"><table>${cabecalho}${corpo}</table></div>`;
}

// Separador ";" e BOM UTF-8 para o Excel em português abrir certo.
// tipo=cliques/teclas: uma linha por evento (os lotes são abertos com json_each).
export async function csv(url, env) {
  const f = filtrosDaUrl(url);
  const tipo = url.searchParams.get("tipo") || "resumo";
  const where = f.where.map((w) => "r." + w);

  let colunas, sql;
  if (tipo === "cliques" || tipo === "teclas") {
    const campos = tipo === "cliques"
      ? ["ts", "tf", "x", "y", "b", "res", "ctx", "modo", "alvo", "ui", "toque", "wx", "wy"]
      : ["ts", "tf", "k", "d", "ctx", "modo"];
    colunas = ["criado_em", "turma", "aluno_nome", "sessao", "fase", ...campos];
    sql = `SELECT r.criado_em, r.turma, r.aluno_nome, r.sessao, r.fase,
                  ${campos.map((c) => `json_extract(j.value, '$.${c}') AS ${c}`).join(", ")}
             FROM registros r, json_each(r.dados, '$.itens') j
            WHERE r.tipo = '${tipo}' ${where.length ? "AND " + where.join(" AND ") : ""}
            ORDER BY r.criado_em`;
  } else {
    colunas = ["criado_em", "cliente_em", "turma", "aluno_nome", "sessao", "tipo", "fase",
               "acertos", "erros", "duracao_s", "versao", "teste", "dados"];
    // Lotes de cliques/teclas passam do limite de uma célula do Excel; têm CSV próprio.
    sql = `SELECT ${colunas.map((c) => "r." + c).join(", ")} FROM registros r
            WHERE r.tipo NOT IN ('cliques', 'teclas') ${where.length ? "AND " + where.join(" AND ") : ""}
            ORDER BY r.criado_em`;
  }

  const { results } = await env.DB.prepare(sql).bind(...f.binds).all();

  const linhas = [colunas.join(";")];
  for (const r of results) {
    linhas.push(colunas.map((c) => {
      const v = (c === "criado_em" || c === "cliente_em") && r[c] ? new Date(r[c]).toISOString() : r[c];
      return celulaCsv(v);
    }).join(";"));
  }

  const nome = `linusbae_${f.turma || "todas"}_${tipo}.csv`;
  return new Response("﻿" + linhas.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
    },
  });
}
