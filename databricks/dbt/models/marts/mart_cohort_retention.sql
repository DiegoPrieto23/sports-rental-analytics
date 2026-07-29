-- DATA MART · Retencion por cohorte (grano: cohorte x mes de vida).
-- Agrupa a los clientes por el mes de su PRIMER alquiler y sigue que porcentaje
-- sigue activo N meses despues. Separa el efecto "cuando entro el cliente" del
-- efecto "cuanto tiempo lleva", y revela si el negocio fideliza o gotea.
--
-- Lectura de negocio esperada: el alquiler es una compra puntual, no una
-- suscripcion, asi que la retencion mes a mes es baja pero REAPARECE de forma
-- estacional (el cliente de esqui vuelve el invierno siguiente).

with fact as (

    select customer_id, month
    from {{ ref('int_rentals_enriched') }}
    where customer_id is not null and month is not null

),

cohorts as (

    select customer_id, min(month) as cohort_month
    from fact
    group by customer_id

),

activity as (

    select
        c.cohort_month,
        f.month                                                   as activity_month,
        f.customer_id,
        cast(months_between(f.month, c.cohort_month) as int)       as months_since_first_rental
    from fact f
    join cohorts c on f.customer_id = c.customer_id

),

cohort_sizes as (

    select cohort_month, count(distinct customer_id) as cohort_size
    from activity
    group by cohort_month

)

select
    a.cohort_month,
    a.months_since_first_rental,
    s.cohort_size,
    count(distinct a.customer_id)                                  as active_customers,
    100.0 * count(distinct a.customer_id) / s.cohort_size          as retention_pct
from activity a
join cohort_sizes s on a.cohort_month = s.cohort_month
group by a.cohort_month, a.months_since_first_rental, s.cohort_size
order by a.cohort_month, a.months_since_first_rental
