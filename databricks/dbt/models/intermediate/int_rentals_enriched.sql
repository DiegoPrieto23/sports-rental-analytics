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

    select * from {{ ref('int_rentals_cleaned') }}

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
    left join {{ ref('stg_products') }}  p on r.product_id  = p.product_id
    left join {{ ref('stg_stores') }}    s on r.store_id    = s.store_id
    left join {{ ref('stg_customers') }} c on r.customer_id = c.customer_id

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
