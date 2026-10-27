-- 2026-10-18: hora do aparelho, marcação de teste e histórico de alterações.
-- Rodar uma vez em bancos criados com o schema antigo:
--   npx wrangler d1 execute linusbae --remote --file=migracoes/0002_cliente_em_teste_alteracoes.sql

ALTER TABLE registros ADD COLUMN cliente_em INTEGER;
ALTER TABLE registros ADD COLUMN teste INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tipo_turma ON registros(tipo, turma);

CREATE TABLE IF NOT EXISTS alteracoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lote        TEXT NOT NULL,
  acao        TEXT NOT NULL,
  registro_id TEXT NOT NULL,
  antes       TEXT NOT NULL,
  depois      TEXT,
  descricao   TEXT,
  feito_em    INTEGER NOT NULL,
  desfeito_em INTEGER
);

CREATE INDEX IF NOT EXISTS idx_alteracoes_lote ON alteracoes(lote);
