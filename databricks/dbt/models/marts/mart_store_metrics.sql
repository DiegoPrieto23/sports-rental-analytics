-- DATA MART · Metricas por TIENDA (grano: 1 fila por store_id).
-- Responde a: donde se concentra el negocio y que tiendas convierten mejor su trafico.
--
--   revenue_per_visitor = ingresos / visitantes anuales -> normaliza el tamano de la
--   tienda y permite comparar una flagship con una pequena de forma justa.

with fact as (

    select * from {{ ref('int_rentals_enriched') }}

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
from {{ ref('stg_stores') }} s
left join completed      c on s.store_id = c.store_id
left join cancellations  x on s.store_id = x.store_id
