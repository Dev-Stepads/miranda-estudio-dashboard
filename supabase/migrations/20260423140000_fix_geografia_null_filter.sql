-- Fix: v_loja_fisica_geografia incluia rows com state/city NULL.
-- Adiciona filtro IS NOT NULL para consistencia com v_geografia_consolidada.
DROP VIEW IF EXISTS public.v_loja_fisica_geografia;
CREATE VIEW public.v_loja_fisica_geografia AS
SELECT
  c.state,
  c.city,
  COUNT(s.sale_id)::int AS orders_count,
  SUM(s.gross_revenue) AS revenue
FROM sales s
JOIN customers c ON c.customer_id = s.customer_id
WHERE s.status = 'paid' AND s.source = 'conta_azul'
  AND c.state IS NOT NULL
GROUP BY c.state, c.city;
