-- Geografia Loja Física (Conta Azul — UF do destinatário da NF-e)
CREATE VIEW public.v_loja_fisica_geografia AS
SELECT
  c.state,
  c.city,
  COUNT(s.sale_id)::int AS orders_count,
  SUM(s.gross_revenue) AS revenue
FROM sales s
JOIN customers c ON c.customer_id = s.customer_id
WHERE s.status = 'paid' AND s.source = 'conta_azul'
GROUP BY c.state, c.city;

-- Geografia consolidada (ambas fontes)
CREATE VIEW public.v_geografia_consolidada AS
SELECT
  c.state,
  COUNT(s.sale_id)::int AS orders_count,
  SUM(s.gross_revenue) AS revenue,
  SUM(CASE WHEN s.source = 'nuvemshop' THEN s.gross_revenue ELSE 0 END) AS revenue_nuvemshop,
  SUM(CASE WHEN s.source = 'conta_azul' THEN s.gross_revenue ELSE 0 END) AS revenue_conta_azul
FROM sales s
JOIN customers c ON c.customer_id = s.customer_id
WHERE s.status = 'paid' AND c.state IS NOT NULL
GROUP BY c.state;
