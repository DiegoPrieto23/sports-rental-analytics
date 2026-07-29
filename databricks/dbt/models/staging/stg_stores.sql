-- Staging de la dimension de tiendas.
-- `country` llega con casing inconsistente ("ESPAÑA", " francia") en ~5% de las filas.

with source as (

    select * from {{ source('rental_raw', 'stores_raw') }}

)

select
    trim(store_id)                        as store_id,
    trim(store_name)                      as store_name,
    trim(city)                            as city,
    initcap(trim(country))                as country,
    trim(store_size)                      as store_size,
    try_cast(annual_visitors as bigint)   as annual_visitors

from source
