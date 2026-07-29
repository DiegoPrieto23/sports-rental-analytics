-- DATA MART · Pricing dinamico: precio por dia segun categoria y temporada.
-- (grano: 1 fila por categoria x temporada)
--
-- Usamos la MEDIANA del precio POR DIA, no el ticket total: neutraliza el mix de
-- duraciones y hace comparables categorias que se alquilan 2 dias con otras que se
-- alquilan 10. La mediana ademas resiste los outliers residuales mejor que la media.
--
--   seasonal_spread_pct -> (max/min entre temporadas - 1) x 100 para la categoria.
--                          Alto  = ya se captura el premium de escasez estacional.
--                          Bajo  = o la demanda es aseasonal, o hay poder de precio
--                                  sin explotar.
--   Es precio OBSERVADO, no elasticidad: dice lo que se cobra, no como responderia
--   la demanda. Fijar el precio optimo exige experimentar (test A/B).

with fact as (

    select * from {{ ref('int_rentals_enriched') }}

),

base as (

    select category, season, price_per_day, rental_price
    from fact
    where completed
      and price_per_day is not null
      and category is not null
      and season is not null

),

aggregated as (

    select
        category,
        season,
        count(*)                                                    as rentals,
        percentile_cont(0.50) within group (order by price_per_day)  as median_price_per_day,
        avg(price_per_day)                                          as avg_price_per_day,
        avg(rental_price)                                           as avg_ticket
    from base
    group by category, season

)

select
    category,
    season,
    rentals,
    median_price_per_day,
    avg_price_per_day,
    avg_ticket,
    -- Peso de cada temporada en el volumen anual de la categoria: mide la
    -- estacionalidad estructural (esqui ~100% invierno, kayak ~verano).
    100.0 * rentals / sum(rentals) over (partition by category)      as season_volume_share_pct,
    100.0 * (max(median_price_per_day) over (partition by category)
             / nullif(min(median_price_per_day) over (partition by category), 0) - 1)
                                                                     as seasonal_spread_pct
from aggregated
order by category, season
