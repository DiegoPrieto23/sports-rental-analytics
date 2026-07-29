-- DATA MART · Metricas por CLIENTE (grano: 1 fila por customer_id).
-- Responde a: quien sostiene los ingresos y quien se esta enfriando.
--
--   clrv         = Customer Lifetime Rental Value: ingresos acumulados del cliente.
--   recency_days = dias entre su ultimo alquiler y el ultimo dia observado del dataset
--                  (no "hoy": el dataset tiene una ventana cerrada).
--
-- Los clientes sin ningun alquiler completado se conservan con metricas NULL: son
-- justo la poblacion objetivo de una campana de activacion.

with fact as (

    select * from {{ ref('int_rentals_enriched') }}

),

observation_window as (

    select max(rental_date) as last_observed_date from fact

),

completed as (

    select
        customer_id,
        sum(revenue)      as clrv,
        count(*)          as rentals,
        avg(rental_price) as avg_ticket,
        avg(review_score) as avg_review,
        min(rental_date)  as first_rental_date,
        max(rental_date)  as last_rental_date
    from fact
    where completed
    group by customer_id

),

cancellations as (

    select
        customer_id,
        avg(case when cancelled then 1.0 else 0.0 end) as cancellation_rate
    from fact
    group by customer_id

)

select
    c.customer_id,
    c.age,
    c.gender,
    c.country,
    c.city,
    c.customer_segment,
    c.membership_level,
    c.signup_date,
    c.total_previous_rentals,
    m.clrv,
    m.rentals,
    m.avg_ticket,
    m.avg_review,
    m.first_rental_date,
    m.last_rental_date,
    x.cancellation_rate,
    datediff(w.last_observed_date, m.last_rental_date)      as recency_days,
    cast(date_trunc('MONTH', m.first_rental_date) as date)  as cohort_month
from {{ ref('stg_customers') }} c
left join completed     m on c.customer_id = m.customer_id
left join cancellations x on c.customer_id = x.customer_id
cross join observation_window w
