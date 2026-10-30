// Contas de usuário: cadastro, senha (PBKDF2) e sessão por cookie assinado.
//
// O cookie guarda `id.validade.assinatura` (HMAC-SHA256). O segredo é
// SEGREDO_SESSAO, ou SENHA_PAINEL se não houver. Trocar o segredo derruba
// todas as sessões abertas.

const COOKIE = "conta_sessao";
const ITERACOES = 100000; // máximo que o Workers aceita no PBKDF2
const SESSAO_S = 24 * 3600;
const MANTER_S = 30 * 24 * 3600;

const enc = new TextEncoder();
const paraHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const deHex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));

async function derivar(senha, sal, iteracoes) {
  const base = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteracoes }, base, 256);
}

async function gerarHash(senha) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACOES}$${paraHex(sal)}$${paraHex(await derivar(senha, sal, ITERACOES))}`;
}

async function conferirHash(senha, guardado) {
  const [tipo, iter, sal, hash] = guardado.split("$");
  if (tipo !== "pbkdf2" || !/^[0-9a-f]+$/.test(sal || "") || !/^[0-9a-f]{64}$/.test(hash || "")) return false;
  const calculado = await derivar(senha, deHex(sal), Number(iter));
  return crypto.subtle.timingSafeEqual(calculado, deHex(hash));
}

// Hash de uma senha qualquer: usado quando o usuário não existe, para o tempo
// de resposta não revelar quais contas existem.
const HASH_FALSO = `pbkdf2$${ITERACOES}$${"00".repeat(16)}$${"00".repeat(32)}`;

function chave(env, usos) {
  const segredo = env.SEGREDO_SESSAO || env.SENHA_PAINEL;
  return crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, usos);
}

export const temSegredo = (env) => Boolean(env.SEGREDO_SESSAO || env.SENHA_PAINEL);

// Valida e normaliza os campos do cadastro. Devolve { erro } ou { email, usuario, senha }.
export function validarCadastro(campos) {
  const email = String(campos.email || "").trim().toLowerCase();
  const usuario = String(campos.usuario || "").trim().toLowerCase();
  const senha = String(campos.senha || "");

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erro: "Informe um e-mail válido." };
  if (!/^[a-z0-9_.-]{3,30}$/.test(usuario)) {
    return { erro: "O usuário deve ter de 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado." };
  }
  if (senha.length < 8) return { erro: "A senha deve ter pelo menos 8 caracteres." };
  if (senha.length > 128) return { erro: "A senha deve ter no máximo 128 caracteres." };
  return { email, usuario, senha };
}

export async function cadastrar(env, campos) {
  const v = validarCadastro(campos);
  if (v.erro) return v;

  try {
    const r = await env.DB.prepare("INSERT INTO usuarios (email, usuario, senha_hash, criado_em) VALUES (?, ?, ?, ?)")
      .bind(v.email, v.usuario, await gerarHash(v.senha), Date.now())
      .run();
    return { id: r.meta.last_row_id };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("usuarios.email")) return { erro: "Já existe uma conta com esse e-mail.", conflito: true };
    if (msg.includes("usuarios.usuario")) return { erro: "Esse nome de usuário já está em uso.", conflito: true };
    throw err;
  }
}

// `identificador` é o e-mail ou o nome de usuário. Devolve a conta ou null.
export async function autenticar(env, identificador, senha) {
  const ident = String(identificador || "").trim().toLowerCase().slice(0, 254);
  const coluna = ident.includes("@") ? "email" : "usuario";
  const conta = await env.DB.prepare(`SELECT id, email, usuario, senha_hash FROM usuarios WHERE ${coluna} = ?`)
    .bind(ident)
    .first();

  const ok = await conferirHash(String(senha || "").slice(0, 128), conta ? conta.senha_hash : HASH_FALSO);
  return conta && ok ? { id: conta.id, email: conta.email, usuario: conta.usuario } : null;
}

export async function criarSessao(env, conta, manter) {
  const segundos = manter ? MANTER_S : SESSAO_S;
  const dados = `${conta.id}.${Math.floor(Date.now() / 1000) + segundos}`;
  const assinatura = await crypto.subtle.sign("HMAC", await chave(env, ["sign"]), enc.encode(dados));
  // Sem Max-Age o cookie some ao fechar o navegador; a validade assinada continua valendo.
  return { valor: `${dados}.${paraHex(assinatura)}`, maxAge: manter ? segundos : null };
}

export function cookieSessao(url, valor, maxAge) {
  const seguro = url.protocol === "https:" ? "; Secure" : "";
  const idade = maxAge === null ? "" : `; Max-Age=${maxAge}`;
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax${idade}${seguro}`;
}

// Conta da sessão do cookie, ou null.
export async function contaDaSessao(request, env) {
  if (!temSegredo(env)) return null;
  const cookies = request.headers.get("Cookie") || "";
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;

  const [id, exp, assinatura] = m[1].split(".");
  if (!/^\d+$/.test(id || "") || !/^\d+$/.test(exp || "") || !/^[0-9a-f]{64}$/.test(assinatura || "")) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const valida = await crypto.subtle.verify("HMAC", await chave(env, ["verify"]), deHex(assinatura), enc.encode(`${id}.${exp}`));
  if (!valida) return null;

  return env.DB.prepare("SELECT id, email, usuario FROM usuarios WHERE id = ?").bind(Number(id)).first();
}

// Quem acessa o painel pelo navegador: usuários ou e-mails listados em ADMINS (separados por vírgula).
export function ehAdmin(conta, env) {
  const lista = String(env.ADMINS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return Boolean(conta) && (lista.includes(conta.usuario) || lista.includes(conta.email));
}
