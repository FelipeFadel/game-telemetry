// GET  /dados              — página para ver, editar e apagar registros
// GET  /api/registros      — lista paginada (com os mesmos filtros da página)
// GET  /api/registro?id=   — um registro completo (para o editor)
// GET  /api/opcoes         — turmas, tipos, fases e alunos existentes
// POST /api/alterar        — { ids:[...] | filtro:{...}, acao:"apagar"|"atualizar", campos:{...} }
// GET  /api/historico      — últimas alterações, agrupadas por operação
// POST /api/desfazer       — { lote }
//
// Toda alteração copia as linhas antes de mexer (tabela alteracoes), então
// qualquer edição ou exclusão pode ser desfeita pelo histórico.

import scriptDados from "./cliente/dados.cliente.js";
import {
  COLUNAS, TIPOS_VALIDOS, erro, filtroTestes, html, json, layout, limitar, limparEspacos, normalizarNome,
} from "./util.js";

const POR_PAGINA = 100;
const MAX_IDS = 5000;
const MAX_DADOS_BYTES = 64_000;
const JSON_LINHA = `json_object(${COLUNAS.map((c) => `'${c}', ${c}`).join(", ")})`;
// Datas do filtro são dias no horário de Brasília.
const FUSO = "-03:00";

// Filtro comum à listagem e às alterações. "real" diz se há algum filtro além
// do de testes (alterar sem filtro nenhum seria alterar o banco inteiro).
function montarFiltro(f, { ignorarTestes = false } = {}) {
  const where = [];
  const binds = [];
  const add = (sql, ...v) => { where.push(sql); binds.push(...v); };

  if (Array.isArray(f.ids)) add("id IN (SELECT value FROM json_each(?))", JSON.stringify(f.ids.map(String)));
  if (f.turma) add("turma = ?", String(f.turma).toUpperCase());
  if (f.aluno) add("aluno = ?", normalizarNome(String(f.aluno)));
  if (f.tipo) add("tipo = ?", String(f.tipo));
  if (f.fase) add(f.fase === "(sem fase)" ? "fase IS NULL" : "fase = ?", ...(f.fase === "(sem fase)" ? [] : [String(f.fase)]));
  if (f.sessao) add("sessao = ?", String(f.sessao));
  const de = f.de ? Date.parse(`${f.de}T00:00:00${FUSO}`) : NaN;
  const ate = f.ate ? Date.parse(`${f.ate}T00:00:00${FUSO}`) : NaN;
  if (Number.isFinite(de)) add("criado_em >= ?", de);
  if (Number.isFinite(ate)) add("criado_em < ?", ate + 24 * 3600 * 1000);
  const real = where.length > 0;

  if (!ignorarTestes) {
    const t = filtroTestes(f.testes || "0");
    if (t) where.push(t);
  }

  return { where: where.length ? "WHERE " + where.join(" AND ") : "", binds, real };
}

export function paginaDados() {
  return html(layout("Gerenciar dados", "/dados", CORPO, { script: scriptDados, estilo: ESTILO }));
}

export async function apiRegistros(url, env) {
  const p = Object.fromEntries(url.searchParams);
  const filtro = montarFiltro(p);
  const pagina = Math.max(1, parseInt(p.pagina, 10) || 1);

  const [total, linhas] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM registros ${filtro.where}`).bind(...filtro.binds),
    env.DB.prepare(
      `SELECT id, sessao, aluno, aluno_nome, turma, tipo, fase, acertos, erros, duracao_s, versao,
              criado_em, cliente_em, teste, substr(dados, 1, 160) AS dados_inicio, length(dados) AS dados_tam
         FROM registros ${filtro.where}
        ORDER BY COALESCE(cliente_em, criado_em) DESC, id
        LIMIT ${POR_PAGINA} OFFSET ?`
    ).bind(...filtro.binds, (pagina - 1) * POR_PAGINA),
  ]);

  return json({ total: total.results[0].n, porPagina: POR_PAGINA, pagina, linhas: linhas.results });
}

export async function apiRegistro(url, env) {
  const linha = await env.DB.prepare("SELECT * FROM registros WHERE id = ?").bind(url.searchParams.get("id") || "").first();
  return linha ? json(linha) : erro(404, "Registro não encontrado");
}

export async function apiOpcoes(env) {
  const [turmas, tipos, fases, alunos] = (await env.DB.batch([
    env.DB.prepare("SELECT turma, COUNT(*) AS n FROM registros GROUP BY turma ORDER BY turma"),
    env.DB.prepare("SELECT tipo, COUNT(*) AS n FROM registros GROUP BY tipo ORDER BY tipo"),
    env.DB.prepare("SELECT COALESCE(fase, '(sem fase)') AS fase, COUNT(*) AS n FROM registros GROUP BY fase ORDER BY fase"),
    env.DB.prepare("SELECT aluno, MAX(aluno_nome) AS nome, COUNT(*) AS n FROM registros GROUP BY aluno ORDER BY nome"),
  ])).map((r) => r.results);
  return json({ turmas, tipos, fases, alunos, tiposValidos: TIPOS_VALIDOS });
}

export async function apiAlterar(request, env) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erro(400, "JSON inválido");
  }

  const acao = corpo.acao;
  if (acao !== "apagar" && acao !== "atualizar") return erro(400, "Ação inválida");

  const porIds = Array.isArray(corpo.ids);
  if (porIds && (corpo.ids.length === 0 || corpo.ids.length > MAX_IDS)) return erro(400, `Escolha de 1 a ${MAX_IDS} registros`);
  // Com ids escolhidos à mão, o filtro de testes não se aplica (senão não daria para desmarcar).
  const filtro = montarFiltro(porIds ? { ids: corpo.ids } : corpo.filtro || {}, { ignorarTestes: porIds });
  if (!filtro.real) return erro(400, "Escolha registros ou pelo menos um filtro");

  let sets;
  if (acao === "atualizar") {
    try {
      sets = validarCampos(corpo.campos || {});
    } catch (e) {
      return erro(400, e.message);
    }
  }

  const lote = crypto.randomUUID();
  const descricao = limitar(String(corpo.descricao || ""), 200);
  const foto = env.DB.prepare(
    `INSERT INTO alteracoes (feito_em, acao, registro_id, antes, lote, descricao)
     SELECT ?, ?, id, ${JSON_LINHA}, ?, ? FROM registros ${filtro.where}`
  ).bind(Date.now(), acao, lote, descricao, ...filtro.binds);

  // batch = uma transação: a cópia e a alteração acontecem juntas ou nenhuma.
  let resultados;
  if (acao === "apagar") {
    resultados = await env.DB.batch([
      foto,
      env.DB.prepare(`DELETE FROM registros ${filtro.where}`).bind(...filtro.binds),
    ]);
  } else {
    resultados = await env.DB.batch([
      foto,
      env.DB.prepare(`UPDATE registros SET ${sets.sql.join(", ")} ${filtro.where}`).bind(...sets.binds, ...filtro.binds),
      env.DB.prepare(
        `UPDATE alteracoes SET depois = (SELECT ${JSON_LINHA} FROM registros WHERE registros.id = alteracoes.registro_id)
          WHERE lote = ?`
      ).bind(lote),
    ]);
  }

  return json({ ok: true, lote, afetados: resultados[1].meta.changes });
}

// Campos que dá para editar e como cada um é validado.
function validarCampos(campos) {
  const sql = [];
  const binds = [];
  const set = (col, v) => { sql.push(`${col} = ?`); binds.push(v); };
  const numero = (k, v) => {
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${k} precisa ser um número`);
    return Math.round(n);
  };

  for (const [k, v] of Object.entries(campos)) {
    switch (k) {
      case "aluno_nome": {
        const nome = limparEspacos(limitar(String(v ?? ""), 40));
        if (!nome) throw new Error("O nome não pode ficar vazio");
        set("aluno_nome", nome);
        set("aluno", normalizarNome(nome)); // mesmo nome normalizado = mesmo aluno (mescla)
        break;
      }
      case "turma":
        set("turma", limparEspacos(limitar(String(v ?? ""), 20)).toUpperCase() || "GERAL");
        break;
      case "tipo":
        if (!TIPOS_VALIDOS.includes(v)) throw new Error("Tipo inválido");
        set("tipo", v);
        break;
      case "fase":
        set("fase", v ? limitar(String(v), 40) : null);
        break;
      case "acertos":
      case "erros":
      case "duracao_s":
        set(k, numero(k, v));
        break;
      case "dados": {
        if (v === null || v === "") { set("dados", null); break; }
        let valor;
        try {
          valor = typeof v === "string" ? JSON.parse(v) : v;
        } catch {
          throw new Error("Os dados precisam ser um JSON válido");
        }
        const texto = JSON.stringify(valor);
        if (texto.length > MAX_DADOS_BYTES) throw new Error("Dados grandes demais");
        set("dados", texto);
        break;
      }
      case "teste":
        set("teste", v ? 1 : 0);
        break;
      default:
        throw new Error(`Campo não editável: ${k}`);
    }
  }
  if (sql.length === 0) throw new Error("Nada para alterar");
  return { sql, binds };
}

export async function apiHistorico(env) {
  const { results } = await env.DB.prepare(
    `SELECT lote, acao, MIN(feito_em) AS feito_em, COUNT(*) AS n, MAX(descricao) AS descricao,
            MAX(desfeito_em) AS desfeito_em,
            substr(group_concat(DISTINCT json_extract(antes, '$.aluno_nome')), 1, 200) AS alunos
       FROM alteracoes GROUP BY lote ORDER BY feito_em DESC LIMIT 100`
  ).all();
  return json(results);
}

export async function apiDesfazer(request, env) {
  const { lote } = await request.json().catch(() => ({}));
  if (!lote) return erro(400, "Faltou o lote");

  const info = await env.DB.prepare(
    "SELECT acao, MAX(desfeito_em) AS desfeito_em FROM alteracoes WHERE lote = ? GROUP BY acao"
  ).bind(lote).first();
  if (!info) return erro(404, "Alteração não encontrada");
  if (info.desfeito_em) return erro(400, "Essa alteração já foi desfeita");

  const restaurar = info.acao === "apagar"
    ? env.DB.prepare(
        `INSERT OR REPLACE INTO registros (${COLUNAS.join(", ")})
         SELECT ${COLUNAS.map((c) => `json_extract(antes, '$.${c}')`).join(", ")}
           FROM alteracoes WHERE lote = ?1`
      ).bind(lote)
    : env.DB.prepare(
        `UPDATE registros SET ${COLUNAS.filter((c) => c !== "id").map((c) =>
          `${c} = (SELECT json_extract(a.antes, '$.${c}') FROM alteracoes a WHERE a.lote = ?1 AND a.registro_id = registros.id)`
        ).join(", ")}
         WHERE id IN (SELECT registro_id FROM alteracoes WHERE lote = ?1)`
      ).bind(lote);

  const resultados = await env.DB.batch([
    restaurar,
    env.DB.prepare("UPDATE alteracoes SET desfeito_em = ? WHERE lote = ?").bind(Date.now(), lote),
  ]);
  return json({ ok: true, restaurados: resultados[0].meta.changes });
}

const CORPO = `<h1>Gerenciar dados</h1>
<div class="abas" role="tablist">
  <button role="tab" data-aba="registros" aria-selected="true">Registros</button>
  <button role="tab" data-aba="historico" aria-selected="false">Histórico de alterações</button>
</div>

<section id="aba-registros">
  <form id="filtros" class="filtros">
    <label>Turma<select name="turma"></select></label>
    <label>Aluno<input name="aluno" list="lista-alunos" placeholder="nome do aluno" autocomplete="off"></label>
    <label>Tipo<select name="tipo"></select></label>
    <label>Fase<select name="fase"></select></label>
    <label>Sessão<input name="sessao" placeholder="id da sessão" size="12"></label>
    <label>De<input type="date" name="de"></label>
    <label>Até<input type="date" name="ate"></label>
    <label>Partidas de teste<select name="testes">
      <option value="0">Esconder</option><option value="1">Mostrar</option><option value="so">Só testes</option>
    </select></label>
    <button class="primario">Filtrar</button>
    <button type="button" id="limpar">Limpar</button>
  </form>
  <datalist id="lista-alunos"></datalist>

  <div class="barra">
    <span id="resumo" class="nota"></span>
    <span id="acoes-selecao" class="grupo" hidden>
      <b id="n-selecionados"></b>
      <button data-acao="teste">Marcar como teste</button>
      <button data-acao="nao-teste">Desmarcar teste</button>
      <button data-acao="turma">Mover para turma…</button>
      <button data-acao="nome">Renomear aluno…</button>
      <button data-acao="apagar" class="perigo">Apagar</button>
    </span>
  </div>
  <details class="em-massa">
    <summary>Aplicar a <b>todos</b> os <span id="n-filtro">0</span> registros do filtro</summary>
    <p class="nota">Use para apagar uma turma ou sessão inteira, juntar dois nomes do mesmo aluno, etc. Precisa de pelo menos um filtro.</p>
    <span class="grupo">
      <button data-acao-filtro="teste">Marcar como teste</button>
      <button data-acao-filtro="nao-teste">Desmarcar teste</button>
      <button data-acao-filtro="turma">Mover para turma…</button>
      <button data-acao-filtro="nome">Renomear aluno…</button>
      <button data-acao-filtro="apagar" class="perigo">Apagar todos</button>
    </span>
  </details>

  <div class="rolagem"><table id="tabela">
    <thead><tr>
      <th><input type="checkbox" id="marcar-pagina" aria-label="Selecionar a página"></th>
      <th>Quando</th><th>Turma</th><th>Aluno</th><th>Tipo</th><th>Fase</th>
      <th class="num">Acertos</th><th class="num">Erros</th><th class="num">Duração</th><th>Teste</th><th>Dados</th><th></th>
    </tr></thead>
    <tbody></tbody>
  </table></div>
  <div class="paginacao">
    <button id="anterior">‹ Anterior</button>
    <span id="pagina" class="nota"></span>
    <button id="proxima">Próxima ›</button>
  </div>
</section>

<section id="aba-historico" hidden>
  <p class="nota">Cada linha é uma operação. Desfazer devolve os registros como estavam antes dela.</p>
  <div class="rolagem"><table id="historico">
    <thead><tr><th>Quando</th><th>O quê</th><th class="num">Registros</th><th>Alunos</th><th></th></tr></thead>
    <tbody></tbody>
  </table></div>
</section>

<dialog id="editor">
  <form method="dialog" id="form-editor">
    <h2>Editar registro</h2>
    <p class="nota" id="editor-info"></p>
    <div class="campos">
      <label>Nome do aluno<input name="aluno_nome" required maxlength="40"></label>
      <label>Turma<input name="turma" maxlength="20"></label>
      <label>Tipo<select name="tipo"></select></label>
      <label>Fase<input name="fase" maxlength="40"></label>
      <label>Acertos<input name="acertos" type="number"></label>
      <label>Erros<input name="erros" type="number"></label>
      <label>Duração (s)<input name="duracao_s" type="number"></label>
      <label class="check"><input name="teste" type="checkbox"> Partida de teste</label>
    </div>
    <label class="bloco">Dados (JSON)<textarea name="dados" rows="12" spellcheck="false"></textarea></label>
    <p id="editor-erro" class="erro" role="alert"></p>
    <div class="botoes">
      <button value="cancelar" formnovalidate>Cancelar</button>
      <button value="salvar" class="primario" id="salvar">Salvar</button>
    </div>
  </form>
</dialog>

<div id="aviso" class="toast" role="status" hidden></div>`;

const ESTILO = `
  .abas { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--borda); }
  .abas button { border: none; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 6px 12px; color: var(--texto-2); }
  .abas button[aria-selected="true"] { border-bottom-color: var(--texto); color: var(--texto); font-weight: 600; }
  .barra { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; min-height: 36px; margin: 4px 0 8px; }
  .grupo { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .em-massa { background: var(--superficie); border: 1px solid var(--borda); border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; }
  .em-massa summary { cursor: pointer; }
  #tabela td.dados { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--texto-2); max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
  #tabela tr.marcada td { background: var(--fundo); }
  .etiqueta { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.75rem; border: 1px solid var(--borda-forte); }
  .paginacao { display: flex; gap: 12px; align-items: center; margin: 10px 0; }
  dialog { border: 1px solid var(--borda-forte); border-radius: 10px; background: var(--superficie); color: var(--texto); width: min(720px, calc(100vw - 32px)); padding: 16px; }
  dialog::backdrop { background: rgb(0 0 0 / 0.4); }
  dialog h2 { margin-top: 0; }
  .campos { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px 12px; }
  .campos label, .bloco { display: flex; flex-direction: column; gap: 2px; font-size: 0.78rem; color: var(--texto-2); }
  .campos label.check { flex-direction: row; align-items: center; gap: 6px; color: var(--texto); }
  .bloco { margin-top: 10px; }
  .bloco textarea { font-family: ui-monospace, monospace; font-size: 0.8rem; width: 100%; }
  .botoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .erro { color: var(--critico); min-height: 1.2em; margin: 6px 0 0; }
  .toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--texto); color: var(--superficie); padding: 10px 14px; border-radius: 8px; display: flex; gap: 12px; align-items: center; box-shadow: 0 4px 16px rgb(0 0 0 / 0.25); max-width: calc(100vw - 32px); }
  .toast button { background: none; color: inherit; border-color: currentColor; }`;
