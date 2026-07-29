-- DATA MART · Metricas por PRODUCTO (grano: 1 fila por product_id).
-- Responde a: que referencias rotan, cuales inmovilizan capital y cuales dan margen.
--
--   occupancy_rate     = dias alquilados / (unidades de inventario x dias del periodo)
--   utilization        = nº de alquileres / unidades de inventario
--   revenue_per_unit   = ingresos / unidades de inventario
--   margin             = (ingresos - mantenimiento) / ingresos
--   maintenance_ratio  = mantenimiento / ingresos
--   cancellation_rate  = cancelados / total (universo COMPLETO, incluye cancelados)
--   rotation_class     = cuartiles de ocupacion -> Infrautilizado / Normal / Saturado
--   abc_class          = Pareto de ingresos -> A (80%) / B (95%) / C (cola larga)

with fact as (

    select * from {{ ref('int_rentals_enriched') }}

),

period as (

    -- Ventana de observacion, necesaria para normalizar la ocupacion.
    select datediff(max(rental_date), min(rental_date)) as period_days
    from fact

),

completed as (

    -- Base de ingresos y ocupacion: solo alquileres entregados.
    select
        product_id,
        count(*)                                        as rentals_completed,
        sum(rental_days)                                as rental_days_sum,
        sum(revenue)                                    as revenue,
        sum(maintenance_cost)                           as maintenance,
        avg(review_score)                               as avg_review,
        avg(case when damage_reported then 1.0 else 0.0 end) as damage_rate,
        avg(case when late_return     then 1.0 else 0.0 end) as late_return_rate
    from fact
    where completed
    group by product_id

),

total as (

    -- Universo total (incluye cancelados) para la tasa de cancelacion.
    select
        product_id,
        count(*)                                        as rentals_total,
        sum(case when cancelled then 1 else 0 end)      as cancellations
    from fact
    group by product_id

),

base as (

    select
        p.product_id,
        p.category,
        p.sport,
        p.product_name,
        p.purchase_price,
        p.replacement_cost,
        p.maintenance_interval,
        p.product_age,
        p.inventory_units,
        coalesce(t.rentals_total, 0)                    as rentals_total,
        coalesce(t.cancellations, 0)                    as cancellations,
        coalesce(c.rentals_completed, 0)                as rentals_completed,
        coalesce(c.rental_days_sum, 0)                  as rental_days_sum,
        coalesce(c.revenue, 0)                          as revenue,
        coalesce(c.maintenance, 0)                      as maintenance,
        c.avg_review,
        c.damage_rate,
        c.late_return_rate
    from {{ ref('stg_products') }} p
    left join total     t on p.product_id = t.product_id
    left join completed c on p.product_id = c.product_id

),

metrics as (

    select
        b.*,
        b.rental_days_sum / (b.inventory_units * cast(pd.period_days as double))   as occupancy_rate,
        cast(b.rentals_completed as double) / b.inventory_units                    as utilization,
        b.revenue / b.inventory_units                                              as revenue_per_unit,
        b.revenue - b.maintenance                                                  as profit,
        case when b.revenue > 0 then (b.revenue - b.maintenance) / b.revenue end   as margin,
        case when b.revenue > 0 then b.maintenance / b.revenue end                 as maintenance_ratio,
        case when b.rentals_total > 0
             then cast(b.cancellations as double) / b.rentals_total end            as cancellation_rate
    from base b
    cross join period pd

),

quartiles as (

    select
        percentile_cont(0.25) within group (order by occupancy_rate) as occupancy_q1,
        percentile_cont(0.75) within group (order by occupancy_rate) as occupancy_q3
    from metrics

),

pareto as (

    select
        *,
        sum(revenue) over (
            order by revenue desc
            rows between unbounded preceding and current row
        ) / nullif(sum(revenue) over (), 0)                          as cumulative_revenue_share
    from metrics

)

select
    p.*,

    -- Gestion de stock: clasificacion de rotacion por cuartiles de ocupacion.
    case
        when p.occupancy_rate <= q.occupancy_q1 then 'Infrautilizado'
        when p.occupancy_rate >= q.occupancy_q3 then 'Saturado'
        else 'Normal'
    end                                                              as rotation_class,

    -- Analisis ABC (Pareto de ingresos).
    case
        when p.cumulative_revenue_share <= 0.80 then 'A'
        when p.cumulative_revenue_share <= 0.95 then 'B'
        else 'C'
    end                                                              as abc_class

from pareto p
cross join quartiles q
