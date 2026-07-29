-- Staging de la dimension de productos.
-- Normaliza `category` al catalogo canonico: el generador inyecta erratas a proposito
-- ("Biciletas", "esqui", "Snow Board", "Paddle surf ", "RUNNING"). Equivale al
-- `canon_category` del notebook: se busca por la clave en minusculas y sin espacios y,
-- si no esta en el mapa, se conserva el valor original para que el test
-- `accepted_values` lo detecte en lugar de esconderlo.

with source as (

    select * from {{ source('rental_raw', 'products_raw') }}

)

select
    trim(product_id)                                as product_id,

    case lower(trim(category))
        when 'bicicletas'  then 'Bicicletas'
        when 'biciletas'   then 'Bicicletas'
        when 'esqui'       then 'Esquí'
        when 'esquí'       then 'Esquí'
        when 'snowboard'   then 'Snowboard'
        when 'snow board'  then 'Snowboard'
        when 'paddle surf' then 'Paddle Surf'
        when 'kayak'       then 'Kayak'
        when 'camping'     then 'Camping'
        when 'escalada'    then 'Escalada'
        when 'running'     then 'Running'
        when 'fitness'     then 'Fitness'
        when 'raquetas'    then 'Raquetas'
        else trim(category)
    end                                             as category,

    trim(sport)                                     as sport,
    trim(product_name)                              as product_name,
    try_cast(purchase_price       as double)        as purchase_price,
    try_cast(replacement_cost     as double)        as replacement_cost,
    try_cast(maintenance_interval as int)           as maintenance_interval,
    try_cast(product_age          as double)        as product_age,
    try_cast(inventory_units      as int)           as inventory_units

from source
