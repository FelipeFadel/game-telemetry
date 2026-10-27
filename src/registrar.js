// POST /registrar — o jogo envia resumos (público, sem senha).
//
// Corpo esperado:
// {
//   "sessao": "uuid", "aluno": "Maria", "turma": "7A" (opcional), "versao": "0.7",
//   "teste": false (opcional; true = partida no Editor),
//   "registros": [
//     { "id": "uuid", "tipo": "batalha", "fase": "Fase2_4", "cliente_em": 1760000000000,
//       "acertos": 2, "erros": 1, "duracao_s": 45, "dados": { ...qualquer coisa... } }
//   ]
// }
// Aceita Content-Type text/plain também: é o que o sendBeacon do WebGL manda.

import {
  CORS, TIPOS_VALIDOS, erro, json, inteiro, limitar, limparEspacos, normalizarNome,
} from "./util.js";

const MAX_CORPO_BYTES = 200_000;
const MAX_REGISTROS_POR_ENVIO = 40; // cada um é uma consulta; o plano grátis do D1 permite 50 por chamada
// Lotes de cliques/teclas chegam a ~20 KB; o resto é bem menor.
const MAX_DADOS_BYTES = 64_000;
// Relógio do aparelho fora disso é considerado errado.
const CLIENTE_MIN = Date.UTC(2024, 0, 1);
const CLIENTE_FOLGA_MS = 24 * 3600 * 1000;

export async function registrar(request, env) {
  const texto = await request.text();
  if (texto.length > MAX_CORPO_BYTES) return erro(413, "Corpo grande demais", CORS);

  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return erro(400, "JSON inválido", CORS);
  }

  const sessao = limitar(corpo.sessao, 64);
  const alunoNome = limparEspacos(limitar(corpo.aluno, 40));
  // Turma é opcional: quem só manda o nome cai em "GERAL".
  const turma = limparEspacos(limitar(corpo.turma, 20)).toUpperCase() || "GERAL";
  const versao = limitar(corpo.versao, 20);
  const teste = corpo.teste === true ? 1 : 0;
  const registros = Array.isArray(corpo.registros) ? corpo.registros : [];

  if (!sessao || !alunoNome) return erro(400, "Faltou sessao ou aluno", CORS);
  if (registros.length === 0) return erro(400, "Nenhum registro", CORS);
  if (registros.length > MAX_REGISTROS_POR_ENVIO) return erro(400, "Registros demais", CORS);

  const aluno = normalizarNome(alunoNome);
  const agora = Date.now();

  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO registros
       (id, sessao, aluno, aluno_nome, turma, tipo, fase, acertos, erros, duracao_s, dados, versao, criado_em, cliente_em, teste)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const comandos = [];
  for (const r of registros) {
    const id = limitar(r.id, 64);
    const tipo = limitar(r.tipo, 20);
    if (!id || !TIPOS_VALIDOS.includes(tipo)) continue;

    let dados = r.dados === undefined ? null : JSON.stringify(r.dados);
    if (dados && dados.length > MAX_DADOS_BYTES) dados = null;

    let clienteEm = inteiro(r.cliente_em);
    if (clienteEm !== null && (clienteEm < CLIENTE_MIN || clienteEm > agora + CLIENTE_FOLGA_MS)) clienteEm = null;

    comandos.push(
      insert.bind(
        id, sessao, aluno, alunoNome, turma, tipo,
        limitar(r.fase, 40) || null,
        inteiro(r.acertos), inteiro(r.erros), inteiro(r.duracao_s),
        dados, versao || null, agora, clienteEm, teste
      )
    );
  }

  if (comandos.length === 0) return erro(400, "Nenhum registro válido", CORS);

  const resultados = await env.DB.batch(comandos);
  const gravados = resultados.reduce((soma, r) => soma + (r.meta?.changes ?? 0), 0);

  // "recebidos" > "gravados" significa que alguns já existiam (reenvio) — normal.
  return json({ ok: true, recebidos: comandos.length, gravados }, 200, CORS);
}
