-- Databricks notebook source

-- COMMAND ----------

-- MAGIC %md
-- MAGIC # Capa INTERMEDIATE · deduplicacion, reglas de negocio y tabla de hechos
-- MAGIC
-- MAGIC > Generado automaticamente desde el proyecto dbt con
-- MAGIC > `python databricks/build_databricks_notebooks.py`.
-- MAGIC > **No editar a mano**: modifica el modelo dbt y regenera.

-- COMMAND ----------

CREATE SCHEMA IF NOT EXISTS workspace.intermediate;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `intermediate.int_rentals_deduplicated`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.intermediate.int_rentals_deduplicated AS
-- Resolucion de duplicados de `rental_id` en dos pasos (seccion 2.2 del notebook).
--
--   Caso A · fila 100% duplicada  -> misma PK y todas las columnas identicas.
--            Causa: doble carga / reintento del ETL. Se colapsa con SELECT DISTINCT:
--            es seguro porque no se pierde informacion.
--
--   Caso B · rental_id repetido con datos en conflicto -> colision de PK.
--            No se puede deduplicar sin criterio, asi que aplicamos una regla de
--            negocio explicita: nos quedamos con el registro MAS COMPLETO (menos
--            nulos) y, en empate, con el `rental_date` mas reciente. Ademas se
--            deberia escalar al equipo del sistema origen: senala un bug en la
--            generacion de identificadores.
--
-- Salida: exactamente una fila por `rental_id` (garantizado por el test `unique`).

with exact_deduplicated as (

    -- Caso A
    select distinct * from workspace.staging.stg_rentals

),

scored as (

    select
        *,
        -- Completitud del registro: numero de campos nulos (menos = mejor).
        (case when customer_id           is null then 1 else 0 end
       + case when product_id            is null then 1 else 0 end
       + case when store_id              is null then 1 else 0 end
       + case when rental_date           is null then 1 else 0 end
       + case when return_date           is null then 1 else 0 end
       + case when reservation_date      is null then 1 else 0 end
       + case when rental_days           is null then 1 else 0 end
       + case when reservation_lead_time is null then 1 else 0 end
       + case when review_score          is null then 1 else 0 end
       + case when rental_price          is null then 1 else 0 end
       + case when maintenance_cost      is null then 1 else 0 end
       + case when booking_channel       is null then 1 else 0 end
       + case when weather               is null then 1 else 0 end
       + case when season                is null then 1 else 0 end) as n_nulls
    from exact_deduplicated

),

ranked as (

    -- Caso B: desempate por regla de negocio.
    --
    -- Los dos primeros criterios (completitud y fecha) son la REGLA DE NEGOCIO.
    -- El resto de columnas se anaden para que el orden sea TOTAL y por tanto
    -- DETERMINISTA: hay 14 rental_id en los que ambos criterios empatan, y sin un
    -- desempate final el motor elige una fila u otra de forma arbitraria. Eso hace
    -- que los ingresos totales cambien entre ejecuciones (~68 EUR de oscilacion),
    -- que es inaceptable en un pipeline: dos `dbt build` seguidos deben producir
    -- exactamente las mismas tablas.
    select
        *,
        row_number() over (
            partition by rental_id
            order by
                -- Regla de negocio
                n_nulls               asc,
                rental_date           desc nulls last,
                -- Desempate determinista (orden arbitrario pero fijo)
                rental_price          desc nulls last,
                maintenance_cost      desc nulls last,
                review_score          desc nulls last,
                return_date           desc nulls last,
                reservation_date      desc nulls last,
                rental_days           desc nulls last,
                reservation_lead_time desc nulls last,
                customer_id           asc  nulls last,
                product_id            asc  nulls last,
                store_id              asc  nulls last,
                booking_channel       asc  nulls last,
                weather               asc  nulls last,
                season                asc  nulls last,
                cancelled             asc,
                late_return           asc,
                damage_reported       asc
        ) as row_priority
    from scored

)

select * except (n_nulls, row_priority)
from ranked
where row_priority = 1
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `intermediate.int_rentals_cleaned`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.intermediate.int_rentals_cleaned AS
-- Aplicacion de las reglas de validez de negocio (seccion 3.1 del notebook).
--
-- Criterio CONSERVADOR: preferimos anular un valor imposible (-> NULL) antes que
-- inventarlo, y no eliminamos la fila: el resto de sus campos sigue siendo valido y
-- util. Las filas solo se eliminan cuando aportan cero informacion (duplicados
-- exactos, ya resueltos en int_rentals_deduplicated).
--
--   review_score fuera de [1,5]      -> NULL   (puntuacion imposible)
--   rental_price <=0 o >2000         -> NULL   (outlier tecnico, distorsiona ingresos)
--   rental_days fuera de [1,30]      -> NULL   (duraciones tipo 999 = error de captura)
--   maintenance_cost < 0             -> NULL   (un coste no puede ser negativo)
--   return_date < rental_date        -> NULL + flag de trazabilidad
--
-- Se anaden ademas los flags de negocio `completed` y `has_invalid_return_date`.

select
    rental_id,
    customer_id,
    product_id,
    store_id,

    rental_date,
    case when return_date < rental_date then null else return_date end   as return_date,
    reservation_date,

    case when rental_days between 1 and 30 then rental_days end          as rental_days,
    reservation_lead_time,
    case when review_score between 1 and 5 then review_score end         as review_score,
    case when rental_price between 0.01 and 2000 then rental_price end   as rental_price,
    case when maintenance_cost >= 0 then maintenance_cost end            as maintenance_cost,

    cancelled,
    not cancelled                                                        as completed,
    late_return,
    damage_reported,

    booking_channel,
    weather,
    season,

    -- Trazabilidad de la limpieza: filas cuya cronologia era imposible.
    (return_date is not null and return_date < rental_date)              as has_invalid_return_date

from workspace.intermediate.int_rentals_deduplicated
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### `intermediate.int_rentals_enriched`

-- COMMAND ----------

CREATE OR REPLACE TABLE workspace.intermediate.int_rentals_enriched AS
-- Tabla de hechos enriquecida = el `fact` del notebook.
-- Modelo estrella desnormalizado (rentals + producto + tienda + cliente) mas las
-- metricas a nivel de alquiler. Es la unica tabla que consumen los Data Marts.
--
-- Reglas de negocio clave:
--   revenue -> solo los alquileres COMPLETADOS generan ingreso. Un cancelado no
--              entrega material, luego aporta 0 EUR; solo cuenta en cancellation_rate.
--              Si `rental_price` es NULL (nulo inyectado u outlier anulado) el revenue
--              queda NULL y las agregaciones lo ignoran, en lugar de contarlo como 0.
--   profit  -> ingreso menos coste de mantenimiento (mantenimiento imputado a 0 si falta).
--   margin  -> profit / revenue, indefinido cuando no hay ingreso.
--
-- Los JOIN son LEFT a proposito: ~2% de `store_id` viene a NULL y no queremos perder
-- esos alquileres (el ingreso es real aunque no sepamos la tienda).

with rentals as (

    select * from workspace.intermediate.int_rentals_cleaned

),

joined as (

    select
        r.*,

        -- Dimension producto
        p.category,
        p.sport,
        p.product_name,
        p.purchase_price,
        p.replacement_cost,
        p.maintenance_interval,
        p.product_age,
        p.inventory_units,

        -- Dimension tienda
        s.store_name,
        s.city                                                     as store_city,
        s.country                                                  as store_country,
        s.store_size,
        s.annual_visitors,

        -- Dimension cliente
        c.age                                                      as customer_age,
        c.gender                                                   as customer_gender,
        c.country                                                  as customer_country,
        c.city                                                     as customer_city,
        c.customer_segment,
        c.membership_level,
        c.signup_date,
        c.total_previous_rentals,

        -- Metricas a nivel de alquiler
        case when r.completed then r.rental_price else 0.0 end     as revenue,
        cast(date_trunc('MONTH', r.rental_date) as date)            as month

    from rentals r
    left join workspace.staging.stg_products  p on r.product_id  = p.product_id
    left join workspace.staging.stg_stores    s on r.store_id    = s.store_id
    left join workspace.staging.stg_customers c on r.customer_id = c.customer_id

)

select
    *,
    revenue - coalesce(maintenance_cost, 0)                                  as profit,
    case when revenue > 0
         then (revenue - coalesce(maintenance_cost, 0)) / revenue end        as margin,
    -- Precio por dia: la unidad realmente comparable entre categorias (neutraliza
    -- el mix de duraciones). Base del analisis de pricing dinamico.
    case when rental_days > 0 then rental_price / rental_days end            as price_per_day
from joined
;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### Control de volumetria de la capa

-- COMMAND ----------

SELECT 'int_rentals_deduplicated' AS objeto, COUNT(*) AS filas FROM workspace.intermediate.int_rentals_deduplicated
UNION ALL
SELECT 'int_rentals_cleaned' AS objeto, COUNT(*) AS filas FROM workspace.intermediate.int_rentals_cleaned
UNION ALL
SELECT 'int_rentals_enriched' AS objeto, COUNT(*) AS filas FROM workspace.intermediate.int_rentals_enriched
ORDER BY objeto;
