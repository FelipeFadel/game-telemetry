// GET /teclas — como os jogadores usam o teclado.
//
// Cada tecla vem do jogo com o "modo" do momento (menu, exploracao, inventario,
// dialogo, batalha, console). FUNCOES diz o que cada tecla faz em cada modo,
// conforme os scripts do jogo; tecla fora da lista = "sem função" naquele modo.
// Ao mudar os controles no Unity, atualize aqui.

import { cabecalhoFiltros, esc, filtrosDaUrl, formatarTempo, html, layout } from "./util.js";

const MOVIMENTO = ["W", "A", "S", "D", "UpArrow", "DownArrow", "LeftArrow", "RightArrow"];
const comFuncao = (teclas, funcao) => Object.fromEntries(teclas.map((k) => [k, funcao]));

const FUNCOES = {
  // EventSystem do Unity: setas/WASD navegam, Enter/Espaço confirmam.
  menu: { ...comFuncao(MOVIMENTO, "navegar nos botões"), Return: "confirmar", KeypadEnter: "confirmar", Space: "confirmar", Escape: "cancelar" },
  exploracao: { ...comFuncao(MOVIMENTO, "andar"), Tab: "abrir inventário" },
  inventario: { ...comFuncao(["W", "A", "S", "D"], "mover cursor"), Tab: "fechar inventário", Q: "aba anterior", E: "próxima aba", F: "usar item" },
  batalha: { ...comFuncao(["W", "A", "S", "D"], "mover cursor"), Return: "usar item", E: "usar item" },
};
const GLOBAIS = { F12: "mostrar console" };

function funcao(modo, k) {
  if (modo === "dialogo") return "avançar diálogo"; // qualquer tecla avança
  if (modo === "console") return "console";
  return GLOBAIS[k] || FUNCOES[modo]?.[k] || null;
}

const MODOS = ["menu", "exploracao", "inventario", "dialogo", "batalha"];
const NOME_MODO = { menu: "Menu", exploracao: "Exploração", inventario: "Inventário", dialogo: "Diálogo", batalha: "Batalha", console: "Console" };

const ITENS = `FROM registros r, json_each(r.dados, '$.itens') j`;

export async function paginaTeclas(url, env) {
  const filtros = await cabecalhoFiltros(env, url, "/teclas");
  const f = filtrosDaUrl(url, "r");
  if (!f.turma) {
    return html(layout("Teclas", "/teclas", `<h1>Teclas</h1>${filtros}<p class="nota">Escolha uma turma acima.</p>`));
  }

  const cond = (tipo) => [`r.tipo = '${tipo}'`, ...f.where].join(" AND ");
  const [porAlunoTecla, cliquesPorAluno, porFase] = await env.DB.batch([
    env.DB.prepare(
      `SELECT r.aluno, MAX(r.aluno_nome) AS nome, json_extract(j.value, '$.modo') AS modo,
              json_extract(j.value, '$.k') AS k, COUNT(*) AS n, AVG(json_extract(j.value, '$.d')) AS d,
              MIN(CASE WHEN json_extract(j.value, '$.ts') >= 0 THEN json_extract(j.value, '$.ts') END) AS primeiro
         ${ITENS} WHERE ${cond("teclas")} GROUP BY r.aluno, modo, k`
    ).bind(...f.binds),
    env.DB.prepare(
      `SELECT r.aluno, MAX(r.aluno_nome) AS nome, COUNT(*) AS n ${ITENS} WHERE ${cond("cliques")} GROUP BY r.aluno`
    ).bind(...f.binds),
    env.DB.prepare(
      `SELECT r.fase, json_extract(j.value, '$.modo') AS modo, json_extract(j.value, '$.k') AS k, COUNT(*) AS n
         ${ITENS} WHERE ${cond("teclas")} GROUP BY 1, 2, 3`
    ).bind(...f.binds),
  ]).then((rs) => rs.map((r) => r.results));

  if (porAlunoTecla.length === 0) {
    return html(layout("Teclas", "/teclas", `<h1>Teclas</h1>${filtros}<p class="nota">Ainda não há teclas registradas para este filtro.</p>`));
  }

  const corpo = `<h1>Teclas</h1>${filtros}
${cartoes(porAlunoTecla, cliquesPorAluno)}
<h2>Resumo por aluno</h2>
<p class="nota">Tempos contados desde o login, na sessão mais rápida. "Sem função" = tecla que não faz nada no modo em que foi apertada.</p>
${tabelaAlunos(porAlunoTecla, cliquesPorAluno)}
<h2>Teclas por modo do jogo</h2>
<p class="nota">Cor mais escura = mais usada. ⚠ = não faz nada naquele modo. Passe o mouse para ver a função e quantos alunos usaram.</p>
${matrizModos(porAlunoTecla)}
<h2>Por fase</h2>
${tabelaFases(porFase)}`;

  return html(layout("Teclas", "/teclas", corpo, { estilo: ESTILO }));
}

function cartoes(linhas, cliques) {
  const total = soma(linhas);
  const sem = soma(linhas.filter((l) => !funcao(l.modo, l.k)));
  const totalCliques = soma(cliques);
  const alunos = new Set(linhas.map((l) => l.aluno)).size;
  return `<div class="cartoes">
  <div class="cartao"><b>${alunos}</b><span>alunos com teclas</span></div>
  <div class="cartao"><b>${total.toLocaleString("pt-BR")}</b><span>teclas apertadas</span></div>
  <div class="cartao"><b>${pct(sem, total)}</b><span>sem função</span></div>
  <div class="cartao"><b>${pct(totalCliques, total + totalCliques)}</b><span>das ações foram cliques</span></div>
</div>`;
}

function tabelaAlunos(linhas, cliques) {
  const alunos = new Map();
  for (const l of linhas) {
    if (!alunos.has(l.aluno)) alunos.set(l.aluno, { nome: l.nome, linhas: [] });
    alunos.get(l.aluno).linhas.push(l);
  }
  const cliquesDe = new Map(cliques.map((c) => [c.aluno, c.n]));

  // Menor "primeiro uso" entre as linhas que batem com o teste.
  const primeiro = (ls, teste) => {
    const ts = ls.filter(teste).map((l) => l.primeiro).filter((t) => t !== null);
    return ts.length ? formatarTempo(Math.min(...ts)) : '<span class="vazio">nunca</span>';
  };

  const linhasHtml = [...alunos.entries()]
    .sort((a, b) => a[1].nome.localeCompare(b[1].nome, "pt-BR"))
    .map(([aluno, a]) => {
      const total = soma(a.linhas);
      const semFuncao = a.linhas.filter((l) => !funcao(l.modo, l.k));
      const topSem = agrupar(semFuncao, (l) => l.k).slice(0, 3).map(([k, n]) => `${esc(k)} (${n})`).join(", ");
      const usouInventario = a.linhas.some((l) => l.modo === "inventario" && ["Q", "E", "F"].includes(l.k));
      return `<tr>
        <td><b>${esc(a.nome)}</b></td>
        <td class="num">${total}</td>
        <td class="num">${cliquesDe.get(aluno) || 0}</td>
        <td class="num">${pct(soma(semFuncao), total)}</td>
        <td class="num">${primeiro(a.linhas, (l) => l.modo === "exploracao" && MOVIMENTO.includes(l.k))}</td>
        <td class="num">${primeiro(a.linhas, (l) => l.modo === "exploracao" && l.k === "Tab")}</td>
        <td>${usouInventario ? "✓ sim" : '<span class="vazio">não</span>'}</td>
        <td>${topSem || '<span class="vazio">—</span>'}</td>
      </tr>`;
    }).join("");

  return `<div class="rolagem"><table>
<thead><tr><th>Aluno</th><th class="num">Teclas</th><th class="num">Cliques</th><th class="num">Sem função</th>
<th class="num">1º movimento</th><th class="num">1º Tab (inventário)</th><th>Usou Q/E/F no inventário</th><th>Mais apertadas sem função</th></tr></thead>
<tbody>${linhasHtml}</tbody></table></div>`;
}

function matrizModos(linhas) {
  // tecla -> modo -> { n, alunos:Set, d }
  const mapa = new Map();
  for (const l of linhas) {
    if (!mapa.has(l.k)) mapa.set(l.k, {});
    const c = (mapa.get(l.k)[l.modo] ||= { n: 0, alunos: new Set(), dSoma: 0 });
    c.n += l.n;
    c.alunos.add(l.aluno);
    c.dSoma += (l.d || 0) * l.n;
  }
  const modos = MODOS.filter((m) => linhas.some((l) => l.modo === m));
  if (linhas.some((l) => l.modo === "console")) modos.push("console");

  const teclas = [...mapa.entries()]
    .map(([k, porModo]) => [k, porModo, Object.values(porModo).reduce((s, c) => s + c.n, 0)])
    .sort((a, b) => b[2] - a[2])
    .slice(0, 40);
  const maior = Math.max(...teclas.flatMap(([, pm]) => Object.values(pm).map((c) => c.n)), 1);

  const corpo = teclas.map(([k, porModo, total]) => `<tr><th scope="row">${esc(k)}</th>${modos.map((m) => {
    const c = porModo[m];
    if (!c) return '<td class="num vazio">·</td>';
    const fn = funcao(m, k);
    const nivel = Math.min(6, Math.max(1, Math.ceil((c.n / maior) * 6)));
    const dica = `${k} em ${NOME_MODO[m]}: ${fn || "sem função"} · ${c.n} vezes por ${c.alunos.size} aluno(s) · segurada em média ${(c.dSoma / c.n).toFixed(2)} s`;
    return `<td class="num nivel${nivel}${fn ? "" : " semfuncao"}" title="${esc(dica)}">${fn ? "" : "⚠ "}${c.n}</td>`;
  }).join("")}<td class="num">${total}</td></tr>`).join("");

  return `<div class="rolagem"><table class="matriz">
<thead><tr><th>Tecla</th>${modos.map((m) => `<th class="num">${NOME_MODO[m]}</th>`).join("")}<th class="num">Total</th></tr></thead>
<tbody>${corpo}</tbody></table></div>`;
}

function tabelaFases(linhas) {
  const fases = new Map();
  for (const l of linhas) {
    const fase = l.fase || "(menu)";
    const f = fases.get(fase) || { total: 0, sem: 0, porModo: {} };
    f.total += l.n;
    if (!funcao(l.modo, l.k)) f.sem += l.n;
    f.porModo[l.modo] = (f.porModo[l.modo] || 0) + l.n;
    fases.set(fase, f);
  }
  const linhasHtml = [...fases.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([fase, f]) => `<tr>
    <td>${esc(fase)}</td><td class="num">${f.total}</td><td class="num">${pct(f.sem, f.total)}</td>
    <td>${Object.entries(f.porModo).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${NOME_MODO[m] || esc(m)} ${pct(n, f.total)}`).join(" · ")}</td></tr>`).join("");
  return `<div class="rolagem"><table><thead><tr><th>Fase</th><th class="num">Teclas</th><th class="num">Sem função</th><th>Teclas em cada modo</th></tr></thead>
<tbody>${linhasHtml}</tbody></table></div>`;
}

const soma = (ls) => ls.reduce((s, l) => s + l.n, 0);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const agrupar = (ls, chave) => {
  const m = new Map();
  for (const l of ls) m.set(chave(l), (m.get(chave(l)) || 0) + l.n);
  return [...m].sort((a, b) => b[1] - a[1]);
};

const ESTILO = `
  .matriz td.num { min-width: 64px; }
  .matriz th[scope="row"] { position: static; background: none; color: var(--texto); font-family: ui-monospace, monospace; }
  .nivel1 { background: var(--seq-100); color: #0b0b0b; }
  .nivel2 { background: var(--seq-200); color: #0b0b0b; }
  .nivel3 { background: var(--seq-300); color: #0b0b0b; }
  .nivel4 { background: var(--seq-400); color: #ffffff; }
  .nivel5 { background: var(--seq-500); color: #ffffff; }
  .nivel6 { background: var(--seq-600); color: #ffffff; }
  .matriz td { border: 2px solid var(--superficie); }
  td.semfuncao { outline: 2px dashed var(--critico); outline-offset: -3px; font-weight: 600; }`;
