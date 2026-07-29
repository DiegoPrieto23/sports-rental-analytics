-- Staging de la dimension de clientes.
-- `country` y `gender` llegan con casing/espacios inconsistentes en ~2% de las filas.
-- Nota: `membership_level` usa el literal "Basic" (nunca "None") a proposito, porque
-- muchos lectores parsean la cadena "None" como NULL y perderiamos el grupo entero.

with source as (

    select * from {{ source('rental_raw', 'customers_raw') }}

)

select
    trim(customer_id)                             as customer_id,
    try_cast(age as int)                          as age,
    initcap(trim(gender))                         as gender,
    initcap(trim(country))                        as country,
    trim(city)                                    as city,
    -- OJO: `customer_segment` y `membership_level` NO llevan initcap. El origen no
    -- los corrompe y initcap convertiria "VIP" en "Vip", rompiendo los joins y los
    -- ordenes de segmento aguas abajo. Solo se estandariza lo que llega sucio.
    trim(customer_segment)                        as customer_segment,
    trim(membership_level)                        as membership_level,
    try_cast(signup_date as date)                 as signup_date,
    try_cast(total_previous_rentals as int)       as total_previous_rentals

from source
