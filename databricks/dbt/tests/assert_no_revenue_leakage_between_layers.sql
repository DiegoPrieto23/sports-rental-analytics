-- Test singular de reconciliacion entre capas: los ingresos agregados en los Data
-- Marts deben cuadrar con los de la tabla de hechos. Es el test que detecta un JOIN
-- que duplica filas, el fallo silencioso mas caro de un pipeline analitico.
-- Tolerancia de 1 EUR por redondeo en coma flotante.

with fact_revenue as (

    select sum(revenue) as revenue
    from {{ ref('int_rentals_enriched') }}
    where completed

),

mart_revenue as (

    select sum(revenue) as revenue
    from {{ ref('mart_product_metrics') }}

)

select
    f.revenue as fact_revenue,
    m.revenue as mart_revenue,
    abs(f.revenue - m.revenue) as difference
from fact_revenue f
cross join mart_revenue m
where abs(f.revenue - m.revenue) > 1
