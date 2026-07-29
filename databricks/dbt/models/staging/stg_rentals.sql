-- Staging: 1:1 con la fuente. No se pierden filas ni se corrigen valores de negocio.
-- Solo casting, renombrado y estandarizacion de texto.
--
-- `try_cast` es deliberado: la ingesta por UI puede inferir los tipos correctamente
-- (date/boolean/double) o dejarlos como STRING. `try_cast` funciona en ambos casos y
-- ademas no rompe el pipeline si aparece un valor no parseable (devuelve NULL).
-- `initcap(trim(x))` replica el `standardize_text` del notebook (.str.strip().str.title()).

with source as (

    select * from {{ source('rental_raw', 'rentals_raw') }}

)

select
    -- Claves
    trim(rental_id)                                        as rental_id,
    trim(customer_id)                                      as customer_id,
    trim(product_id)                                       as product_id,
    trim(store_id)                                         as store_id,

    -- Fechas
    try_cast(rental_date      as date)                     as rental_date,
    try_cast(return_date      as date)                     as return_date,
    try_cast(reservation_date as date)                     as reservation_date,

    -- Metricas numericas
    try_cast(rental_days           as int)                 as rental_days,
    try_cast(reservation_lead_time as int)                 as reservation_lead_time,
    try_cast(review_score          as int)                 as review_score,
    try_cast(rental_price          as double)              as rental_price,
    try_cast(maintenance_cost      as double)              as maintenance_cost,

    -- Flags de negocio
    coalesce(try_cast(cancelled       as boolean), false)  as cancelled,
    coalesce(try_cast(late_return     as boolean), false)  as late_return,
    coalesce(try_cast(damage_reported as boolean), false)  as damage_reported,

    -- Atributos de texto estandarizados (trim + Title case)
    initcap(trim(booking_channel))                         as booking_channel,
    initcap(trim(weather))                                 as weather,
    initcap(trim(season))                                  as season

from source
