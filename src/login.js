// Telas e rotas de entrada: /login, /cadastro, /conta e /sair.
// A lógica de contas e sessão fica em contas.js.

import { autenticar, cadastrar, contaDaSessao, cookieSessao, criarSessao, ehAdmin, temSegredo } from "./contas.js";
import { esc, html } from "./util.js";

// Só aceita caminhos do próprio site, para o login não virar redirecionador aberto.
function destinoSeguro(v, padrao) {
  return typeof v === "string" && /^\/[A-Za-z0-9_\-/]*(\?[^\s]*)?$/.test(v) && !v.startsWith("//") ? v : padrao;
}

const SEM_CACHE = { "Cache-Control": "no-store" };

export function paraLogin(url) {
  const voltar = url.pathname + url.search;
  const destino = voltar === "/" ? "/login" : `/login?voltar=${encodeURIComponent(voltar)}`;
  return new Response(null, { status: 302, headers: { Location: destino, ...SEM_CACHE } });
}

function entrou(url, destino, cookie) {
  return new Response(null, { status: 303, headers: { Location: destino, "Set-Cookie": cookie, ...SEM_CACHE } });
}

async function aposEntrar(env, url, conta, manter, voltar) {
  const { valor, maxAge } = await criarSessao(env, conta, manter);
  const padrao = ehAdmin(conta, env) ? "/painel" : "/conta";
  return entrou(url, destinoSeguro(voltar, padrao), cookieSessao(url, valor, maxAge));
}

export async function login(request, env, url) {
  if (request.method === "GET") {
    if (await contaDaSessao(request, env)) {
      return Response.redirect(url.origin + destinoSeguro(url.searchParams.get("voltar"), "/conta"), 302);
    }
    return paginaLogin({ voltar: url.searchParams.get("voltar") });
  }

  if (request.headers.get("Origin") !== url.origin) return new Response("Origem não permitida", { status: 403 });

  const form = await request.formData();
  const campos = { voltar: String(form.get("voltar") || ""), identificador: String(form.get("identificador") || "") };

  if (!temSegredo(env)) return paginaLogin({ ...campos, mensagem: "O servidor está sem segredo de sessão configurado." }, 503);

  const conta = await autenticar(env, campos.identificador, String(form.get("senha") || ""));
  if (!conta) {
    await new Promise((r) => setTimeout(r, 500)); // freia tentativa em massa
    return paginaLogin({ ...campos, mensagem: "E-mail, usuário ou senha incorretos." }, 401);
  }
  return aposEntrar(env, url, conta, form.get("manter") === "on", campos.voltar);
}

export async function cadastro(request, env, url) {
  if (request.method === "GET") {
    if (await contaDaSessao(request, env)) return Response.redirect(url.origin + "/conta", 302);
    return paginaCadastro({});
  }

  if (request.headers.get("Origin") !== url.origin) return new Response("Origem não permitida", { status: 403 });

  const form = await request.formData();
  const campos = {
    email: String(form.get("email") || ""),
    usuario: String(form.get("usuario") || ""),
  };

  if (!temSegredo(env)) return paginaCadastro({ ...campos, mensagem: "O servidor está sem segredo de sessão configurado." }, 503);

  const r = await cadastrar(env, { ...campos, senha: String(form.get("senha") || "") });
  if (r.erro) return paginaCadastro({ ...campos, mensagem: r.erro }, r.conflito ? 409 : 400);

  const conta = { id: r.id, email: campos.email.trim().toLowerCase(), usuario: campos.usuario.trim().toLowerCase() };
  return aposEntrar(env, url, conta, false, "");
}

export async function paginaConta(request, env, url) {
  const conta = await contaDaSessao(request, env);
  if (!conta) return paraLogin(url);

  const painel = ehAdmin(conta, env) ? `<p class="sub"><a href="/painel">Abrir o painel de telemetria</a></p>` : "";
  return semCache(html(moldura("Minha conta", `
<header>
  <h1>Olá,<br>${esc(conta.usuario)}</h1>
  <p class="sub">${esc(conta.email)}</p>
</header>
${painel}
<form method="post" action="/sair"><button type="submit" class="principal">Sair</button></form>`)));
}

export function sair(url) {
  return new Response(null, {
    status: 303,
    headers: { Location: "/login", "Set-Cookie": cookieSessao(url, "", 0), ...SEM_CACHE },
  });
}

const semCache = (resp, status = 200) =>
  new Response(resp.body, { status, headers: { "Content-Type": resp.headers.get("Content-Type"), ...SEM_CACHE } });

function aviso(mensagem) {
  return mensagem ? `<div class="erro" role="alert">${esc(mensagem)}</div>` : "";
}

// Campo de senha com o botão Mostrar/Ocultar.
function campoSenha(autocomplete, extra = "") {
  return `<div class="senha">
      <input id="senha" name="senha" type="password" autocomplete="${autocomplete}" required ${extra}>
      <button type="button" id="ver" aria-pressed="false">Mostrar</button>
    </div>`;
}

function paginaLogin({ voltar = "", identificador = "", mensagem = "" }, status = 200) {
  return semCache(html(moldura("Entrar", `
<header>
  <h1>Bem-<br>vindo</h1>
  <p class="sub">Entre com seu e-mail ou nome de usuário para continuar.</p>
</header>
<form method="post" action="/login">
  ${aviso(mensagem)}
  <input type="hidden" name="voltar" value="${esc(voltar || "")}">
  <div class="campo">
    <label for="identificador">E-mail ou usuário</label>
    <input id="identificador" name="identificador" type="text" autocomplete="username" placeholder="voce@exemplo.com"
      value="${esc(identificador)}" required autofocus>
  </div>
  <div class="campo">
    <label for="senha">Senha</label>
    ${campoSenha("current-password")}
  </div>
  <label class="manter"><input type="checkbox" name="manter"> Manter conectado</label>
  <button type="submit" class="principal">Entrar</button>
</form>
<p class="rodape">Não tem uma conta? <a href="/cadastro">Criar conta</a></p>`)), status);
}

function paginaCadastro({ email = "", usuario = "", mensagem = "" }, status = 200) {
  return semCache(html(moldura("Criar conta", `
<header>
  <h1>Criar<br>conta</h1>
  <p class="sub">Escolha um nome de usuário e uma senha para começar.</p>
</header>
<form method="post" action="/cadastro">
  ${aviso(mensagem)}
  <div class="campo">
    <label for="email">E-mail</label>
    <input id="email" name="email" type="email" autocomplete="email" placeholder="voce@exemplo.com"
      value="${esc(email)}" maxlength="254" required autofocus>
  </div>
  <div class="campo">
    <label for="usuario">Usuário</label>
    <input id="usuario" name="usuario" type="text" autocomplete="username" placeholder="seu.usuario"
      value="${esc(usuario)}" minlength="3" maxlength="30" pattern="[A-Za-z0-9_.-]{3,30}" required>
  </div>
  <div class="campo">
    <label for="senha">Senha</label>
    ${campoSenha("new-password", 'minlength="8" maxlength="128"')}
  </div>
  <button type="submit" class="principal">Criar conta</button>
</form>
<p class="rodape">Já tem uma conta? <a href="/login">Entrar</a></p>`)), status);
}

// Página dividida do design: formulário à esquerda, jogos à direita.
function moldura(titulo, conteudo) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)} · Linusbae</title>
<style>
  @font-face { font-family: "Archivo"; font-style: normal; font-weight: 400 800; font-display: swap;
    src: url("/fontes/archivo-latin-wght-normal.woff2") format("woff2"); }
  :root { color-scheme: light; --acento: #5b3fd9; --acento-forte: #3f27a8; --tinta: #1e1b18; --tinta-2: #4a463f; --tinta-3: #2e2a25; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f3ef; }
  a { color: var(--acento); } a:hover { color: var(--acento-forte); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--acento); outline-offset: 1px; }

  .tela { min-height: 100vh; background: #f4f3ef; font-family: Archivo, system-ui, sans-serif; color: var(--tinta);
          padding: 24px; display: flex; flex-wrap: wrap; gap: 24px; align-items: stretch; }
  main { flex: 1 1 420px; min-width: 0; display: flex; align-items: center; justify-content: center; padding: 32px 16px; }
  .miolo { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 36px; }
  header { display: flex; flex-direction: column; gap: 14px; }
  h1 { margin: 0; font-weight: 800; font-size: 64px; line-height: 0.95; letter-spacing: -2px; text-transform: uppercase; overflow-wrap: anywhere; }
  .sub { margin: 0; font-size: 17px; line-height: 1.5; color: var(--tinta-2); }
  form { display: flex; flex-direction: column; gap: 20px; }
  .campo { display: flex; flex-direction: column; gap: 8px; }
  label { font-size: 13px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: var(--tinta-3); }
  input[type=text], input[type=email], input[type=password] {
    width: 100%; height: 54px; padding: 0 18px; border: 1px solid #85817a; border-radius: 14px;
    background: #fff; font: inherit; font-size: 16px; color: var(--tinta); }
  .senha { position: relative; display: flex; }
  .senha input { flex: 1; min-width: 0; padding-right: 96px; }
  .senha button { position: absolute; right: 5px; top: 5px; height: 44px; padding: 0 14px; border: 0; border-radius: 10px;
    background: transparent; font: inherit; font-size: 14px; font-weight: 600; color: var(--tinta); cursor: pointer; }
  label.manter { display: flex; align-items: center; gap: 12px; min-height: 44px; font-size: 15px; font-weight: 400;
    letter-spacing: 0; text-transform: none; color: var(--tinta-3); cursor: pointer; }
  .manter input { width: 20px; height: 20px; margin: 0; accent-color: var(--acento); }
  .principal { height: 56px; border: 0; border-radius: 28px; background: var(--tinta); color: #fff; font: inherit;
    font-size: 15px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; }
  .rodape { margin: 0; font-size: 15px; color: var(--tinta-2); text-align: center; }
  .rodape a { font-weight: 600; }
  .erro { padding: 12px 16px; border-radius: 14px; background: #fde7e4; color: #b3261e; font-size: 15px; line-height: 1.4; }

  aside { flex: 1 1 480px; min-width: 0; min-height: 600px; border-radius: 28px; overflow: hidden; position: relative;
    background-color: #e9e7e2; background-image: linear-gradient(rgba(30,27,24,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(30,27,24,0.05) 1px, transparent 1px);
    background-size: 48px 48px; }
  .jogos { position: absolute; left: 32px; top: 32px; z-index: 5; display: flex; flex-direction: column; gap: 10px; }
  .jogos span { font-size: 12px; font-weight: 600; letter-spacing: 1.4px; text-transform: uppercase; color: var(--tinta-2); }
  .jogos ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 15px; font-weight: 500; }
  .cd { position: absolute; aspect-ratio: 1; border-radius: 50%;
    -webkit-mask: radial-gradient(circle closest-side, transparent 13%, #000 13.5%); mask: radial-gradient(circle closest-side, transparent 13%, #000 13.5%); }
  .cd-linus, .cd-deuses, .cd-math {
    --disco: radial-gradient(circle closest-side, transparent 13%, #cfcbc4 13.5%, #cfcbc4 17%, rgba(255,255,255,0.75) 17.5%, rgba(255,255,255,0.75) 30%, #d8d4cd 30.5%, #d8d4cd 32%, transparent 32.5%, transparent 96%, rgba(30,27,24,0.22) 97.5%, transparent 99.5%);
    --brilho: linear-gradient(118deg, rgba(255,255,255,0) 36%, rgba(255,255,255,0.20) 47%, rgba(255,255,255,0) 58%); }
  .cd-linus { left: 22%; top: 14%; width: 70%; z-index: 1; transform: rotate(-28deg) scaleY(0.6);
    background: var(--disco), var(--brilho), url(/img/linusbae.jpg) 72% 40%/cover no-repeat; }
  .cd-deuses { left: 38%; top: 48%; width: 58%; z-index: 2; transform: rotate(-16deg) scaleY(0.6);
    background: var(--disco), var(--brilho), url(/img/deuses.jpg) 32% 45%/cover no-repeat; }
  .cd-math { left: 2%; top: 56%; width: 50%; z-index: 3; transform: rotate(-36deg) scaleY(0.6);
    background: var(--disco), radial-gradient(circle closest-side, transparent 40%, rgba(255,255,255,0.45) 62%, transparent 80%),
      conic-gradient(from 270deg, #fff6f0, #ffb98a 8%, #fff0f6 15%, #ff9fd0 23%, #e9e3ff 31%, #8fb6ff 40%, #f0fbff 48%, #9eebd2 56%, #fff8e0 64%, #ffd27a 72%, #fff6f0 80%, #c4a6ff 89%, #fff6f0); }
  .num { position: absolute; z-index: 4; font-size: 12px; font-weight: 600; letter-spacing: 1px; padding: 6px 10px; border-radius: 20px; background: #fff; }
  .brilho { position: absolute; z-index: 4; fill: var(--tinta); }
  .grao { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 6; pointer-events: none; opacity: 0.22; mix-blend-mode: multiply; }

  @media (max-width: 480px) { .tela { padding: 12px; } h1 { font-size: 52px; } }
</style></head><body>
<div class="tela">
<main><div class="miolo">
${conteudo}
</div></main>

<aside aria-label="Nossos jogos">
  <div class="jogos">
    <span>Nossos jogos</span>
    <ol><li>01 — Shadows of Linusbae</li><li>02 — Desafio Dos Deuses</li><li>03 — InterstelarMath</li></ol>
  </div>
  <div class="cd cd-linus" aria-hidden="true"></div>
  <div class="cd cd-deuses" aria-hidden="true"></div>
  <div class="cd cd-math" aria-hidden="true"></div>
  <span class="num" style="right:8%;top:22%" aria-hidden="true">01</span>
  <span class="num" style="right:6%;top:70%" aria-hidden="true">02</span>
  <span class="num" style="left:6%;bottom:8%" aria-hidden="true">03</span>
  <svg class="brilho" style="left:58%;top:12%;width:34px;height:34px" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C13 9 15 11 24 12C15 13 13 15 12 24C11 15 9 13 0 12C9 11 11 9 12 0Z"/></svg>
  <svg class="brilho" style="left:66%;top:19%;width:16px;height:16px" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C13 9 15 11 24 12C15 13 13 15 12 24C11 15 9 13 0 12C9 11 11 9 12 0Z"/></svg>
  <svg class="brilho" style="left:44%;top:60%;width:20px;height:20px" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C13 9 15 11 24 12C15 13 13 15 12 24C11 15 9 13 0 12C9 11 11 9 12 0Z"/></svg>
  <svg class="grao" aria-hidden="true">
    <filter id="grao-login"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    <rect width="100%" height="100%" filter="url(#grao-login)"/>
  </svg>
</aside>
</div>
<script>
  const campo = document.getElementById("senha"), ver = document.getElementById("ver");
  if (campo && ver) ver.addEventListener("click", () => {
    const mostrar = campo.type === "password";
    campo.type = mostrar ? "text" : "password";
    ver.textContent = mostrar ? "Ocultar" : "Mostrar";
    ver.setAttribute("aria-pressed", mostrar);
  });
</script>
</body></html>`;
}
