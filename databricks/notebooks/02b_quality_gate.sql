-- Databricks notebook source

-- COMMAND ----------

-- MAGIC %md
-- MAGIC # Puerta de calidad · reglas de negocio antes de publicar los Data Marts
-- MAGIC
-- MAGIC > Generado desde `dbt/tests/`. Cada celda falla el Job si el test
-- MAGIC > devuelve alguna fila. **No editar a mano.**

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### Test: `assert_cleaned_rentals_business_rules`

-- COMMAND ----------

SELECT assert_true(
    (SELECT count(*) FROM (
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
from workspace.intermediate.int_rentals_cleaned
where (review_score     is not null and review_score     not between 1 and 5)
   or (rental_price     is not null and rental_price     not between 0.01 and 2000)
   or (rental_days      is not null and rental_days      not between 1 and 30)
   or (maintenance_cost is not null and maintenance_cost < 0)
   or (return_date      is not null and return_date < rental_date)
    )) = 0,
    'TEST FALLIDO · assert_cleaned_rentals_business_rules: hay filas que violan la regla'
) AS resultado;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### Test: `assert_revenue_only_on_completed`

-- COMMAND ----------

SELECT assert_true(
    (SELECT count(*) FROM (
-- Test singular: un alquiler cancelado NUNCA puede aportar ingresos.
-- Protege el KPI mas sensible del negocio (revenue) frente a un cambio futuro en la
-- definicion de `completed` o en el calculo de `revenue`.

select
    rental_id,
    cancelled,
    completed,
    rental_price,
    revenue
from workspace.intermediate.int_rentals_enriched
where cancelled and coalesce(revenue, 0) <> 0
    )) = 0,
    'TEST FALLIDO · assert_revenue_only_on_completed: hay filas que violan la regla'
) AS resultado;
