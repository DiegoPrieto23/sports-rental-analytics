-- Databricks notebook source

-- COMMAND ----------

-- MAGIC %md
-- MAGIC # Capa MARTS · metricas y KPIs listos para consumo
-- MAGIC
-- MAGIC > Generado automaticamente desde el proyecto dbt con
-- MAGIC > `python databricks/build_databricks_notebooks.py`.
-- MAGIC > **No editar a mano**: modifica el modelo dbt y regenera.

-- COMMAND ----------

CREATE SCHEMA IF NOT EXISTS workspace.marts;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_product_metrics`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_product_metrics AS
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

    select * from workspace.intermediate.int_rentals_enriched

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
    from workspace.staging.stg_products p
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
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_store_metrics`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_store_metrics AS
-- DATA MART · Metricas por TIENDA (grano: 1 fila por store_id).
-- Responde a: donde se concentra el negocio y que tiendas convierten mejor su trafico.
--
--   revenue_per_visitor = ingresos / visitantes anuales -> normaliza el tamano de la
--   tienda y permite comparar una flagship con una pequena de forma justa.

with fact as (

    select * from workspace.intermediate.int_rentals_enriched

),

completed as (

    select
        store_id,
        sum(revenue)                                         as revenue,
        count(*)                                             as rentals,
        avg(rental_price)                                    as avg_ticket,
        avg(review_score)                                    as avg_review,
        avg(case when late_return     then 1.0 else 0.0 end) as late_return_rate,
        avg(case when damage_reported then 1.0 else 0.0 end) as damage_rate
    from fact
    where completed
    group by store_id

),

cancellations as (

    select
        store_id,
        avg(case when cancelled then 1.0 else 0.0 end)       as cancellation_rate
    from fact
    group by store_id

)

select
    s.store_id,
    s.store_name,
    s.city                                                   as store_city,
    s.country                                                as store_country,
    s.store_size,
    s.annual_visitors,
    c.revenue,
    c.rentals,
    c.avg_ticket,
    c.avg_review,
    c.late_return_rate,
    c.damage_rate,
    x.cancellation_rate,
    c.revenue / s.annual_visitors                            as revenue_per_visitor
from workspace.staging.stg_stores s
left join completed      c on s.store_id = c.store_id
left join cancellations  x on s.store_id = x.store_id
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_customer_metrics`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_customer_metrics AS
-- DATA MART · Metricas por CLIENTE (grano: 1 fila por customer_id).
-- Responde a: quien sostiene los ingresos y quien se esta enfriando.
--
--   clrv         = Customer Lifetime Rental Value: ingresos acumulados del cliente.
--   recency_days = dias entre su ultimo alquiler y el ultimo dia observado del dataset
--                  (no "hoy": el dataset tiene una ventana cerrada).
--
-- Los clientes sin ningun alquiler completado se conservan con metricas NULL: son
-- justo la poblacion objetivo de una campana de activacion.

with fact as (

    select * from workspace.intermediate.int_rentals_enriched

),

observation_window as (

    select max(rental_date) as last_observed_date from fact

),

completed as (

    select
        customer_id,
        sum(revenue)      as clrv,
        count(*)          as rentals,
        avg(rental_price) as avg_ticket,
        avg(review_score) as avg_review,
        min(rental_date)  as first_rental_date,
        max(rental_date)  as last_rental_date
    from fact
    where completed
    group by customer_id

),

cancellations as (

    select
        customer_id,
        avg(case when cancelled then 1.0 else 0.0 end) as cancellation_rate
    from fact
    group by customer_id

)

select
    c.customer_id,
    c.age,
    c.gender,
    c.country,
    c.city,
    c.customer_segment,
    c.membership_level,
    c.signup_date,
    c.total_previous_rentals,
    m.clrv,
    m.rentals,
    m.avg_ticket,
    m.avg_review,
    m.first_rental_date,
    m.last_rental_date,
    x.cancellation_rate,
    datediff(w.last_observed_date, m.last_rental_date)      as recency_days,
    cast(date_trunc('MONTH', m.first_rental_date) as date)  as cohort_month
from workspace.staging.stg_customers c
left join completed     m on c.customer_id = m.customer_id
left join cancellations x on c.customer_id = x.customer_id
cross join observation_window w
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_global_kpis`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_global_kpis AS
-- DATA MART · Cuadro de mando global (1 unica fila).
-- Es el "metrics layer": cada KPI se define UNA sola vez aqui, y BI, notebooks y SQL
-- ad-hoc consumen la misma verdad.
--
-- Ojo al denominador de cada tasa, es donde se cometen los errores clasicos:
--   cancellation_rate -> sobre el TOTAL de alquileres (incluye cancelados).
--   late/damage/review-> solo sobre los COMPLETADOS (un cancelado no se devuelve
--                        tarde ni se rompe: incluirlos diluiria la tasa).

with fact as (

    select * from workspace.intermediate.int_rentals_enriched

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
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_monthly_revenue`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_monthly_revenue AS
-- DATA MART · Serie mensual de negocio (grano: 1 fila por mes).
-- Responde a: como evoluciona el negocio, donde estan los picos estacionales y si
-- la tendencia subyacente crece.
--
--   revenue_rolling_3m -> media movil de 3 meses: suaviza el doble pico
--                         (invierno/verano) y deja ver la tendencia real.
--   revenue_yoy_pct    -> comparativa con el mismo mes del ano anterior (12 lags).

with fact as (

    select * from workspace.intermediate.int_rentals_enriched

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
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_category_performance`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_category_performance AS
-- DATA MART · Rendimiento por CATEGORIA deportiva (grano: 1 fila por categoria).
-- Responde a: que deportes sostienen la cuenta y donde ampliar o recortar inventario.
-- Cruza el comportamiento transaccional (ingresos, ticket, satisfaccion) con el
-- rendimiento del activo (ocupacion, unidades) que vive en mart_product_metrics.

with fact as (

    select * from workspace.intermediate.int_rentals_enriched

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
    from workspace.marts.mart_product_metrics
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
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_pricing_by_season`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_pricing_by_season AS
-- DATA MART · Pricing dinamico: precio por dia segun categoria y temporada.
-- (grano: 1 fila por categoria x temporada)
--
-- Usamos la MEDIANA del precio POR DIA, no el ticket total: neutraliza el mix de
-- duraciones y hace comparables categorias que se alquilan 2 dias con otras que se
-- alquilan 10. La mediana ademas resiste los outliers residuales mejor que la media.
--
--   seasonal_spread_pct -> (max/min entre temporadas - 1) x 100 para la categoria.
--                          Alto  = ya se captura el premium de escasez estacional.
--                          Bajo  = o la demanda es aseasonal, o hay poder de precio
--                                  sin explotar.
--   Es precio OBSERVADO, no elasticidad: dice lo que se cobra, no como responderia
--   la demanda. Fijar el precio optimo exige experimentar (test A/B).

with fact as (

    select * from workspace.intermediate.int_rentals_enriched

),

base as (

    select category, season, price_per_day, rental_price
    from fact
    where completed
      and price_per_day is not null
      and category is not null
      and season is not null

),

aggregated as (

    select
        category,
        season,
        count(*)                                                    as rentals,
        percentile_cont(0.50) within group (order by price_per_day)  as median_price_per_day,
        avg(price_per_day)                                          as avg_price_per_day,
        avg(rental_price)                                           as avg_ticket
    from base
    group by category, season

)

select
    category,
    season,
    rentals,
    median_price_per_day,
    avg_price_per_day,
    avg_ticket,
    -- Peso de cada temporada en el volumen anual de la categoria: mide la
    -- estacionalidad estructural (esqui ~100% invierno, kayak ~verano).
    100.0 * rentals / sum(rentals) over (partition by category)      as season_volume_share_pct,
    100.0 * (max(median_price_per_day) over (partition by category)
             / nullif(min(median_price_per_day) over (partition by category), 0) - 1)
                                                                     as seasonal_spread_pct
from aggregated
order by category, season
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_channel_performance`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_channel_performance AS
-- DATA MART · Omnicanalidad (grano: 1 fila por canal de reserva).
-- Responde a: por que canal llega el negocio y donde hay mas friccion.
-- El bloque digital (Online + App) se marca aparte porque es la palanca sobre la que
-- se puede actuar con producto (recordatorios, prepago) para reducir cancelacion.

with fact as (

    select * from workspace.intermediate.int_rentals_enriched
    where booking_channel is not null

)

select
    booking_channel,
    booking_channel in ('Online', 'App')                 as is_digital,
    count(*)                                             as rentals_total,
    100.0 * count(*) / sum(count(*)) over ()             as share_pct,
    sum(case when completed then revenue end)            as revenue,
    avg(case when completed then rental_price end)       as avg_ticket,
    avg(case when cancelled then 1.0 else 0.0 end)       as cancellation_rate,
    avg(case when completed then review_score end)       as avg_review_score,
    avg(reservation_lead_time)                           as avg_lead_time_days
from fact
group by booking_channel
order by rentals_total desc
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_cohort_retention`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_cohort_retention AS
-- DATA MART · Retencion por cohorte (grano: cohorte x mes de vida).
-- Agrupa a los clientes por el mes de su PRIMER alquiler y sigue que porcentaje
-- sigue activo N meses despues. Separa el efecto "cuando entro el cliente" del
-- efecto "cuanto tiempo lleva", y revela si el negocio fideliza o gotea.
--
-- Lectura de negocio esperada: el alquiler es una compra puntual, no una
-- suscripcion, asi que la retencion mes a mes es baja pero REAPARECE de forma
-- estacional (el cliente de esqui vuelve el invierno siguiente).

with fact as (

    select customer_id, month
    from workspace.intermediate.int_rentals_enriched
    where customer_id is not null and month is not null

),

cohorts as (

    select customer_id, min(month) as cohort_month
    from fact
    group by customer_id

),

activity as (

    select
        c.cohort_month,
        f.month                                                   as activity_month,
        f.customer_id,
        cast(months_between(f.month, c.cohort_month) as int)       as months_since_first_rental
    from fact f
    join cohorts c on f.customer_id = c.customer_id

),

cohort_sizes as (

    select cohort_month, count(distinct customer_id) as cohort_size
    from activity
    group by cohort_month

)

select
    a.cohort_month,
    a.months_since_first_rental,
    s.cohort_size,
    count(distinct a.customer_id)                                  as active_customers,
    100.0 * count(distinct a.customer_id) / s.cohort_size          as retention_pct
from activity a
join cohort_sizes s on a.cohort_month = s.cohort_month
group by a.cohort_month, a.months_since_first_rental, s.cohort_size
order by a.cohort_month, a.months_since_first_rental
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `marts.mart_data_quality`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.marts.mart_data_quality AS
-- DATA MART · Data Trust Score (grano: 1 fila por dimension de calidad + score global).
--
-- Se calcula sobre las tablas CRUDAS a proposito: mide la calidad de lo que ENTRA,
-- que es lo que hay que vigilar y reclamar al sistema origen. Medirlo sobre la capa
-- limpia daria 100 por construccion y no informaria de nada.
--
--   Completitud  (30%) 1 - tasa media de nulos en las columnas criticas
--   Unicidad     (20%) 1 - proporcion de filas exactamente duplicadas
--   Validez      (35%) 1 - proporcion de filas que violan alguna regla de negocio
--   Consistencia (15%) % de categorias de producto dentro del catalogo canonico
--
-- Uso operativo: si el score baja de un umbral (p.ej. 95), alerta al canal del
-- equipo de datos y se bloquea la publicacion de los marts.

with raw_rentals as (

    select * from workspace.staging.rentals_raw

),

raw_products as (

    select * from workspace.staging.products_raw

),

completeness as (

    -- Media de la tasa de nulos sobre las 5 columnas criticas del hecho.
    select
        1 - (
              avg(case when rental_price    is null then 1.0 else 0.0 end)
            + avg(case when store_id        is null then 1.0 else 0.0 end)
            + avg(case when booking_channel is null then 1.0 else 0.0 end)
            + avg(case when review_score    is null then 1.0 else 0.0 end)
            + avg(case when return_date     is null then 1.0 else 0.0 end)
        ) / 5.0 as score
    from raw_rentals

),

row_counts as (
    select count(*) as n_rows from raw_rentals
),

distinct_counts as (
    select count(*) as n_distinct_rows from (select distinct * from raw_rentals)
),

uniqueness as (
    select cast(d.n_distinct_rows as double) / r.n_rows as score
    from row_counts r cross join distinct_counts d
),

validity as (

    -- Una fila es invalida si viola CUALQUIERA de las reglas de negocio.
    select
        1 - avg(
            case when
                   (review_score is not null and try_cast(review_score as int) not between 1 and 5)
                or (rental_price is not null and try_cast(rental_price as double) not between 0.01 and 2000)
                or (try_cast(rental_days as int) not between 1 and 30)
                or (try_cast(maintenance_cost as double) < 0)
                or (return_date is not null
                    and try_cast(return_date as date) < try_cast(rental_date as date))
                 then 1.0 else 0.0 end
        ) as score
    from raw_rentals

),

consistency as (

    select
        avg(case when trim(category) in (
                'Bicicletas', 'Esquí', 'Snowboard', 'Paddle Surf', 'Kayak',
                'Camping', 'Escalada', 'Running', 'Fitness', 'Raquetas')
            then 1.0 else 0.0 end) as score
    from raw_products

),

dimensions as (

    select 'Completitud'  as dimension, 1 as dimension_order, 0.30 as weight, score from completeness
    union all
    select 'Unicidad'     as dimension, 2 as dimension_order, 0.20 as weight, score from uniqueness
    union all
    select 'Validez'      as dimension, 3 as dimension_order, 0.35 as weight, score from validity
    union all
    select 'Consistencia' as dimension, 4 as dimension_order, 0.15 as weight, score from consistency

)

select
    dimension,
    dimension_order,
    weight,
    100.0 * score                                as score_pct,
    100.0 * score * weight                       as weighted_contribution,
    sum(100.0 * score * weight) over ()          as data_trust_score,
    current_timestamp()                          as computed_at
from dimensions
order by dimension_order
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### Control de volumetria de la capa

-- COMMAND ----------

SELECT 'mart_product_metrics' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_product_metrics
UNION ALL
SELECT 'mart_store_metrics' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_store_metrics
UNION ALL
SELECT 'mart_customer_metrics' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_customer_metrics
UNION ALL
SELECT 'mart_global_kpis' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_global_kpis
UNION ALL
SELECT 'mart_monthly_revenue' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_monthly_revenue
UNION ALL
SELECT 'mart_category_performance' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_category_performance
UNION ALL
SELECT 'mart_pricing_by_season' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_pricing_by_season
UNION ALL
SELECT 'mart_channel_performance' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_channel_performance
UNION ALL
SELECT 'mart_cohort_retention' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_cohort_retention
UNION ALL
SELECT 'mart_data_quality' AS objeto, COUNT(*) AS filas FROM workspace.marts.mart_data_quality
ORDER BY objeto;
