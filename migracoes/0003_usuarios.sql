-- Contas de usuário (cadastro e login). Rode uma vez em bancos que já existem:
--   npm run db:migrar:local   /   npm run db:migrar:remoto
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,  -- minúsculas
  usuario    TEXT NOT NULL UNIQUE,  -- minúsculas; 3 a 30 caracteres [a-z0-9_.-]
  senha_hash TEXT NOT NULL,         -- pbkdf2$iterações$sal$hash (hex)
  criado_em  INTEGER NOT NULL       -- Date.now() (ms)
);
