// Login do painel: página com senha, cookie de sessão assinado e saída.
//
// O cookie guarda só a data de validade assinada (HMAC) com a própria
// SENHA_PAINEL. Trocar a senha derruba todas as sessões abertas.

import { esc, html } from "./util.js";

const COOKIE = "painel_sessao";
const VALIDADE_S = 7 * 24 * 3600;

const enc = new TextEncoder();

function chave(env, usos) {
  return crypto.subtle.importKey("raw", enc.encode(env.SENHA_PAINEL), { name: "HMAC", hash: "SHA-256" }, false, usos);
}

const paraHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const deHex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));

async function criarToken(env) {
  const exp = String(Math.floor(Date.now() / 1000) + VALIDADE_S);
  const assinatura = await crypto.subtle.sign("HMAC", await chave(env, ["sign"]), enc.encode(exp));
  return `${exp}.${paraHex(assinatura)}`;
}

export async function sessaoValida(request, env) {
  if (!env.SENHA_PAINEL) return false;
  const cookies = request.headers.get("Cookie") || "";
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;

  const [exp, assinatura] = m[1].split(".");
  if (!/^\d+$/.test(exp || "") || !/^[0-9a-f]{64}$/.test(assinatura || "")) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return crypto.subtle.verify("HMAC", await chave(env, ["verify"]), deHex(assinatura), enc.encode(exp));
}

export async function senhaCorreta(env, senha) {
  if (!env.SENHA_PAINEL) return false;
  const a = enc.encode(senha);
  const b = enc.encode(env.SENHA_PAINEL);
  // timingSafeEqual exige o mesmo tamanho; comparar os hashes resolve isso.
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", a), crypto.subtle.digest("SHA-256", b)]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// Só aceita caminhos do próprio painel, para o login não virar redirecionador aberto.
function destinoSeguro(v) {
  return typeof v === "string" && /^\/[A-Za-z0-9_\-/]*(\?[^\s]*)?$/.test(v) && !v.startsWith("//") ? v : "/painel";
}

function cookie(url, valor, maxAge) {
  const seguro = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${seguro}`;
}

export function paraLogin(url) {
  const voltar = url.pathname + url.search;
  const destino = voltar === "/" ? "/login" : `/login?voltar=${encodeURIComponent(voltar)}`;
  return new Response(null, { status: 302, headers: { Location: destino, "Cache-Control": "no-store" } });
}

export async function login(request, env, url) {
  if (request.method === "GET") {
    if (await sessaoValida(request, env)) {
      return Response.redirect(url.origin + destinoSeguro(url.searchParams.get("voltar")), 302);
    }
    return paginaLogin(url.searchParams.get("voltar"), "");
  }

  if (request.headers.get("Origin") !== url.origin) return new Response("Origem não permitida", { status: 403 });

  const form = await request.formData();
  const voltar = String(form.get("voltar") || "");

  if (!env.SENHA_PAINEL) return paginaLogin(voltar, "O painel está sem senha configurada.", 503);

  if (!(await senhaCorreta(env, String(form.get("senha") || "")))) {
    await new Promise((r) => setTimeout(r, 800)); // freia tentativa em massa
    return paginaLogin(voltar, "Senha incorreta.", 401);
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: destinoSeguro(voltar),
      "Set-Cookie": cookie(url, await criarToken(env), VALIDADE_S),
      "Cache-Control": "no-store",
    },
  });
}

export function sair(url) {
  return new Response(null, {
    status: 303,
    headers: { Location: "/login", "Set-Cookie": cookie(url, "", 0), "Cache-Control": "no-store" },
  });
}

function paginaLogin(voltar, mensagem, status = 200) {
  const resp = html(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Entrar · Linusbae</title>
<style>
  :root {
    color-scheme: light dark;
    --fundo: #f6f6f4; --superficie: #fcfcfb; --borda: #dcdbd6; --borda-forte: #b9b8b1;
    --texto: #0b0b0b; --texto-2: #52514e; --acento: #2a78d6; --critico: #c42f2f; --erro-fundo: #fde8e8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fundo: #121211; --superficie: #1a1a19; --borda: #33332f; --borda-forte: #4a4a45;
      --texto: #f0efec; --texto-2: #c3c2b7; --acento: #3987e5; --critico: #ff8a8a; --erro-fundo: #3a1a1a;
    }
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center;
         padding: 16px; background: var(--fundo); color: var(--texto); line-height: 1.4; }
  form { width: 100%; max-width: 360px; background: var(--superficie); border: 1px solid var(--borda);
         border-radius: 12px; padding: 28px 24px; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  p { margin: 0 0 20px; color: var(--texto-2); font-size: 0.9rem; }
  label { display: block; font-size: 0.85rem; margin-bottom: 6px; color: var(--texto-2); }
  .campo { display: flex; gap: 6px; }
  input { font: inherit; color: inherit; flex: 1; min-width: 0; padding: 9px 10px; border-radius: 8px;
          background: var(--fundo); border: 1px solid var(--borda-forte); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--acento); outline-offset: 1px; }
  button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--borda-forte);
           background: var(--superficie); color: var(--texto); padding: 0 12px; }
  button.entrar { width: 100%; margin-top: 16px; padding: 10px; background: var(--acento); border-color: var(--acento); color: #fff; font-weight: 600; }
  .erro { background: var(--erro-fundo); color: var(--critico); border-radius: 8px; padding: 8px 12px;
          margin: 0 0 16px; font-size: 0.88rem; }
</style></head><body>
<form method="post" action="/login">
  <h1>Shadows of Linusbae</h1>
  <p>Painel de telemetria</p>
  ${mensagem ? `<div class="erro" role="alert">${esc(mensagem)}</div>` : ""}
  <input type="hidden" name="voltar" value="${esc(voltar || "")}">
  <label for="senha">Senha</label>
  <div class="campo">
    <input id="senha" name="senha" type="password" autocomplete="current-password" required autofocus>
    <button type="button" id="ver" aria-pressed="false">Mostrar</button>
  </div>
  <button class="entrar" type="submit">Entrar</button>
</form>
<script>
  const campo = document.getElementById("senha"), ver = document.getElementById("ver");
  ver.addEventListener("click", () => {
    const mostrar = campo.type === "password";
    campo.type = mostrar ? "text" : "password";
    ver.textContent = mostrar ? "Ocultar" : "Mostrar";
    ver.setAttribute("aria-pressed", mostrar);
  });
</script>
</body></html>`);
  return new Response(resp.body, { status, headers: { "Content-Type": resp.headers.get("Content-Type"), "Cache-Control": "no-store" } });
}
