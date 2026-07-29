-- DATA MART · Omnicanalidad (grano: 1 fila por canal de reserva).
-- Responde a: por que canal llega el negocio y donde hay mas friccion.
-- El bloque digital (Online + App) se marca aparte porque es la palanca sobre la que
-- se puede actuar con producto (recordatorios, prepago) para reducir cancelacion.

with fact as (

    select * from {{ ref('int_rentals_enriched') }}
    where booking_channel is not null

)

select
    booking_channel,
    booking_channel in ('Online', 'App')                 as is_digital,
    count(*)                                             as rentals_total,
    100.0 * count(*) / sum(count(*)) over ()             as share_pct,
    sum(case when completed then revenue end)            as revenue,
    avg(case when completed then rental_price end)       as avg_ticket,
    avg(case when cancelled then 1.0 else 0.0 end)       as cancellation_rate,
    avg(case when completed then review_score end)       as avg_review_score,
    avg(reservation_lead_time)                           as avg_lead_time_days
from fact
group by booking_channel
order by rentals_total desc
