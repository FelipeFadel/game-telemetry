-- Schema completo, para criar um banco do zero (npm run db:local / db:remoto).
-- Para um banco que já existe, rode as migrações em migracoes/ na ordem.

-- Uma linha por resumo enviado pelo jogo (batalha, fase, sessão, evento, lote de cliques/teclas).
CREATE TABLE IF NOT EXISTS registros (
  id         TEXT PRIMARY KEY,   -- UUID gerado no jogo; reenvios com o mesmo id são ignorados
  sessao     TEXT NOT NULL,      -- UUID da partida (cada vez que o aluno faz login)
  aluno      TEXT NOT NULL,      -- nome normalizado (minúsculas, sem acento) — usado para agrupar
  aluno_nome TEXT NOT NULL,      -- nome como o aluno digitou — usado para exibir
  turma      TEXT NOT NULL,      -- livre, em maiúsculas ("7a" vira "7A"); "GERAL" se não vier
  tipo       TEXT NOT NULL,      -- 'batalha' | 'fase' | 'sessao' | 'evento' | 'cliques' | 'teclas'
  fase       TEXT,
  acertos    INTEGER,
  erros      INTEGER,
  duracao_s  INTEGER,
  dados      TEXT,               -- JSON com as métricas detalhadas
  versao     TEXT,               -- versão do jogo que enviou
  criado_em  INTEGER NOT NULL,   -- Date.now() do servidor (ms), hora em que chegou
  cliente_em INTEGER,            -- hora no aparelho quando aconteceu (ms); difere se ficou offline
  teste      INTEGER NOT NULL DEFAULT 0  -- 1 = partida de teste (Editor ou marcada no painel)
);

CREATE INDEX IF NOT EXISTS idx_turma_aluno ON registros(turma, aluno);
CREATE INDEX IF NOT EXISTS idx_tipo_turma ON registros(tipo, turma);

-- Cópia das linhas antes de cada edição/exclusão feita pelo painel, para desfazer.
CREATE TABLE IF NOT EXISTS alteracoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lote        TEXT NOT NULL,     -- uma operação do painel (pode mexer em várias linhas)
  acao        TEXT NOT NULL,     -- 'apagar' | 'atualizar'
  registro_id TEXT NOT NULL,
  antes       TEXT NOT NULL,     -- JSON da linha antes
  depois      TEXT,              -- JSON da linha depois (só 'atualizar')
  descricao   TEXT,
  feito_em    INTEGER NOT NULL,
  desfeito_em INTEGER
);

CREATE INDEX IF NOT EXISTS idx_alteracoes_lote ON alteracoes(lote);

-- Contas de usuário (cadastro e login).
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,  -- minúsculas
  usuario    TEXT NOT NULL UNIQUE,  -- minúsculas; 3 a 30 caracteres [a-z0-9_.-]
  senha_hash TEXT NOT NULL,         -- pbkdf2$iterações$sal$hash (hex)
  criado_em  INTEGER NOT NULL       -- Date.now() (ms)
);
