-- DATA MART · Serie mensual de negocio (grano: 1 fila por mes).
-- Responde a: como evoluciona el negocio, donde estan los picos estacionales y si
-- la tendencia subyacente crece.
--
--   revenue_rolling_3m -> media movil de 3 meses: suaviza el doble pico
--                         (invierno/verano) y deja ver la tendencia real.
--   revenue_yoy_pct    -> comparativa con el mismo mes del ano anterior (12 lags).

with fact as (

    select * from {{ ref('int_rentals_enriched') }}

),

monthly as (

    select
        month,
        count(*)                                             as rentals,
        sum(case when completed then 1 else 0 end)            as rentals_completed,
        sum(case when completed then revenue end)             as revenue,
        avg(case when completed then revenue end)             as avg_ticket,
        avg(case when cancelled then 1.0 else 0.0 end)        as cancellation_rate,
        avg(case when completed then review_score end)        as avg_review_score
    from fact
    where month is not null
    group by month

)

select
    month,
    rentals,
    rentals_completed,
    revenue,
    avg_ticket,
    cancellation_rate,
    avg_review_score,
    avg(revenue) over (
        order by month rows between 2 preceding and current row
    )                                                        as revenue_rolling_3m,
    lag(revenue, 12) over (order by month)                   as revenue_same_month_last_year,
    100.0 * (revenue - lag(revenue, 12) over (order by month))
          / nullif(lag(revenue, 12) over (order by month), 0) as revenue_yoy_pct
from monthly
order by month
