// GET /heatmap           — página
// GET /api/heatmap       — lista de telas (contextos) e alunos com cliques
// GET /api/heatmap?ctx=  — pontos de clique daquela tela
//
// Cada clique vem do jogo com a cena, o "contexto" (painéis abertos naquele
// instante), a posição 0–1 e o elemento de UI embaixo do ponteiro. O print de
// fundo é escolhido pelo navegador a partir da pasta Telemetria/Capturas do
// projeto (tirada no Editor) e não é enviado ao servidor.

import scriptHeatmap from "./cliente/heatmap.cliente.js";
import { cabecalhoFiltros, filtrosDaUrl, html, json, layout } from "./util.js";

const MAX_PONTOS = 20_000;

export async function paginaHeatmap(url, env) {
  const filtros = await cabecalhoFiltros(env, url, "/heatmap");
  const { turma } = filtrosDaUrl(url);

  const corpo = `<h1>Heatmap de cliques</h1>
${filtros}
${turma ? CONTROLES : '<p class="nota">Escolha uma turma acima.</p>'}`;

  return html(layout("Heatmap", "/heatmap", corpo, { script: turma ? scriptHeatmap : "", estilo: ESTILO }));
}

export async function apiHeatmap(url, env) {
  const ctx = url.searchParams.get("ctx");
  const f = filtrosDaUrl(url, "r");
  const cond = ["r.tipo = 'cliques'", ...f.where];

  if (!ctx) {
    const { results: contextos } = await env.DB.prepare(
      `SELECT json_extract(j.value, '$.ctx') AS ctx, COUNT(*) AS n, COUNT(DISTINCT r.aluno) AS alunos
         FROM registros r, json_each(r.dados, '$.itens') j
        WHERE ${cond.join(" AND ")}
        GROUP BY 1 ORDER BY n DESC LIMIT 500`
    ).bind(...f.binds).all();

    // A lista de alunos ignora o filtro de aluno, para dar para trocar.
    const semAluno = new URL(url);
    semAluno.searchParams.delete("aluno");
    const g = filtrosDaUrl(semAluno, "r");
    const { results: alunos } = await env.DB.prepare(
      `SELECT r.aluno, MAX(r.aluno_nome) AS nome FROM registros r
        WHERE ${["r.tipo = 'cliques'", ...g.where].join(" AND ")}
        GROUP BY r.aluno ORDER BY nome`
    ).bind(...g.binds).all();

    return json({ contextos, alunos });
  }

  const { results } = await env.DB.prepare(
    `SELECT json_extract(j.value, '$.x') AS x, json_extract(j.value, '$.y') AS y,
            json_extract(j.value, '$.res') AS res, json_extract(j.value, '$.alvo') AS alvo,
            json_extract(j.value, '$.ui') AS ui, json_extract(j.value, '$.b') AS b, r.aluno AS a
       FROM registros r, json_each(r.dados, '$.itens') j
      WHERE ${cond.join(" AND ")} AND json_extract(j.value, '$.ctx') = ?
      LIMIT ${MAX_PONTOS + 1}`
  ).bind(...f.binds, ctx).all();

  const cortado = results.length > MAX_PONTOS;
  // Arrays em vez de objetos: a resposta fica ~3x menor.
  const pontos = results.slice(0, MAX_PONTOS).map((p) => [p.x, p.y, p.res, p.alvo, p.ui ? 1 : 0, p.b, p.a]);
  return json({ pontos, cortado });
}

const CONTROLES = `
<div class="filtros">
  <label>Cena<select id="cena"></select></label>
  <label>Tela (contexto)<select id="ctx"></select></label>
  <label>Aluno<select id="aluno"><option value="">Todos</option></select></label>
  <label>Resolução<select id="res"></select></label>
  <label>Mostrar<select id="modo">
    <option value="calor">Calor (densidade)</option>
    <option value="pontos">Pontos (acertou botão ou não)</option>
  </select></label>
  <label>Força do fundo<input id="fundo" type="range" min="0" max="100" value="70"></label>
</div>
<div class="filtros">
  <label>Pasta de capturas (Telemetria/Capturas)
    <input id="pasta" type="file" webkitdirectory multiple accept="image/png"></label>
  <label>…ou uma imagem
    <input id="imagem" type="file" accept="image/*"></label>
  <span id="statusFundo" class="nota"></span>
</div>
<div id="avisos"></div>
<div id="avisoProporcao"></div>
<div class="area">
  <figure class="quadro">
    <div class="tela" id="tela">
      <canvas id="canvas" role="img" aria-label="Heatmap de cliques"></canvas>
      <div id="dica" class="dica" hidden></div>
    </div>
    <figcaption id="legenda" class="legenda"></figcaption>
  </figure>
  <section class="lado">
    <div class="cartoes">
      <div class="cartao"><b id="total">—</b><span>cliques nesta tela</span></div>
      <div class="cartao"><b id="vazios">—</b><span>fora de qualquer botão</span></div>
    </div>
    <h2>Onde clicaram</h2>
    <div class="rolagem"><table id="alvos"><thead><tr><th>Elemento</th><th class="num">Cliques</th><th class="num">%</th></tr></thead><tbody></tbody></table></div>
  </section>
</div>
<details class="nota">
  <summary>Como conseguir o print de cada tela</summary>
  <p>Rode o jogo no Editor do Unity e passe pelas telas. A cada tela nova (cena + painéis abertos),
  o jogo salva um print em <code>Telemetria/Capturas/</code> na pasta do projeto. Escolha essa pasta
  acima: o painel acha sozinho o print de cada tela. Para tirar de novo, apague a pasta.</p>
  <p>Use no Editor a mesma resolução do jogo publicado (no itch.io, o tamanho do iframe). Cliques
  de outra proporção de tela não batem com o print e aparecem num aviso.</p>
</details>`;

const ESTILO = `
  .area { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
  @media (max-width: 900px) { .area { grid-template-columns: 1fr; } }
  .quadro { margin: 0; }
  .tela { position: relative; background: var(--superficie); border: 1px solid var(--borda); border-radius: 8px; overflow: hidden; }
  canvas { display: block; width: 100%; height: auto; }
  .dica { position: absolute; pointer-events: none; background: var(--superficie); color: var(--texto); border: 1px solid var(--borda-forte); border-radius: 6px; padding: 6px 8px; font-size: 0.8rem; box-shadow: 0 2px 8px rgb(0 0 0 / 0.15); max-width: 260px; white-space: normal; }
  .legenda { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; font-size: 0.8rem; color: var(--texto-2); margin-top: 8px; }
  .rampa { display: inline-block; width: 140px; height: 10px; border-radius: 4px; background: linear-gradient(90deg, var(--seq-100), var(--seq-300), var(--seq-500), var(--seq-700)); vertical-align: middle; }
  .marca { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; margin-right: 4px; box-shadow: 0 0 0 2px var(--superficie); }
  .barra { display: block; height: 4px; border-radius: 0 4px 4px 0; background: var(--seq-400); margin-top: 3px; }
  #alvos td:first-child { white-space: normal; word-break: break-all; max-width: 200px; }`;
