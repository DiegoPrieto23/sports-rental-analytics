-- Databricks notebook source

-- COMMAND ----------

-- MAGIC %md
-- MAGIC # Capa STAGING · casting, renombrado y estandarizacion (1:1 con la fuente)
-- MAGIC
-- MAGIC > Generado automaticamente desde el proyecto dbt con
-- MAGIC > `python databricks/build_databricks_notebooks.py`.
-- MAGIC > **No editar a mano**: modifica el modelo dbt y regenera.

-- COMMAND ----------

CREATE SCHEMA IF NOT EXISTS workspace.staging;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `staging.stg_rentals`

-- COMMAND ----------

CREATE OR REPLACE VIEW workspace.staging.stg_rentals AS
-- Staging: 1:1 con la fuente. No se pierden filas ni se corrigen valores de negocio.
-- Solo casting, renombrado y estandarizacion de texto.
--
-- `try_cast` es deliberado: la ingesta por UI puede inferir los tipos correctamente
-- (date/boolean/double) o dejarlos como STRING. `try_cast` funciona en ambos casos y
-- ademas no rompe el pipeline si aparece un valor no parseable (devuelve NULL).
-- `initcap(trim(x))` replica el `standardize_text` del notebook (.str.strip().str.title()).

with source as (

    select * from workspace.staging.rentals_raw

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
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `staging.stg_products`

-- COMMAND ----------

CREATE OR REPLACE VIEW workspace.staging.stg_products AS
-- Staging de la dimension de productos.
-- Normaliza `category` al catalogo canonico: el generador inyecta erratas a proposito
-- ("Biciletas", "esqui", "Snow Board", "Paddle surf ", "RUNNING"). Equivale al
-- `canon_category` del notebook: se busca por la clave en minusculas y sin espacios y,
-- si no esta en el mapa, se conserva el valor original para que el test
-- `accepted_values` lo detecte en lugar de esconderlo.

with source as (

    select * from workspace.staging.products_raw

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
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `staging.stg_stores`

-- COMMAND ----------

CREATE OR REPLACE VIEW workspace.staging.stg_stores AS
-- Staging de la dimension de tiendas.
-- `country` llega con casing inconsistente ("ESPAÑA", " francia") en ~5% de las filas.

with source as (

    select * from workspace.staging.stores_raw

)

select
    trim(store_id)                        as store_id,
    trim(store_name)                      as store_name,
    trim(city)                            as city,
    initcap(trim(country))                as country,
    trim(store_size)                      as store_size,
    try_cast(annual_visitors as bigint)   as annual_visitors

from source
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `staging.stg_customers`

-- COMMAND ----------

CREATE OR REPLACE VIEW workspace.staging.stg_customers AS
-- Staging de la dimension de clientes.
-- `country` y `gender` llegan con casing/espacios inconsistentes en ~2% de las filas.
-- Nota: `membership_level` usa el literal "Basic" (nunca "None") a proposito, porque
-- muchos lectores parsean la cadena "None" como NULL y perderiamos el grupo entero.

with source as (

    select * from workspace.staging.customers_raw

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
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### Control de volumetria de la capa

-- COMMAND ----------

SELECT 'stg_rentals' AS objeto, COUNT(*) AS filas FROM workspace.staging.stg_rentals
UNION ALL
SELECT 'stg_products' AS objeto, COUNT(*) AS filas FROM workspace.staging.stg_products
UNION ALL
SELECT 'stg_stores' AS objeto, COUNT(*) AS filas FROM workspace.staging.stg_stores
UNION ALL
SELECT 'stg_customers' AS objeto, COUNT(*) AS filas FROM workspace.staging.stg_customers
ORDER BY objeto;
