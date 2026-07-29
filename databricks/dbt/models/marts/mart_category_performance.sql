-- DATA MART · Rendimiento por CATEGORIA deportiva (grano: 1 fila por categoria).
-- Responde a: que deportes sostienen la cuenta y donde ampliar o recortar inventario.
-- Cruza el comportamiento transaccional (ingresos, ticket, satisfaccion) con el
-- rendimiento del activo (ocupacion, unidades) que vive en mart_product_metrics.

with fact as (

    select * from {{ ref('int_rentals_enriched') }}

),

transactional as (

    select
        category,
        count(*)                                             as rentals_completed,
        sum(revenue)                                         as revenue,
        avg(rental_price)                                    as avg_ticket,
        avg(rental_days)                                     as avg_rental_days,
        avg(margin)                                          as avg_margin,
        avg(review_score)                                    as avg_review_score,
        avg(case when late_return     then 1.0 else 0.0 end) as late_return_rate,
        avg(case when damage_reported then 1.0 else 0.0 end) as damage_rate
    from fact
    where completed and category is not null
    group by category

),

cancellations as (

    select
        category,
        count(*)                                      as rentals_total,
        avg(case when cancelled then 1.0 else 0.0 end) as cancellation_rate
    from fact
    where category is not null
    group by category

),

inventory as (

    select
        category,
        count(*)                    as products,
        sum(inventory_units)        as inventory_units,
        avg(occupancy_rate)         as avg_occupancy_rate,
        avg(utilization)            as avg_utilization,
        avg(revenue_per_unit)       as avg_revenue_per_unit,
        avg(maintenance_ratio)      as avg_maintenance_ratio,
        avg(product_age)            as avg_product_age
    from {{ ref('mart_product_metrics') }}
    group by category

)

select
    t.category,
    c.rentals_total,
    t.rentals_completed,
    t.revenue,
    100.0 * t.revenue / nullif(sum(t.revenue) over (), 0)    as revenue_share_pct,
    t.avg_ticket,
    t.avg_rental_days,
    t.avg_margin,
    t.avg_review_score,
    c.cancellation_rate,
    t.late_return_rate,
    t.damage_rate,
    i.products,
    i.inventory_units,
    i.avg_occupancy_rate,
    i.avg_utilization,
    i.avg_revenue_per_unit,
    i.avg_maintenance_ratio,
    i.avg_product_age
from transactional t
left join cancellations c on t.category = c.category
left join inventory     i on t.category = i.category
order by t.revenue desc
