CREATE VIEW public.v_top_customers AS
SELECT
  c.customer_id,
  c.name,
  c.state,
  c.source,
  COUNT(s.sale_id)::int AS orders_count,
  SUM(s.gross_revenue) AS total_revenue,
  ROUND(AVG(s.gross_revenue), 2) AS avg_ticket
FROM customers c
JOIN sales s ON s.customer_id = c.customer_id
WHERE s.status = 'paid'
GROUP BY c.customer_id, c.name, c.state, c.source;
