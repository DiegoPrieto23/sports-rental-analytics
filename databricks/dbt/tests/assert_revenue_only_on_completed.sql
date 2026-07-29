-- Test singular: un alquiler cancelado NUNCA puede aportar ingresos.
-- Protege el KPI mas sensible del negocio (revenue) frente a un cambio futuro en la
-- definicion de `completed` o en el calculo de `revenue`.

select
    rental_id,
    cancelled,
    completed,
    rental_price,
    revenue
from {{ ref('int_rentals_enriched') }}
where cancelled and coalesce(revenue, 0) <> 0
