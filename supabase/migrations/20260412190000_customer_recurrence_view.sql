CREATE OR REPLACE VIEW public.v_customer_recurrence AS
SELECT
  c.source,
  COUNT(*) FILTER (WHERE order_count = 1)::int AS first_time_buyers,
  COUNT(*) FILTER (WHERE order_count > 1)::int AS repeat_buyers,
  COUNT(*)::int AS total_customers,
  ROUND(COUNT(*) FILTER (WHERE order_count > 1)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS repeat_rate
FROM (
  SELECT
    s.customer_id,
    COUNT(s.sale_id) AS order_count
  FROM sales s
  WHERE s.status = 'paid' AND s.customer_id IS NOT NULL
  GROUP BY s.customer_id
) sub
JOIN customers c ON c.customer_id = sub.customer_id
GROUP BY c.source;
