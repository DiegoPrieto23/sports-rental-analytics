# Sports Rental — Dataset sintético

Dataset sintético del servicio de **alquiler de material deportivo** de
un retailer europeo. Generado con `generate_dataset.py` (semilla `42`,
100% reproducible). No contiene datos reales.

## Volumen

| Tabla | Filas | Descripción |
|-------|------:|-------------|
| `customers.csv` | 25,000 | Dimensión de clientes |
| `products.csv`  | 320 | Dimensión de productos alquilables |
| `stores.csv`    | 70 | Dimensión de tiendas europeas |
| `rentals.csv`   | 78,003 | **Tabla de hechos** de alquileres |

## Modelo de datos (esquema estrella)

```
customers ─┐
products  ─┼──<  rentals   (fact table)
stores    ─┘
```

`rentals` es la tabla de hechos; `customers`, `products` y `stores` son
dimensiones. Cardinalidades:

- **customers 1 — N rentals**: un cliente puede tener muchos alquileres.
- **products 1 — N rentals**: un producto se alquila muchas veces.
- **stores 1 — N rentals**: una tienda registra muchos alquileres.

### `customers`
`customer_id` (PK), `age`, `gender`, `country`, `city`, `customer_segment`
(Occasional/Regular/Frequent/VIP), `membership_level`
(Basic/Standard/Premium/Gold), `signup_date`, `total_previous_rentals`.

### `products`
`product_id` (PK), `category`, `sport`, `product_name`, `purchase_price`,
`replacement_cost`, `maintenance_interval` (días), `product_age` (años),
`inventory_units`.

### `stores`
`store_id` (PK), `store_name`, `city`, `country`, `store_size`
(Small/Medium/Large/Flagship), `annual_visitors`.

### `rentals`
`rental_id` (PK); FKs `customer_id`, `product_id`, `store_id`;
`rental_date`, `return_date`, `rental_days`, `reservation_date`,
`reservation_lead_time`, `cancelled`, `late_return`, `damage_reported`,
`review_score` (1-5), `booking_channel`, `rental_price`, `maintenance_cost`,
`weather`, `season`.

## Reglas de negocio incorporadas

- **Estacionalidad**: esquí/snowboard casi exclusivos de invierno; camping,
  kayak y paddle surf en verano; bicicletas en primavera/verano; running todo
  el año; fitness sube en invierno (indoor).
- **Temporalidad**: más reservas en fin de semana y festivos; picos de volumen
  en verano e invierno; crecimiento interanual del negocio.
- **Cliente**: Premium/Gold cancelan menos; frecuentes/VIP puntúan mejor y
  alquilan más a menudo.
- **Producto**: mayor antigüedad, duración e intensidad de uso -> más averías
  y más mantenimiento.
- **Devoluciones**: la probabilidad de retraso crece con la duración.
- **Precio dinámico**: `rental_price` depende de categoría, duración,
  temporada, país y demanda (fin de semana, festivo, tamaño de tienda,
  ciudad turística); con descuento por nivel de socio.
- **Canal**: predominan Online + App (jóvenes -> App; mayores -> tienda/teléfono).

## Calidad del dato (problemas introducidos a propósito)

~1% duplicados, ~2% de nulos por columna, fechas inconsistentes
(devolución < alquiler), reviews imposibles (fuera de 1-5), outliers de
precio/duración/coste, categorías mal escritas y texto con
mayúsculas/minúsculas/espacios inconsistentes. Pensado para practicar
limpieza y validación sin invalidar el conjunto.

## KPIs de ejemplo

- **Ingresos**: total y por categoría / país / temporada / canal.
- **Tasa de cancelación** = cancelados / total; segmentada por membership.
- **Tasa de devolución tardía** y **tasa de averías**.
- **Ticket medio** (`rental_price`) y **duración media** por categoría.
- **Ratio de mantenimiento** = `maintenance_cost` / `rental_price`.
- **Rentabilidad de producto**: ingresos acumulados vs `purchase_price`.
- **Satisfacción**: `review_score` medio por categoría / tienda / segmento.
- **Índice de estacionalidad** por categoría (demanda pico vs valle).
- **Rotación de inventario** = alquileres / `inventory_units`.
- **Valor de cliente**: ingresos y frecuencia por `customer_segment`.

> Nota: limpiar los problemas de calidad (duplicados, nulos, outliers,
> fechas y reviews imposibles) antes de calcular los KPIs.
