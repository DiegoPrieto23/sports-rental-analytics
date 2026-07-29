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
    select distinct * from {{ ref('stg_rentals') }}

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
