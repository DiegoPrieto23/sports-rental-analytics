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

from {{ ref('int_rentals_deduplicated') }}
