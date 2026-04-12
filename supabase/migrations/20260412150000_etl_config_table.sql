-- ============================================================
-- Tabela para persistir configurações do ETL entre execuções.
--
-- Caso de uso principal: refresh_token da Conta Azul, que é
-- SINGLE-USE e precisa ser persistido após cada uso.
-- Sem esta tabela, o cron do GitHub Actions não consegue
-- rotacionar o token entre execuções.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.etl_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.etl_config IS
  'Key-value store para estado do ETL (tokens, cursors, timestamps). Acessível apenas via service_role.';

ALTER TABLE public.etl_config ENABLE ROW LEVEL SECURITY;
-- Sem policies = default deny para anon/authenticated.
-- Apenas service_role (que tem bypass) pode ler/escrever.
