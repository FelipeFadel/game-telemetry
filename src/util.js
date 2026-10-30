// Utilitários compartilhados pelas rotas do Worker.

export const TIPOS_VALIDOS = ["batalha", "fase", "sessao", "evento", "cliques", "teclas"];

// Libera o jogo (rodando no iframe do itch.io) a chamar /registrar. Só essa rota.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Colunas da tabela registros, na ordem do schema.
export const COLUNAS = [
  "id", "sessao", "aluno", "aluno_nome", "turma", "tipo", "fase", "acertos", "erros",
  "duracao_s", "dados", "versao", "criado_em", "cliente_em", "teste",
];

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function erro(status, msg, headers = {}) {
  return json({ ok: false, erro: msg }, status, headers);
}

export function html(texto) {
  return new Response(texto, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Basic Auth (para scripts/curl; o navegador usa /login). O usuário pode ser
// qualquer um; só a senha é conferida contra o segredo SENHA_PAINEL.
export async function autorizado(request, env) {
  const senhaCerta = env.SENHA_PAINEL;
  if (!senhaCerta) return false;

  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;

  let senha;
  try {
    const decod = atob(header.slice(6));
    senha = decod.slice(decod.indexOf(":") + 1);
  } catch {
    return false;
  }

  const a = new TextEncoder().encode(senha);
  const b = new TextEncoder().encode(senhaCerta);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export function limitar(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function limparEspacos(s) {
  return s.replace(/\s+/g, " ").trim();
}

// "  João  Pedro " -> "joao pedro"
export function normalizarNome(s) {
  return limparEspacos(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function inteiro(v) {
  return Number.isFinite(v) ? Math.round(v) : null;
}

// Nomes vêm dos alunos: sempre escapar antes de pôr no HTML.
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Escapa para CSV e impede que o Excel interprete "=..." como fórmula.
export function celulaCsv(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatarTempo(seg) {
  seg = Math.round(seg);
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

// ?testes= "0" (padrão: esconde partidas de teste), "1" (mostra tudo), "so" (só testes)
export function filtroTestes(valor, coluna = "teste") {
  if (valor === "1") return null;
  return valor === "so" ? `${coluna} = 1` : `${coluna} = 0`;
}

// Filtros comuns das páginas (?turma=&testes=&aluno=) para uma tabela com alias.
export function filtrosDaUrl(url, alias = "") {
  const p = alias ? alias + "." : "";
  const where = [];
  const binds = [];
  const turma = (url.searchParams.get("turma") || "").toUpperCase();
  const aluno = url.searchParams.get("aluno") || "";
  const testes = url.searchParams.get("testes") || "0";

  if (turma) { where.push(`${p}turma = ?`); binds.push(turma); }
  if (aluno) { where.push(`${p}aluno = ?`); binds.push(normalizarNome(aluno)); }
  const t = filtroTestes(testes, `${p}teste`);
  if (t) where.push(t);

  return { where, binds, turma, aluno, testes };
}

export const NAV = [
  ["/painel", "Resultados"],
  ["/heatmap", "Heatmap de cliques"],
  ["/teclas", "Teclas"],
  ["/dados", "Gerenciar dados"],
];

// Fontes servidas de public/fontes (Work Sans nos títulos, Open Sans no texto).
export const FONTES_CSS = `
  @font-face { font-family: "Work Sans"; font-style: normal; font-weight: 100 900; font-display: swap;
    src: url("/fontes/work-sans-latin-wght-normal.woff2") format("woff2"); }
  @font-face { font-family: "Open Sans"; font-style: normal; font-weight: 300 800; font-display: swap;
    src: url("/fontes/open-sans-latin-wght-normal.woff2") format("woff2"); }
  :root { --fonte-titulo: "Work Sans", system-ui, sans-serif; --fonte-texto: "Open Sans", system-ui, sans-serif; }
  h1, h2, h3, header strong { font-family: var(--fonte-titulo); font-weight: 800; }`;

// Página completa com o menu do painel. `corpo` já vem escapado.
export function layout(titulo, ativo, corpo, { script = "", estilo = "" } = {}) {
  const nav = NAV.map(([href, nome]) =>
    `<a href="${href}"${href === ativo ? ' class="ativo" aria-current="page"' : ""}>${nome}</a>`
  ).join("");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · Linusbae</title>
<style>${FONTES_CSS}
  :root {
    color-scheme: light;
    --fundo: #ffffff; --superficie: #ffffff; --topo: #f2f5fc; --borda: #d6ddec; --borda-forte: #7f8db0;
    --texto: #0a1a3f; --texto-2: #475577; --texto-3: #66738f;
    --acento: #0033a0; --acento-texto: #ffffff; --destaque: #ff6a00;
    --bom: #1c7a2e; --bom-texto: #1c7a2e; --critico: #c4261a; --aviso-fundo: #ffe6d2;
    --seq-100: #d9e2f4; --seq-200: #adc4e9; --seq-300: #8099d0; --seq-400: #4a6db8;
    --seq-500: #2954af; --seq-600: #0033a0; --seq-700: #001f60;
    --feita: #ffe6d2;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { font-family: var(--fonte-texto); margin: 0; background: var(--fundo); color: var(--texto); line-height: 1.4; }
  header { background: var(--topo); border-bottom: 3px solid var(--destaque); padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; }
  header strong { font-size: 1rem; margin-right: 8px; font-weight: 900; text-transform: uppercase; }
  header nav { display: flex; flex-wrap: wrap; gap: 4px; }
  header nav a { padding: 5px 12px; border-radius: 999px; text-decoration: none; color: var(--texto-2); font-weight: 600; }
  header nav a:hover { background: var(--borda); color: var(--texto); }
  header nav a.ativo { background: var(--acento); color: var(--acento-texto); font-weight: 700; }
  main { padding: 16px; max-width: 1400px; }
  h1 { font-size: 1.25rem; margin: 0 0 12px; }
  h2 { font-size: 1.05rem; margin: 24px 0 8px; }
  p { margin: 6px 0; }
  .nota { color: var(--texto-2); font-size: 0.85rem; }
  .filtros { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: end; margin: 0 0 12px; }
  .filtros label { display: flex; flex-direction: column; gap: 2px; font-size: 0.78rem; color: var(--texto-2); }
  input, select, textarea, button { font: inherit; color: inherit; }
  input, select, textarea { background: var(--superficie); border: 1px solid var(--borda-forte); border-radius: 6px; padding: 5px 8px; min-width: 0; }
  button, .botao { background: var(--superficie); border: 1px solid var(--borda-forte); border-radius: 6px; padding: 5px 12px; cursor: pointer; text-decoration: none; display: inline-block; color: var(--texto); }
  button:hover, .botao:hover { border-color: var(--texto-2); }
  .botao { border: 1.5px solid var(--acento); color: var(--acento); font-weight: 700; border-radius: 999px; }
  .botao:hover { border-color: var(--acento); background: var(--topo); }
  :focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
  button.primario { background: var(--acento); border-color: var(--acento); color: var(--acento-texto); }
  button.perigo { color: var(--critico); border-color: var(--critico); }
  button:disabled { opacity: 0.5; cursor: default; }
  .pilulas { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
  .pilulas a { padding: 4px 10px; border: 1px solid var(--borda-forte); border-radius: 999px; text-decoration: none; color: var(--texto); font-size: 0.85rem; }
  .pilulas a.ativo { background: var(--acento); color: var(--acento-texto); border-color: var(--acento); }
  .rolagem { overflow-x: auto; background: var(--superficie); border: 1px solid var(--borda); border-radius: 8px; }
  table { border-collapse: collapse; font-size: 0.85rem; width: 100%; }
  th, td { border-bottom: 1px solid var(--borda); padding: 5px 8px; text-align: left; white-space: nowrap; vertical-align: top; }
  th { background: var(--topo); position: sticky; top: 0; font-weight: 600; color: var(--texto-2); font-size: 0.78rem; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .vazio { color: var(--texto-3); }
  .cartoes { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 14px; }
  .cartao { background: var(--topo); border: 1px solid var(--borda); border-radius: 10px; padding: 10px 14px; min-width: 140px; }
  .cartao b { display: block; font-family: var(--fonte-titulo); font-weight: 900; font-size: 1.4rem; font-variant-numeric: tabular-nums; color: var(--acento); }
  .cartao span { color: var(--texto-2); font-size: 0.8rem; }
  .aviso { background: var(--aviso-fundo); border-radius: 8px; padding: 8px 12px; margin: 8px 0; font-size: 0.88rem; }
  ${estilo}
</style></head><body>
<header><strong>Shadows of Linusbae</strong><nav>${nav}</nav><form method="post" action="/sair" style="margin-left:auto"><button type="submit">Sair</button></form></header>
<main>
${corpo}
</main>
${script ? `<script>${script}</script>` : ""}
</body></html>`;
}

// Mantém os filtros atuais em links (?turma=...&testes=...).
export function linkCom(base, params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const q = u.toString();
  return q ? `${base}?${q}` : base;
}

// Seletor de turma + testes, comum às páginas de análise.
export async function cabecalhoFiltros(env, url, base) {
  const { turma, testes } = filtrosDaUrl(url);
  const t = filtroTestes(testes);
  const { results: turmas } = await env.DB.prepare(
    `SELECT turma, COUNT(DISTINCT aluno) AS alunos FROM registros
      ${t ? "WHERE " + t : ""} GROUP BY turma ORDER BY turma`
  ).all();

  const pilulas = turmas.map((x) =>
    `<a${x.turma === turma ? ' class="ativo"' : ""} href="${esc(linkCom(base, { turma: x.turma, testes: testes !== "0" ? testes : "" }))}">${esc(x.turma)} · ${x.alunos}</a>`
  ).join("");

  const opcoesTestes = [["0", "Sem partidas de teste"], ["1", "Com partidas de teste"], ["so", "Só partidas de teste"]]
    .map(([v, n]) => `<a${v === testes ? ' class="ativo"' : ""} href="${esc(linkCom(base, { turma, testes: v !== "0" ? v : "" }))}">${n}</a>`)
    .join("");

  return `<div class="pilulas" aria-label="Turma">${pilulas || '<span class="vazio">Nenhum dado ainda.</span>'}</div>
<div class="pilulas" aria-label="Partidas de teste">${opcoesTestes}</div>`;
}
