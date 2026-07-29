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

    select * from {{ source('rental_raw', 'rentals_raw') }}

),

raw_products as (

    select * from {{ source('rental_raw', 'products_raw') }}

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
