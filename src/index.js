// Worker de telemetria do Shadows of Linusbae.
//
// Rotas públicas:
//   POST /registrar        -> o jogo envia resumos, cliques e teclas
// Rotas com senha (login em /login com cookie de sessão; Basic Auth também
// vale; segredo SENHA_PAINEL):
//   GET  /painel           -> tabela aluno x fase
//   GET  /heatmap          -> heatmap de cliques por tela
//   GET  /teclas           -> uso do teclado por modo do jogo
//   GET  /dados            -> ver, editar, apagar e desfazer
//   GET  /csv              -> exporta para planilha
//   /api/*                 -> dados das páginas acima

import { apiAlterar, apiDesfazer, apiHistorico, apiOpcoes, apiRegistro, apiRegistros, paginaDados } from "./admin.js";
import { apiHeatmap, paginaHeatmap } from "./heatmap.js";
import { login, paraLogin, sair, sessaoValida } from "./login.js";
import { csv, painel } from "./painel.js";
import { registrar } from "./registrar.js";
import { paginaTeclas } from "./teclas.js";
import { CORS, autorizado, erro } from "./util.js";

const ROTAS_GET = {
  "/painel": (url, env) => painel(url, env),
  "/csv": (url, env) => csv(url, env),
  "/heatmap": (url, env) => paginaHeatmap(url, env),
  "/teclas": (url, env) => paginaTeclas(url, env),
  "/dados": () => paginaDados(),
  "/api/heatmap": (url, env) => apiHeatmap(url, env),
  "/api/registros": (url, env) => apiRegistros(url, env),
  "/api/registro": (url, env) => apiRegistro(url, env),
  "/api/opcoes": (url, env) => apiOpcoes(env),
  "/api/historico": (url, env) => apiHistorico(env),
};

const ROTAS_POST = {
  "/api/alterar": (req, env) => apiAlterar(req, env),
  "/api/desfazer": (req, env) => apiDesfazer(req, env),
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/registrar") {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
        if (request.method === "POST") return await registrar(request, env);
        return erro(405, "Use POST", CORS);
      }

      if (url.pathname === "/login" && (request.method === "GET" || request.method === "POST")) {
        return await login(request, env, url);
      }
      if (url.pathname === "/sair" && request.method === "POST") {
        if (request.headers.get("Origin") !== url.origin) return erro(403, "Origem não permitida");
        return sair(url);
      }

      if (url.pathname === "/") return Response.redirect(url.origin + "/painel", 302);

      const get = request.method === "GET" && ROTAS_GET[url.pathname];
      const post = request.method === "POST" && ROTAS_POST[url.pathname];
      if (!get && !post) return new Response("Não encontrado", { status: 404 });

      // Sessão do login; Basic Auth continua valendo para scripts (curl).
      if (!(await sessaoValida(request, env)) && !(await autorizado(request, env))) {
        if (url.pathname.startsWith("/api/")) return erro(401, "Sessão expirada. Entre de novo.");
        return paraLogin(url);
      }

      if (post) {
        // Alterações só pelas páginas do próprio painel: outro site não consegue
        // aproveitar a senha guardada no navegador para apagar dados.
        const origem = request.headers.get("Origin");
        if (origem !== url.origin) return erro(403, "Origem não permitida");
        if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) {
          return erro(415, "Use application/json");
        }
        return await post(request, env);
      }
      return await get(url, env);
    } catch (err) {
      console.error(err);
      const cors = url.pathname === "/registrar" ? CORS : {};
      return erro(500, "Erro interno", cors);
    }
  },
};
