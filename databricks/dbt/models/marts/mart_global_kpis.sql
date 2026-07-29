-- DATA MART · Cuadro de mando global (1 unica fila).
-- Es el "metrics layer": cada KPI se define UNA sola vez aqui, y BI, notebooks y SQL
-- ad-hoc consumen la misma verdad.
--
-- Ojo al denominador de cada tasa, es donde se cometen los errores clasicos:
--   cancellation_rate -> sobre el TOTAL de alquileres (incluye cancelados).
--   late/damage/review-> solo sobre los COMPLETADOS (un cancelado no se devuelve
--                        tarde ni se rompe: incluirlos diluiria la tasa).

with fact as (

    select * from {{ ref('int_rentals_enriched') }}

)

select
    count(*)                                                       as rentals_total,
    sum(case when completed then 1 else 0 end)                     as rentals_completed,

    sum(case when completed then revenue end)                      as revenue_eur,
    avg(case when completed then revenue end)                      as avg_ticket_eur,
    avg(case when completed then rental_days end)                  as avg_rental_days,

    avg(case when cancelled then 1.0 else 0.0 end)                 as cancellation_rate,
    avg(case when completed then (case when late_return     then 1.0 else 0.0 end) end) as late_return_rate,
    avg(case when completed then (case when damage_reported then 1.0 else 0.0 end) end) as damage_rate,
    avg(case when completed then review_score end)                 as avg_review_score,

    sum(case when completed then maintenance_cost end)
        / nullif(sum(case when completed then revenue end), 0)     as maintenance_ratio,
    sum(case when completed then profit end)
        / nullif(sum(case when completed then revenue end), 0)     as gross_margin,

    count(distinct customer_id)                                    as active_customers,
    count(distinct product_id)                                     as products_rented,
    count(distinct store_id)                                       as stores_with_activity,

    min(rental_date)                                               as first_rental_date,
    max(rental_date)                                               as last_rental_date,
    datediff(max(rental_date), min(rental_date))                   as period_days,
    current_timestamp()                                            as computed_at

from fact
