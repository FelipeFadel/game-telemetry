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

// Página completa com o menu do painel. `corpo` já vem escapado.
export function layout(titulo, ativo, corpo, { script = "", estilo = "" } = {}) {
  const nav = NAV.map(([href, nome]) =>
    `<a href="${href}"${href === ativo ? ' class="ativo" aria-current="page"' : ""}>${nome}</a>`
  ).join("");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · Linusbae</title>
<style>
  :root {
    color-scheme: light;
    --fundo: #f6f6f4; --superficie: #fcfcfb; --borda: #dcdbd6; --borda-forte: #b9b8b1;
    --texto: #0b0b0b; --texto-2: #52514e; --texto-3: #7a7974;
    --acento: #2a78d6; --acento-texto: #ffffff;
    --bom: #0ca30c; --bom-texto: #0a7a0a; --critico: #d03b3b; --aviso-fundo: #fff4d6;
    --seq-100: #cde2fb; --seq-200: #9ec5f4; --seq-300: #6da7ec; --seq-400: #3987e5;
    --seq-500: #256abf; --seq-600: #184f95; --seq-700: #0d366b;
    --feita: #e7f4e7;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --fundo: #121211; --superficie: #1a1a19; --borda: #33332f; --borda-forte: #4a4a45;
      --texto: #f0efec; --texto-2: #c3c2b7; --texto-3: #8f8e86;
      --acento: #3987e5; --acento-texto: #ffffff;
      --bom-texto: #4cc84c; --aviso-fundo: #3a3112;
      --feita: #1d321d;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --fundo: #121211; --superficie: #1a1a19; --borda: #33332f; --borda-forte: #4a4a45;
    --texto: #f0efec; --texto-2: #c3c2b7; --texto-3: #8f8e86;
    --acento: #3987e5; --acento-texto: #ffffff;
    --bom-texto: #4cc84c; --aviso-fundo: #3a3112;
    --feita: #1d321d;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { font-family: system-ui, sans-serif; margin: 0; background: var(--fundo); color: var(--texto); line-height: 1.4; }
  header { background: var(--superficie); border-bottom: 1px solid var(--borda); padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; }
  header strong { font-size: 1rem; margin-right: 8px; }
  header nav { display: flex; flex-wrap: wrap; gap: 4px; }
  header nav a { padding: 5px 10px; border-radius: 6px; text-decoration: none; color: var(--texto-2); }
  header nav a:hover { background: var(--fundo); color: var(--texto); }
  header nav a.ativo { background: var(--texto); color: var(--superficie); }
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
  button.primario { background: var(--acento); border-color: var(--acento); color: var(--acento-texto); }
  button.perigo { color: var(--critico); border-color: var(--critico); }
  button:disabled { opacity: 0.5; cursor: default; }
  .pilulas { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
  .pilulas a { padding: 4px 10px; border: 1px solid var(--borda-forte); border-radius: 999px; text-decoration: none; color: var(--texto); font-size: 0.85rem; }
  .pilulas a.ativo { background: var(--texto); color: var(--superficie); border-color: var(--texto); }
  .rolagem { overflow-x: auto; background: var(--superficie); border: 1px solid var(--borda); border-radius: 8px; }
  table { border-collapse: collapse; font-size: 0.85rem; width: 100%; }
  th, td { border-bottom: 1px solid var(--borda); padding: 5px 8px; text-align: left; white-space: nowrap; vertical-align: top; }
  th { background: var(--fundo); position: sticky; top: 0; font-weight: 600; color: var(--texto-2); font-size: 0.78rem; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .vazio { color: var(--texto-3); }
  .cartoes { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 14px; }
  .cartao { background: var(--superficie); border: 1px solid var(--borda); border-radius: 8px; padding: 10px 14px; min-width: 140px; }
  .cartao b { display: block; font-size: 1.4rem; font-variant-numeric: tabular-nums; }
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
