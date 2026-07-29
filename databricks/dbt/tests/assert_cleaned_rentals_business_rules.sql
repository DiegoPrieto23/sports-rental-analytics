-- Test singular: tras la capa intermediate NO puede quedar ninguna fila que viole
-- las reglas de validez de negocio. Si esta consulta devuelve filas, el pipeline
-- falla y los Data Marts no se publican.

select
    rental_id,
    review_score,
    rental_price,
    rental_days,
    maintenance_cost,
    rental_date,
    return_date
from {{ ref('int_rentals_cleaned') }}
where (review_score     is not null and review_score     not between 1 and 5)
   or (rental_price     is not null and rental_price     not between 0.01 and 2000)
   or (rental_days      is not null and rental_days      not between 1 and 30)
   or (maintenance_cost is not null and maintenance_cost < 0)
   or (return_date      is not null and return_date < rental_date)
