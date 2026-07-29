# Databricks notebook source
# MAGIC %md
# MAGIC # 🏷️ Sports Rental — Análisis de negocio del alquiler deportivo
# MAGIC
# MAGIC **Equipo de Datos e IA · Analytics Engineering**
# MAGIC _Notebook de análisis sobre el Lakehouse. Consume las tablas Gold publicadas por el pipeline dbt._
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## 1. Introducción
# MAGIC
# MAGIC ### 1.1 Contexto de negocio
# MAGIC La compañía opera un servicio de **alquiler de material deportivo** (*Rental*) en siete
# MAGIC mercados europeos (España, Francia, Italia, Alemania, Portugal, Bélgica y Países Bajos).
# MAGIC El cliente reserva un producto —bicicletas, esquís, kayaks, material de camping...— en
# MAGIC una tienda, lo utiliza durante un número de días y lo devuelve. El modelo permite a
# MAGIC la compañía **monetizar el inventario de forma recurrente** y captar clientes que no
# MAGIC quieren comprar, pero exige gestionar bien tres palancas: **ocupación del inventario**,
# MAGIC **precio** y **coste de mantenimiento**.
# MAGIC
# MAGIC Este análisis se dirige a los responsables de **negocio y producto** del área de Rental.
# MAGIC No es un ejercicio académico: el objetivo es **detectar dónde estamos dejando dinero
# MAGIC sobre la mesa** y proponer decisiones accionables y priorizadas por impacto.
# MAGIC
# MAGIC ### 1.2 Objetivos
# MAGIC 1. Establecer una **base de confianza en el dato** (Data Quality) antes de decidir nada.
# MAGIC 2. Cuantificar el rendimiento del negocio con un **catálogo de KPIs** homogéneo.
# MAGIC 3. Identificar **producto infrautilizado y saturado** para redistribuir inventario.
# MAGIC 4. Entender los **drivers de precio, cancelación y satisfacción** con estadística.
# MAGIC 5. Traducir todo en **recomendaciones** de pricing, mantenimiento, inventario y campañas.
# MAGIC
# MAGIC ### 1.3 Hipótesis de partida
# MAGIC - **H1 — Estacionalidad extrema:** algunas categorías (esquí, camping) concentran casi
# MAGIC   toda su demanda en una estación, generando inventario ocioso el resto del año.
# MAGIC - **H2 — Ocupación desigual:** una minoría de referencias soporta la mayoría de los
# MAGIC   alquileres (Pareto), mientras otras apenas rotan.
# MAGIC - **H3 — Fidelización protege ingresos:** los socios Premium/Gold cancelan menos y
# MAGIC   puntúan mejor, por lo que aumentan el ingreso esperado por reserva.
# MAGIC - **H4 — El envejecimiento del producto encarece el mantenimiento** y deteriora la
# MAGIC   satisfacción (averías → peores reviews).
# MAGIC - **H5 — El precio responde a temporada, país y demanda**, no es plano.
# MAGIC
# MAGIC ### 1.4 KPIs del análisis
# MAGIC | KPI | Definición | Palanca |
# MAGIC |-----|------------|---------|
# MAGIC | Occupancy Rate | días alquilados / (unidades × días periodo) | Inventario |
# MAGIC | Utilization | nº alquileres / unidades de inventario | Inventario |
# MAGIC | Revenue per Inventory Unit | ingresos / unidades | Inventario / Pricing |
# MAGIC | Gross Profit | ingresos − mantenimiento | Rentabilidad |
# MAGIC | Margin | profit / ingresos | Rentabilidad |
# MAGIC | Maintenance Ratio | mantenimiento / ingresos | Coste |
# MAGIC | Cancellation Rate | cancelados / total | Comercial |
# MAGIC | Late Return Rate | devoluciones tardías / completados | Operaciones |
# MAGIC | Damage Rate | averías / completados | Calidad |
# MAGIC | Customer Lifetime Rental Value (CLRV) | ingresos acumulados por cliente | Marketing |
# MAGIC
# MAGIC ### 1.5 Arquitectura: de dónde sale este dato
# MAGIC
# MAGIC Este notebook **no transforma nada**. Toda la lógica de limpieza y cálculo de métricas
# MAGIC vive en un proyecto **dbt** versionado y testeado que publica las tablas del Lakehouse:
# MAGIC
# MAGIC ```
# MAGIC staging.*_raw  ──►  staging.stg_*  ──►  intermediate.int_*  ──►  marts.mart_*
# MAGIC   (crudo)           (casting)          (reglas negocio)        (métricas)   ◄── este notebook
# MAGIC ```
# MAGIC
# MAGIC Cada KPI se define **una sola vez** en un modelo dbt, con 46 tests que rompen el
# MAGIC pipeline si algo se desvía. Si un número de este notebook no cuadra con el dashboard,
# MAGIC es un bug del pipeline, no una interpretación distinta: **hay una única verdad**.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Conexión al Lakehouse
# MAGIC
# MAGIC Cargamos las tablas Gold y las registramos como vistas temporales para poder alternar
# MAGIC libremente entre **PySpark** (transformaciones, ventanas, pivots) y **SQL** (rankings y
# MAGIC agregaciones, donde es mucho más legible).

# COMMAND ----------

# MAGIC %pip install statsmodels scikit-learn plotly --quiet

# COMMAND ----------

# `%pip install` instala en el entorno del notebook, pero el intérprete de Python ya
# estaba arrancado: hay que reiniciarlo para que vea los paquetes nuevos. Esta celda
# corta la ejecución, así que al pulsar "Run all" Databricks la reanuda sola desde aquí.
dbutils.library.restartPython()

# COMMAND ----------

# --- Librerías del stack analítico ---
import warnings

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.express as px
import scipy.stats as stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.stats.proportion import proportions_ztest, proportion_confint

from pyspark.sql import functions as F
from pyspark.sql import Window

warnings.filterwarnings("ignore")
pd.set_option("display.max_columns", 60)
pd.set_option("display.float_format", lambda v: f"{v:,.2f}")
sns.set_theme(style="whitegrid", palette="deep")
plt.rcParams["figure.figsize"] = (11, 5)
plt.rcParams["axes.titlesize"] = 13
plt.rcParams["axes.titleweight"] = "bold"

# Paleta corporativa (azul corporativo) para dar coherencia visual.
BRAND_BLUE = "#0082C3"
BRAND_ACCENT = ["#0082C3", "#3643BA", "#FF6F00", "#00A17E", "#E3262F", "#7A5AF8"]

print("Stack cargado:", f"pandas {pd.__version__} · numpy {np.__version__}")
print("Spark:", spark.version)

# COMMAND ----------

# --- Catálogo parametrizable: cambia el widget si tu catálogo no es `workspace` ---
dbutils.widgets.text("catalog", "workspace", "Catálogo de Unity Catalog")
CATALOG = dbutils.widgets.get("catalog")

# Registramos las tablas del Lakehouse como vistas temporales con los MISMOS nombres
# cortos que usaba el análisis local. Así las celdas %sql quedan idénticas y el notebook
# es portable entre entornos: solo cambia esta celda.
TABLES = {
    # Tabla de hechos enriquecida (grano: 1 alquiler)
    "fact": f"{CATALOG}.intermediate.int_rentals_enriched",
    # Data Marts (grano agregado)
    "global_kpis": f"{CATALOG}.marts.mart_global_kpis",
    "product_metrics": f"{CATALOG}.marts.mart_product_metrics",
    "store_metrics": f"{CATALOG}.marts.mart_store_metrics",
    "customer_metrics": f"{CATALOG}.marts.mart_customer_metrics",
    "category_performance": f"{CATALOG}.marts.mart_category_performance",
    "monthly_revenue": f"{CATALOG}.marts.mart_monthly_revenue",
    "pricing_by_season": f"{CATALOG}.marts.mart_pricing_by_season",
    "channel_performance": f"{CATALOG}.marts.mart_channel_performance",
    "cohort_retention": f"{CATALOG}.marts.mart_cohort_retention",
    "data_quality": f"{CATALOG}.marts.mart_data_quality",
    # Tablas crudas: SOLO LECTURA, para el diagnóstico de calidad de la sección 3
    "rentals_raw": f"{CATALOG}.staging.rentals_raw",
    "customers_raw": f"{CATALOG}.staging.customers_raw",
    "products_raw": f"{CATALOG}.staging.products_raw",
    "stores_raw": f"{CATALOG}.staging.stores_raw",
}

for alias, fqn in TABLES.items():
    spark.table(fqn).createOrReplaceTempView(alias)

fact = spark.table(TABLES["fact"])
print(f"Catálogo: {CATALOG}")
print(f"Vistas registradas: {', '.join(TABLES)}")
print(f"\nTabla de hechos: {fact.count():,} filas × {len(fact.columns)} columnas")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 2.1 Validación de claves primarias y foráneas
# MAGIC
# MAGIC En el notebook local esta comprobación era **exploratoria**: había que descubrir si el
# MAGIC modelo relacional aguantaba. Aquí ya no es una pregunta abierta — el pipeline ejecuta
# MAGIC en cada build los tests `unique`, `not_null` y `relationships`, y **si fallan no se
# MAGIC publican los marts**. Lo que sigue no es una exploración: es la **evidencia** de que
# MAGIC la garantía se está cumpliendo sobre el dato que estamos a punto de analizar.

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Integridad del modelo estrella verificada sobre la tabla de hechos publicada.
# MAGIC -- Los tres huérfanos deben ser 0 y la PK debe ser única.
# MAGIC SELECT
# MAGIC     COUNT(*)                                                    AS filas,
# MAGIC     COUNT(DISTINCT rental_id)                                   AS rental_id_unicos,
# MAGIC     COUNT(*) - COUNT(DISTINCT rental_id)                        AS pk_duplicadas,
# MAGIC     SUM(CASE WHEN product_id  IS NOT NULL AND category   IS NULL THEN 1 ELSE 0 END) AS huerfanos_producto,
# MAGIC     SUM(CASE WHEN store_id    IS NOT NULL AND store_name IS NULL THEN 1 ELSE 0 END) AS huerfanos_tienda,
# MAGIC     SUM(CASE WHEN customer_id IS NOT NULL AND customer_segment IS NULL THEN 1 ELSE 0 END) AS huerfanos_cliente,
# MAGIC     SUM(CASE WHEN store_id IS NULL THEN 1 ELSE 0 END)           AS store_id_nulos
# MAGIC FROM fact

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Lectura:** `rental_id` es único y no hay ninguna FK huérfana: cuando el
# MAGIC > `store_id` existe, siempre apunta a una tienda válida. Los `store_id` nulos que
# MAGIC > quedan son **nulos de origen** (~2 % de los alquileres llegan sin tienda asignada),
# MAGIC > no un fallo de integridad: el alquiler y su ingreso son reales aunque no sepamos
# MAGIC > dónde se registró, así que el pipeline los conserva con un `LEFT JOIN` en lugar de
# MAGIC > perderlos.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Data Quality Assessment
# MAGIC
# MAGIC Un dato en el que no confiamos produce decisiones en las que no podemos confiar.
# MAGIC
# MAGIC Esta sección mira las tablas **crudas** (`*_raw`) en **solo lectura**: es el retrato de
# MAGIC lo que *entra* al sistema, que es lo que hay que vigilar y reclamar al equipo productor.
# MAGIC No limpiamos nada aquí — la limpieza es responsabilidad del pipeline, y medirla sobre
# MAGIC la capa ya limpia daría 100 % por construcción y no informaría de nada.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 3.1 Completitud — ¿qué falta?

# COMMAND ----------

# --- Perfilado de nulos con PySpark: una sola pasada sobre la tabla ---
# Construimos dinámicamente una agregación por columna en lugar de escribir 18 SUM a mano.
# Es el patrón que se generaliza a cualquier tabla, tenga 18 columnas o 300.
raw_rentals = spark.table(TABLES["rentals_raw"])
n_raw = raw_rentals.count()

null_counts = (raw_rentals
               .select([F.sum(F.col(c).isNull().cast("int")).alias(c)
                        for c in raw_rentals.columns])
               .collect()[0].asDict())

missing = (pd.DataFrame({"columna": list(null_counts), "n_missing": list(null_counts.values())})
           .assign(pct_missing=lambda d: (100 * d.n_missing / n_raw).round(2))
           .query("n_missing > 0")
           .sort_values("pct_missing", ascending=False))

print(f"rentals_raw: {n_raw:,} filas")
display(missing)

# COMMAND ----------

# MAGIC %md
# MAGIC ### 3.2 Unicidad — duplicados de PK: ¿fila completa o solo la clave?
# MAGIC
# MAGIC *"PK duplicada"* esconde **dos problemas distintos** que se tratan de forma diferente:
# MAGIC
# MAGIC | Caso | Qué es | Causa típica | Qué hace el pipeline |
# MAGIC |------|--------|--------------|----------------------|
# MAGIC | **A · Fila 100 % duplicada** | Mismo `rental_id` **y** todas las columnas idénticas | Doble carga / reintento del ETL | **Deduplicar** con `SELECT DISTINCT`. Es seguro: no se pierde información |
# MAGIC | **B · `rental_id` repetido con datos en conflicto** | Mismo `rental_id` pero alguna columna difiere | Colisión de PK: dos eventos heredaron el mismo id, o un `UPDATE` mal aplicado | **Regla de negocio**: conservar el registro más completo (menos nulos) y, en empate, el `rental_date` más reciente. Y **escalar al equipo origen**, porque señala un bug en la generación de identificadores |

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Cuantificamos ambos casos sobre el dato crudo.
# MAGIC WITH exactas AS (
# MAGIC     SELECT COUNT(*) AS filas, COUNT(*) - COUNT(DISTINCT rental_id) AS pk_repetidas
# MAGIC     FROM rentals_raw
# MAGIC ),
# MAGIC distintas AS (
# MAGIC     SELECT COUNT(*) AS filas_distintas FROM (SELECT DISTINCT * FROM rentals_raw)
# MAGIC )
# MAGIC SELECT
# MAGIC     e.filas                                       AS filas_crudas,
# MAGIC     e.filas - d.filas_distintas                   AS caso_a_filas_identicas,
# MAGIC     e.pk_repetidas - (e.filas - d.filas_distintas) AS caso_b_conflicto_pk,
# MAGIC     e.pk_repetidas                                AS total_pk_repetidas
# MAGIC FROM exactas e CROSS JOIN distintas d

# COMMAND ----------

# MAGIC %md
# MAGIC ### 3.3 Validez — valores imposibles según las reglas de negocio

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Cada regla es una condición de negocio que el dato crudo incumple.
# MAGIC -- El pipeline las aplica anulando el valor imposible (nunca inventándolo).
# MAGIC SELECT 'review_score fuera de [1,5]' AS regla,
# MAGIC        SUM(CASE WHEN review_score IS NOT NULL
# MAGIC                  AND review_score NOT BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS n_filas
# MAGIC FROM rentals_raw
# MAGIC UNION ALL SELECT 'rental_price <= 0 o > 2000 (outlier)',
# MAGIC        SUM(CASE WHEN rental_price IS NOT NULL
# MAGIC                  AND rental_price NOT BETWEEN 0.01 AND 2000 THEN 1 ELSE 0 END) FROM rentals_raw
# MAGIC UNION ALL SELECT 'rental_days fuera de [1,30]',
# MAGIC        SUM(CASE WHEN rental_days NOT BETWEEN 1 AND 30 THEN 1 ELSE 0 END) FROM rentals_raw
# MAGIC UNION ALL SELECT 'maintenance_cost negativo',
# MAGIC        SUM(CASE WHEN maintenance_cost < 0 THEN 1 ELSE 0 END) FROM rentals_raw
# MAGIC UNION ALL SELECT 'return_date < rental_date',
# MAGIC        SUM(CASE WHEN return_date IS NOT NULL
# MAGIC                  AND return_date < rental_date THEN 1 ELSE 0 END) FROM rentals_raw
# MAGIC UNION ALL SELECT 'reservation_date > rental_date',
# MAGIC        SUM(CASE WHEN reservation_date > rental_date THEN 1 ELSE 0 END) FROM rentals_raw
# MAGIC ORDER BY n_filas DESC

# COMMAND ----------

# MAGIC %md
# MAGIC ### 3.4 Consistencia — categorías mal escritas
# MAGIC
# MAGIC El mismo concepto de negocio escrito de varias formas duplica categorías en cualquier
# MAGIC agregación: `esqui`, `Esquí` y `ESQUI` serían tres deportes distintos en un dashboard.

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Categorías del catálogo crudo que NO están en el catálogo canónico.
# MAGIC SELECT category AS categoria_cruda, COUNT(*) AS n_productos
# MAGIC FROM products_raw
# MAGIC WHERE TRIM(category) NOT IN (
# MAGIC     'Bicicletas', 'Esquí', 'Snowboard', 'Paddle Surf', 'Kayak',
# MAGIC     'Camping', 'Escalada', 'Running', 'Fitness', 'Raquetas')
# MAGIC GROUP BY category
# MAGIC ORDER BY n_productos DESC

# COMMAND ----------

# --- Texto inconsistente en la tabla de hechos: mayúsculas y espacios sobrantes ---
# El canal de reserva llega con hasta 5 variantes del mismo valor. Comparamos el crudo
# con lo que produce la capa staging tras `initcap(trim(...))`.
crudos = (spark.table(TABLES["rentals_raw"])
          .groupBy("booking_channel").count()
          .orderBy(F.desc("count")))
print(f"Variantes distintas de booking_channel en crudo: {crudos.count()}")
display(crudos)

# COMMAND ----------

# MAGIC %md
# MAGIC ### 3.5 Distribución — outliers por regla de Tukey (1.5 · IQR)

# COMMAND ----------

# --- Outliers con percentiles aproximados de Spark (escala a cualquier volumen) ---
# approxQuantile evita ordenar toda la tabla: usa un algoritmo de streaming con error
# acotado. En 78k filas da igual, pero es el patrón correcto cuando son 78 millones.
outlier_rows = []
for col in ["rental_price", "rental_days", "maintenance_cost", "reservation_lead_time"]:
    q1, q3 = raw_rentals.approxQuantile(col, [0.25, 0.75], 0.001)
    iqr = q3 - q1
    low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    n_out = raw_rentals.filter((F.col(col) < low) | (F.col(col) > high)).count()
    n_val = raw_rentals.filter(F.col(col).isNotNull()).count()
    outlier_rows.append({"variable": col, "q1": round(q1, 2), "q3": round(q3, 2),
                         "limite_inf": round(low, 2), "limite_sup": round(high, 2),
                         "n_outliers": n_out, "pct_outliers": round(100 * n_out / n_val, 2)})

display(pd.DataFrame(outlier_rows))

# COMMAND ----------

# MAGIC %md
# MAGIC ### 3.6 Data Trust Score
# MAGIC
# MAGIC Condensamos las cuatro dimensiones en un índice **0–100** interpretable. No lo
# MAGIC recalculamos aquí: lo lee del mart `mart_data_quality`, donde está definido una sola
# MAGIC vez. Así el número del notebook, el del dashboard y el de la alerta automática son
# MAGIC **necesariamente el mismo**.

# COMMAND ----------

dq = spark.table(TABLES["data_quality"]).orderBy("dimension_order").toPandas()
score = float(dq["data_trust_score"].iloc[0])

fig, ax = plt.subplots(figsize=(9, 4))
bars = ax.barh(dq["dimension"], dq["score_pct"], color=BRAND_BLUE)
ax.bar_label(bars, fmt="%.1f%%", padding=4)
ax.set_xlim(0, 105)
ax.set_title(f"Data Trust Score global: {score:.1f}/100")
ax.set_xlabel("% de cumplimiento por dimensión")
ax.axvline(95, color="grey", ls="--", lw=1)
plt.tight_layout()
plt.show()

print(f"\n🔎 Data Trust Score = {score:.2f}/100")
display(dq[["dimension", "score_pct", "weight", "weighted_contribution"]])

# COMMAND ----------

# MAGIC %md
# MAGIC ### 3.7 Decisiones de limpieza (implementadas en el pipeline)
# MAGIC
# MAGIC Cada problema detectado arriba tiene una decisión explícita y versionada. El criterio
# MAGIC general es **conservador**: preferimos anular un valor imposible (→ `NULL`) a inventar
# MAGIC uno, y solo eliminamos filas cuando aportan cero información (duplicados exactos).
# MAGIC
# MAGIC | Problema | Decisión | Dónde vive | Justificación |
# MAGIC |----------|----------|------------|---------------|
# MAGIC | Filas duplicadas exactas | **Eliminar** | `int_rentals_deduplicated` | Doble conteo de ingresos y alquileres |
# MAGIC | `rental_id` repetido en conflicto | **Regla de negocio** (más completo → más reciente) | `int_rentals_deduplicated` | No se puede deduplicar sin criterio |
# MAGIC | `review_score` ∉ [1,5] | → `NULL` | `int_rentals_cleaned` | Puntuación imposible; no descartamos la fila |
# MAGIC | `rental_price` ≤0 o >2000 | → `NULL` | `int_rentals_cleaned` | Outlier técnico; distorsiona ingresos |
# MAGIC | `rental_days` ∉ [1,30] | → `NULL` | `int_rentals_cleaned` | Duraciones tipo 999 son errores de captura |
# MAGIC | `maintenance_cost` < 0 | → `NULL` | `int_rentals_cleaned` | Un coste no puede ser negativo |
# MAGIC | `return_date` < `rental_date` | → `NULL` + flag | `int_rentals_cleaned` | Cronología imposible; se marca para trazabilidad |
# MAGIC | Categorías mal escritas | **Normalizar** a catálogo | `stg_products` | `esqui`, `Snow Board`… → valor canónico |
# MAGIC | Texto (canal, país, género) | **Estandarizar** (`initcap(trim())`) | `stg_*` | Evita duplicar categorías por mayúsculas/espacios |
# MAGIC | Alquileres **cancelados** | **Excluir** de ingresos/ocupación | `int_rentals_enriched` | No hay entrega de material; solo cuentan en `cancellation_rate` |
# MAGIC
# MAGIC > **Un matiz importante sobre la deduplicación:** hay 14 `rental_id` en los que las dos
# MAGIC > filas empatan en los dos criterios de la regla (mismo número de nulos y misma fecha).
# MAGIC > La elección entre ellas es arbitraria, así que el modelo ordena además por el resto
# MAGIC > de columnas para que el orden sea **total y determinista**. Sin eso, cada ejecución
# MAGIC > devolvía un total de ingresos ligeramente distinto (~68 € sobre 5,4 M).

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Catálogo de métricas (Data Marts)
# MAGIC
# MAGIC Las definiciones de KPI viven en los modelos dbt, no aquí. Este notebook las **consume**.
# MAGIC Es la semilla de un *semantic layer*: cambiar la definición de Occupancy o CLRV se hace
# MAGIC en un sitio y se propaga a SQL, BI y notebooks a la vez.

# COMMAND ----------

# --- Cuadro de mando global ---
kpis = spark.table(TABLES["global_kpis"]).toPandas().iloc[0]

resumen = pd.Series({
    "Alquileres (total)": f"{kpis['rentals_total']:,.0f}",
    "Alquileres completados": f"{kpis['rentals_completed']:,.0f}",
    "Ingresos totales (€)": f"{kpis['revenue_eur']:,.0f}",
    "Ticket medio (€)": f"{kpis['avg_ticket_eur']:,.2f}",
    "Duración media (días)": f"{kpis['avg_rental_days']:,.2f}",
    "Cancellation Rate": f"{kpis['cancellation_rate']:.2%}",
    "Late Return Rate": f"{kpis['late_return_rate']:.2%}",
    "Damage Rate": f"{kpis['damage_rate']:.2%}",
    "Review media": f"{kpis['avg_review_score']:.2f}",
    "Maintenance Ratio": f"{kpis['maintenance_ratio']:.2%}",
    "Margen bruto": f"{kpis['gross_margin']:.2%}",
    "Clientes activos": f"{kpis['active_customers']:,.0f}",
    "Ventana observada": f"{kpis['first_rental_date']} → {kpis['last_rental_date']} "
                         f"({kpis['period_days']:,.0f} días)",
})
print("📊 Cuadro de mando global (KPIs):")
display(resumen.to_frame("valor"))

# COMMAND ----------

# MAGIC %md
# MAGIC #### Cómo se calculan: ocupación y rotación de inventario
# MAGIC
# MAGIC El mart `mart_product_metrics` clasifica cada referencia por **cuartiles de ocupación**.
# MAGIC No lo recalculamos —usaríamos el mismo dato dos veces con riesgo de divergir— pero sí
# MAGIC merece ver la técnica, porque el patrón *"agregar → calcular percentiles globales →
# MAGIC clasificar cada fila contra ellos"* se repite en todo el análisis de inventario:
# MAGIC
# MAGIC ```sql
# MAGIC WITH periodo AS (SELECT DATEDIFF(MAX(rental_date), MIN(rental_date)) AS dias FROM fact),
# MAGIC metricas AS (
# MAGIC     SELECT product_id,
# MAGIC            SUM(rental_days) / (inventory_units * dias) AS occupancy_rate
# MAGIC     FROM fact WHERE completed GROUP BY product_id, inventory_units
# MAGIC ),
# MAGIC cuartiles AS (
# MAGIC     SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY occupancy_rate) AS q1,
# MAGIC            percentile_cont(0.75) WITHIN GROUP (ORDER BY occupancy_rate) AS q3
# MAGIC     FROM metricas
# MAGIC )
# MAGIC SELECT *, CASE WHEN occupancy_rate <= q1 THEN 'Infrautilizado'
# MAGIC                WHEN occupancy_rate >= q3 THEN 'Saturado'
# MAGIC                ELSE 'Normal' END AS rotation_class
# MAGIC FROM metricas CROSS JOIN cuartiles
# MAGIC ```

# COMMAND ----------

# --- Resumen de ocupación y rentabilidad por categoría (desde el mart) ---
display(spark.table(TABLES["category_performance"])
        .select("category", "rentals_completed", "revenue", "revenue_share_pct",
                "avg_ticket", "avg_margin", "avg_occupancy_rate", "avg_maintenance_ratio",
                "avg_review_score")
        .orderBy(F.desc("revenue")))

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight (KPIs globales):** el negocio muestra una **cancelación en torno al 5–6 %**
# MAGIC > y un **Maintenance Ratio** que, aun siendo alto, es un coste *variable y gestionable*.
# MAGIC > La palanca crítica no es el coste unitario de mantenimiento sino la **ocupación del
# MAGIC > inventario**: cada día que un producto no se alquila es margen perdido que no se
# MAGIC > recupera. El resto del análisis se orienta a **subir ocupación e ingresos por unidad**.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Consultas SQL exploratorias
# MAGIC
# MAGIC Para preguntas de ranking y agregación, SQL es más legible que cualquier API de
# MAGIC DataFrames. Las vistas `fact`, `product_metrics`, `store_metrics` y `customer_metrics`
# MAGIC apuntan a las tablas del Lakehouse registradas en la sección 2.

# COMMAND ----------

# MAGIC %md
# MAGIC **Q1 · Top 10 tiendas por ingresos** — ¿dónde se concentra el negocio?

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT store_name, store_country, store_size,
# MAGIC        ROUND(revenue, 0)             AS revenue_eur,
# MAGIC        rentals,
# MAGIC        ROUND(revenue_per_visitor, 4) AS rev_per_visitor,
# MAGIC        ROUND(cancellation_rate, 3)   AS cancel_rate
# MAGIC FROM store_metrics
# MAGIC ORDER BY revenue DESC
# MAGIC LIMIT 10

# COMMAND ----------

# MAGIC %md
# MAGIC **Q2 · Categorías por ingresos y margen** — ¿qué deportes sostienen la cuenta?

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT category,
# MAGIC        COUNT(*)                    AS rentals,
# MAGIC        ROUND(SUM(revenue), 0)      AS revenue_eur,
# MAGIC        ROUND(AVG(rental_price), 2) AS avg_ticket,
# MAGIC        ROUND(AVG(margin), 3)       AS avg_margin,
# MAGIC        ROUND(AVG(review_score), 2) AS avg_review
# MAGIC FROM fact
# MAGIC WHERE completed
# MAGIC GROUP BY category
# MAGIC ORDER BY revenue_eur DESC

# COMMAND ----------

# MAGIC %md
# MAGIC **Q3 · Productos infrautilizados vs saturados** — base para redistribuir inventario.

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT rotation_class,
# MAGIC        COUNT(*)                        AS n_products,
# MAGIC        ROUND(AVG(occupancy_rate), 3)   AS avg_occupancy,
# MAGIC        ROUND(AVG(revenue_per_unit), 0) AS avg_rev_per_unit,
# MAGIC        SUM(inventory_units)            AS total_units
# MAGIC FROM product_metrics
# MAGIC GROUP BY rotation_class
# MAGIC ORDER BY avg_occupancy

# COMMAND ----------

# MAGIC %md
# MAGIC **Q4 · Top 10 productos saturados** — candidatos a ampliar stock.

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT product_name, category,
# MAGIC        inventory_units,
# MAGIC        ROUND(occupancy_rate, 3) AS occupancy,
# MAGIC        rentals_completed,
# MAGIC        ROUND(revenue, 0)        AS revenue_eur
# MAGIC FROM product_metrics
# MAGIC WHERE rotation_class = 'Saturado'
# MAGIC ORDER BY occupancy DESC
# MAGIC LIMIT 10

# COMMAND ----------

# MAGIC %md
# MAGIC **Q5 · Ingresos por país y ranking de ciudades**.

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT store_country,
# MAGIC        COUNT(*)                    AS rentals,
# MAGIC        ROUND(SUM(revenue), 0)      AS revenue_eur,
# MAGIC        ROUND(AVG(rental_price), 2) AS avg_ticket
# MAGIC FROM fact
# MAGIC WHERE completed AND store_country IS NOT NULL
# MAGIC GROUP BY store_country
# MAGIC ORDER BY revenue_eur DESC

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT store_city, store_country,
# MAGIC        COUNT(*)               AS rentals,
# MAGIC        ROUND(SUM(revenue), 0) AS revenue_eur
# MAGIC FROM fact
# MAGIC WHERE completed AND store_city IS NOT NULL
# MAGIC GROUP BY store_city, store_country
# MAGIC ORDER BY revenue_eur DESC
# MAGIC LIMIT 12

# COMMAND ----------

# MAGIC %md
# MAGIC **Q6 · Clientes más activos (Top CLRV)** — núcleo de fidelización.

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT customer_id, customer_segment, membership_level, country,
# MAGIC        rentals,
# MAGIC        ROUND(clrv, 0)              AS lifetime_value_eur,
# MAGIC        ROUND(cancellation_rate, 3) AS cancel_rate,
# MAGIC        recency_days
# MAGIC FROM customer_metrics
# MAGIC WHERE rentals IS NOT NULL
# MAGIC ORDER BY clrv DESC
# MAGIC LIMIT 10

# COMMAND ----------

# MAGIC %md
# MAGIC **Q7 · Evolución mensual de ingresos** — con media móvil y variación interanual ya
# MAGIC calculadas en el mart mediante funciones de ventana.

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT month,
# MAGIC        rentals_completed,
# MAGIC        ROUND(revenue, 0)             AS revenue_eur,
# MAGIC        ROUND(revenue_rolling_3m, 0)  AS media_movil_3m,
# MAGIC        ROUND(revenue_yoy_pct, 1)     AS yoy_pct
# MAGIC FROM monthly_revenue
# MAGIC ORDER BY month

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight (SQL):** los ingresos se concentran en **tiendas grandes/flagship** y en
# MAGIC > unos pocos **países de mayor ticket** (efecto del factor de precio por país). En
# MAGIC > producto aparece un **patrón Pareto claro**: el segmento "Saturado" rota mucho con
# MAGIC > poco stock (oportunidad de **ampliar unidades**), mientras el "Infrautilizado"
# MAGIC > inmoviliza inventario que podría **reasignarse geográfica o estacionalmente**.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Análisis exploratorio (EDA)
# MAGIC
# MAGIC Cada visualización responde a **una pregunta de negocio concreta**. Evitamos gráficos
# MAGIC descriptivos sin propósito.
# MAGIC
# MAGIC Patrón de trabajo: **Spark agrega** (donde está el volumen) y **pandas dibuja** (donde
# MAGIC ya son decenas de filas). Nunca traemos al driver más de lo que vamos a pintar.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.1 ¿Cuándo se alquila cada categoría? (estacionalidad)

# COMMAND ----------

# --- Pivot en Spark: categoría × mes, normalizado al 100% por categoría ---
seasonal = (fact
            .filter(F.col("category").isNotNull())
            .withColumn("m", F.month("rental_date"))
            .groupBy("category").pivot("m", list(range(1, 13)))
            .agg(F.count("rental_id"))
            .fillna(0)
            .toPandas()
            .set_index("category"))

seasonal_pct = seasonal.div(seasonal.sum(axis=1), axis=0) * 100

fig, ax = plt.subplots(figsize=(12, 5.5))
sns.heatmap(seasonal_pct, cmap="Blues", cbar_kws={"label": "% de la categoría"},
            linewidths=.4, ax=ax)
ax.set_title("Estacionalidad de la demanda por categoría (% de alquileres por mes)")
ax.set_xlabel("Mes"); ax.set_ylabel("")
plt.tight_layout(); plt.show()

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight:** esquí y snowboard son **casi 100 % invierno**; camping, kayak y paddle
# MAGIC > surf, **verano**. Estas categorías tienen inventario **estructuralmente ocioso** medio
# MAGIC > año → oportunidad de **alquiler cruzado estacional** (mover stock entre mercados de
# MAGIC > montaña y costa) y de **pricing dinámico** en el pico.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.2 ¿Cómo evolucionan los ingresos? (tendencia + media móvil)

# COMMAND ----------

monthly = spark.table(TABLES["monthly_revenue"]).orderBy("month").toPandas()

fig, ax = plt.subplots(figsize=(12, 5))
ax.plot(monthly["month"], monthly["revenue"], color=BRAND_BLUE, marker="o",
        lw=1.5, label="Ingresos mensuales")
ax.plot(monthly["month"], monthly["revenue_rolling_3m"], color="#FF6F00", lw=2.5,
        ls="--", label="Media móvil 3M")
ax.set_title("Evolución mensual de ingresos con media móvil")
ax.set_ylabel("€"); ax.legend()
plt.tight_layout(); plt.show()

yoy = monthly["revenue_yoy_pct"].dropna()
if len(yoy):
    print(f"Crecimiento interanual medio: {yoy.mean():+.1f}% "
          f"(mín {yoy.min():+.1f}%, máx {yoy.max():+.1f}%)")

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight:** los ingresos muestran **doble pico** (invierno y verano) y crecimiento
# MAGIC > interanual. La media móvil confirma **tendencia positiva**; la planificación de
# MAGIC > inventario y campañas debe anticiparse ~1–2 meses a cada pico.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.3 ¿Qué dispersión de precio tiene cada categoría? (boxplot)

# COMMAND ----------

# Solo bajamos las dos columnas necesarias, no la tabla entera.
precios = (fact.filter(F.col("rental_price").isNotNull() & F.col("category").isNotNull())
           .select("category", "rental_price").toPandas())

order = (precios.groupby("category")["rental_price"].median()
         .sort_values(ascending=False).index)

fig, ax = plt.subplots(figsize=(12, 5))
sns.boxplot(data=precios, x="category", y="rental_price", order=order,
            showfliers=False, ax=ax)
ax.set_title("Distribución del precio de alquiler por categoría (sin outliers)")
ax.set_xlabel(""); ax.set_ylabel("€ por alquiler")
plt.xticks(rotation=30, ha="right"); plt.tight_layout(); plt.show()

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight:** esquí/snowboard tienen el **ticket más alto y mayor dispersión**
# MAGIC > (duración + factor estacional), mientras running/raquetas son productos de **ticket
# MAGIC > bajo y alta rotación**. Sugiere estrategias de precio distintas por categoría.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.4 ¿La satisfacción depende del nivel de socio? (violin plot)

# COMMAND ----------

reviews = (fact.filter(F.col("review_score").isNotNull() & F.col("membership_level").isNotNull())
           .select("membership_level", "review_score").toPandas())

fig, ax = plt.subplots(figsize=(11, 5))
sns.violinplot(data=reviews, x="membership_level", y="review_score",
               order=["Basic", "Standard", "Premium", "Gold"], cut=0, ax=ax)
ax.set_title("Distribución de review_score por nivel de socio")
ax.set_xlabel(""); ax.set_ylabel("Review (1-5)")
plt.tight_layout(); plt.show()

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight:** los socios **Premium/Gold** puntúan algo mejor y con menos cola baja.
# MAGIC > La fidelización no solo retiene: **mejora la percepción de calidad**, un argumento para
# MAGIC > invertir en el programa de membresía.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.5 ¿El envejecimiento del producto dispara las averías? (scatter + burbuja)

# COMMAND ----------

pm = spark.table(TABLES["product_metrics"]).toPandas()

fig, ax = plt.subplots(figsize=(11, 5.5))
sc = ax.scatter(pm["product_age"], pm["damage_rate"],
                s=pm["inventory_units"] * 4, c=pm["maintenance_ratio"],
                cmap="OrRd", alpha=0.6, edgecolor="grey", linewidth=0.3)
ax.set_title("Antigüedad del producto vs tasa de averías (tamaño=inventario, color=maint. ratio)")
ax.set_xlabel("Antigüedad del producto (años)"); ax.set_ylabel("Damage rate")
plt.colorbar(sc, label="Maintenance ratio")
plt.tight_layout(); plt.show()

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight:** relación **positiva y clara** entre antigüedad y averías, acompañada de
# MAGIC > mayor *maintenance ratio*. Existe una **edad umbral** a partir de la cual el producto
# MAGIC > deja de ser rentable de mantener → política de **renovación/retirada de flota**.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.6 ¿Dónde se concentran los ingresos? (treemap país › categoría)

# COMMAND ----------

tree = (fact.filter("completed AND store_country IS NOT NULL AND category IS NOT NULL")
        .groupBy("store_country", "category")
        .agg(F.sum("revenue").alias("revenue"))
        .toPandas())

fig = px.treemap(tree, path=[px.Constant("Sports Rental"), "store_country", "category"],
                 values="revenue", color="revenue", color_continuous_scale="Blues",
                 title="Ingresos por país y categoría")
fig.update_layout(margin=dict(t=50, l=10, r=10, b=10), height=520)
fig.show()

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.7 ¿Qué categorías merecen más inventario? (bubble: ocupación vs margen)

# COMMAND ----------

cat = spark.table(TABLES["category_performance"]).toPandas()

fig = px.scatter(cat, x="avg_occupancy_rate", y="avg_margin", size="revenue",
                 color="category", size_max=60, text="category",
                 color_discrete_sequence=px.colors.qualitative.Bold,
                 title="Ocupación vs Margen por categoría (tamaño = ingresos)")
fig.update_traces(textposition="top center")
fig.add_hline(y=cat["avg_margin"].mean(), line_dash="dot", line_color="grey")
fig.add_vline(x=cat["avg_occupancy_rate"].mean(), line_dash="dot", line_color="grey")
fig.update_layout(height=560, xaxis_title="Occupancy rate", yaxis_title="Margen medio")
fig.show()

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight:** el cuadrante **arriba-derecha** (alta ocupación + alto margen) es donde
# MAGIC > **ampliar stock** genera retorno inmediato; el cuadrante **abajo-izquierda** concentra
# MAGIC > inventario que **no rota ni deja margen** → candidato a reducir o reubicar.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.8 Matriz de correlación de variables numéricas

# COMMAND ----------

num_cols = ["rental_days", "rental_price", "maintenance_cost", "review_score",
            "reservation_lead_time", "product_age", "purchase_price",
            "inventory_units", "customer_age", "total_previous_rentals"]

corr = fact.select(num_cols).toPandas().corr()

fig, ax = plt.subplots(figsize=(10, 8))
sns.heatmap(corr, annot=True, fmt=".2f", cmap="coolwarm", center=0,
            square=True, linewidths=.5, cbar_kws={"shrink": .8}, ax=ax)
ax.set_title("Matriz de correlación (Pearson)")
plt.tight_layout(); plt.show()

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight:** `rental_price` correlaciona sobre todo con `rental_days` (el precio se
# MAGIC > construye por duración); `maintenance_cost` con `product_age`; y `review_score`
# MAGIC > negativamente con averías/retrasos. Ninguna correlación espuria fuerte → variables
# MAGIC > listas para modelar.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.9 Omnicanalidad — ¿por qué canal llega el negocio?
# MAGIC
# MAGIC > **Omnicanalidad (retail):** estrategia en la que el cliente interactúa con la marca por **varios canales integrados** (web, app, tienda física, teléfono) viviendo una experiencia única. Analizarla permite ver **dónde se origina la demanda**, qué canal convierte mejor y dónde invertir. En alquiler deportivo importa además porque el canal condiciona la **fricción** (una reserva online lejana se cancela más que una recogida en tienda).
# MAGIC
# MAGIC Medimos el **mix de canal** (peso de cada uno) y su **tasa de cancelación**, separando el bloque **digital** (Online + App) del **físico** (Tienda + Teléfono).

# COMMAND ----------

ch = spark.table(TABLES["channel_performance"]).orderBy(F.desc("rentals_total")).toPandas()
digital_share = ch.loc[ch["is_digital"], "share_pct"].sum()

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.5))
colors = [BRAND_BLUE if d else "#8A8D91" for d in ch["is_digital"]]
b1 = ax1.bar(ch["booking_channel"], ch["share_pct"], color=colors)
ax1.bar_label(b1, fmt="%.0f%%", padding=3)
ax1.set_title("Mix de canal (azul = digital)"); ax1.set_ylabel("% de alquileres")
b2 = ax2.bar(ch["booking_channel"], 100 * ch["cancellation_rate"], color=BRAND_ACCENT[2])
ax2.bar_label(b2, fmt="%.1f%%", padding=3)
ax2.set_title("Tasa de cancelación por canal"); ax2.set_ylabel("% cancelación")
plt.tight_layout(); plt.show()

print(f"Peso del canal DIGITAL (Online + App): {digital_share:.0f}% de los alquileres.")
display(ch[["booking_channel", "is_digital", "rentals_total", "share_pct",
            "cancellation_rate", "avg_ticket", "avg_lead_time_days"]])

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.10 Pricing — ¿cómo está estructurado el precio?
# MAGIC
# MAGIC > **Pricing (retail):** disciplina de **fijación de precios**. En alquiler, el precio depende de la categoría, la duración y —clave— la **temporada** (*dynamic pricing*: subir precio cuando la demanda aprieta y bajarlo para activar inventario parado). Entenderlo protege el **margen** sin frenar la ocupación.
# MAGIC
# MAGIC Comparamos el **precio por día** (`rental_price / rental_days`, la unidad de precio realmente comparable) por **categoría × temporada**: revela dónde ya existe *premium* estacional y dónde hay recorrido para pricing dinámico.
# MAGIC
# MAGIC El mart usa la **mediana**, no la media, y sobre el precio **por día**, no el ticket:
# MAGIC neutraliza el mix de duraciones y resiste los outliers residuales.

# COMMAND ----------

pricing = spark.table(TABLES["pricing_by_season"]).toPandas()

season_order = ["Winter", "Spring", "Summer", "Autumn"]
price_season = (pricing.pivot(index="category", columns="season",
                              values="median_price_per_day")
                .reindex(columns=season_order))
price_season = price_season.loc[price_season.mean(axis=1).sort_values(ascending=False).index]

fig, ax = plt.subplots(figsize=(11, 6))
sns.heatmap(price_season, annot=True, fmt=".1f", cmap="YlOrBr",
            linewidths=.4, cbar_kws={"label": "€ / día (mediana)"}, ax=ax)
ax.set_title("Pricing: precio por día por categoría y temporada")
ax.set_xlabel("Temporada"); ax.set_ylabel("")
plt.tight_layout(); plt.show()

spread = (pricing[["category", "seasonal_spread_pct"]].drop_duplicates()
          .sort_values("seasonal_spread_pct", ascending=False).set_index("category"))
print("Variación estacional del precio/día (max vs min, %) — mayor = más margen de pricing dinámico:")
display(spread.round(0))

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Lectura (Pricing):** el precio/día **no es plano**: se mueve con la temporada y el mapa dibuja **tres perfiles** claros.
# MAGIC >
# MAGIC > | Perfil | Categorías | Variación estacional |
# MAGIC > |--------|-----------|----------------------|
# MAGIC > | **Nieve (pico invierno)** | Esquí, Snowboard | **~+67 % / +69 %** |
# MAGIC > | **Agua y aire libre (pico verano)** | Paddle Surf, Kayak, Camping, Bicicletas | **+37 % a +60 %** |
# MAGIC > | **Todo el año / indoor** | Running, Escalada, Fitness, Raquetas | **+2 % a +29 %** |
# MAGIC >
# MAGIC > **Qué significa para el negocio:**
# MAGIC > - **El pricing dinámico ya existe y es racional:** en las categorías estacionales el precio **sube justo cuando sube la demanda**. Se está capturando el *premium* de escasez.
# MAGIC > - **Palanca 1 · activar inventario parado:** la columna de **temporada baja** es donde vive el stock ocioso. Un descuento off-season más agresivo es la vía para subir la **ocupación** de ese material.
# MAGIC > - **Palanca 2 · categorías planas = pricing sin explotar:** Running (+2 %), Escalada (+13 %) y Fitness (+20 %) apenas diferencian precio. O la demanda es genuinamente aseasonal, o hay **poder de precio latente** que a resolución *estacional* no se ve (probar pricing por **día de semana**).
# MAGIC >
# MAGIC > **Matiz de método:** es **precio observado, no elasticidad** —vemos lo que se cobra, no cómo responde la demanda. Fijar el precio óptimo requeriría **experimentar** (ver §7.5).

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.11 Gestión de stock — ¿qué inventario sostiene el negocio? (análisis ABC)
# MAGIC
# MAGIC > **Gestión de stock (retail):** decidir **cuánto inventario** tener de cada referencia y **cómo distribuirlo**. El **análisis ABC** (principio de Pareto) clasifica el catálogo por su peso en ingresos: **A** = pocos productos que generan ~80 % del negocio (proteger disponibilidad, ampliar stock si están saturados), **B** = siguiente ~15 %, **C** = cola larga de baja rotación (candidatos a **reducir/reubicar** para liberar capital).
# MAGIC
# MAGIC La curva de Pareto la calcula el mart con una **ventana acumulada**, que es la forma
# MAGIC canónica de hacerlo en SQL sin traerse los datos al cliente:
# MAGIC
# MAGIC ```sql
# MAGIC SUM(revenue) OVER (ORDER BY revenue DESC
# MAGIC                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
# MAGIC   / SUM(revenue) OVER ()  AS cumulative_revenue_share
# MAGIC ```

# COMMAND ----------

pr = pm.sort_values("revenue", ascending=False).reset_index(drop=True)
pr["prod_pct"] = 100 * (pr.index + 1) / len(pr)
n_A = int((pr["abc_class"] == "A").sum())
pct_A = 100 * n_A / len(pr)

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.8))
# Panel 1: curva de Pareto.
ax1.plot(pr["prod_pct"], 100 * pr["cumulative_revenue_share"], color=BRAND_BLUE, lw=2.2)
ax1.axhline(80, ls="--", color="grey"); ax1.axvline(pct_A, ls="--", color=BRAND_ACCENT[2])
ax1.set_title("Curva de Pareto de ingresos por producto (ABC)")
ax1.set_xlabel("% de productos (ordenados por ingreso)"); ax1.set_ylabel("% ingresos acumulado")
ax1.annotate(f"{pct_A:.0f}% de productos = 80% ingresos\n(clase A: {n_A} refs)",
             xy=(pct_A, 80), xytext=(pct_A + 8, 55),
             arrowprops=dict(arrowstyle="->", color="grey"))
# Panel 2: rotación del inventario.
rot = pm["rotation_class"].value_counts().reindex(["Infrautilizado", "Normal", "Saturado"])
b = ax2.bar(rot.index, rot.values, color=["#E3262F", "#8A8D91", BRAND_BLUE])
ax2.bar_label(b, padding=3)
ax2.set_title("Rotación del inventario (por ocupación)"); ax2.set_ylabel("nº de productos")
plt.tight_layout(); plt.show()

print(f"Clase A: {n_A} productos ({pct_A:.0f}% del catálogo) concentran el 80% de los ingresos.")
display(pm.groupby("abc_class").agg(n_productos=("product_id", "count"),
                                    ingresos=("revenue", "sum"),
                                    unidades=("inventory_units", "sum")).round(0))

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6.12 Comportamiento de cliente — ¿quién sostiene los ingresos?
# MAGIC
# MAGIC > **Comportamiento de cliente (retail):** cómo compra/alquila cada perfil — frecuencia, gasto, recencia, fidelidad. Segmentar por comportamiento permite **priorizar la fidelización** en quien más valor aporta y **reactivar** a quien se enfría. Aquí lo miramos con el **CLRV** (*Customer Lifetime Rental Value*) y los **segmentos** (`Occasional → Regular → Frequent → VIP`).

# COMMAND ----------

# --- Concentración del valor con una ventana de Spark (percentil de cliente por CLRV) ---
cm_spark = spark.table(TABLES["customer_metrics"]).filter(F.col("clrv").isNotNull())
w = Window.orderBy(F.desc("clrv"))
concentracion = (cm_spark
                 .withColumn("rank_pct", F.percent_rank().over(w))
                 .withColumn("top20", (F.col("rank_pct") < 0.20).cast("int"))
                 .groupBy("top20").agg(F.sum("clrv").alias("clrv"))
                 .toPandas())
top20_share = 100 * concentracion.loc[concentracion.top20 == 1, "clrv"].sum() / concentracion["clrv"].sum()

cm = cm_spark.toPandas()
seg_order = ["Occasional", "Regular", "Frequent", "VIP"]
seg = (cm.groupby("customer_segment")
       .agg(customers=("customer_id", "count"), total_clrv=("clrv", "sum"),
            avg_clrv=("clrv", "mean"), cancel_rate=("cancellation_rate", "mean"))
       .reindex(seg_order))
seg["rev_share_pct"] = 100 * seg["total_clrv"] / seg["total_clrv"].sum()

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.8))
b1 = ax1.bar(seg.index, seg["rev_share_pct"], color=BRAND_BLUE)
ax1.bar_label(b1, fmt="%.0f%%", padding=3)
ax1.set_title("Reparto de ingresos (CLRV) por segmento"); ax1.set_ylabel("% de ingresos")
b2 = ax2.bar(seg.index, seg["avg_clrv"], color=BRAND_ACCENT[3])
ax2.bar_label(b2, fmt="%.0f", padding=3)
ax2.set_title("CLRV medio por cliente y segmento"); ax2.set_ylabel("€ / cliente")
plt.tight_layout(); plt.show()

print(f"Concentración: el 20% de clientes top aporta el {top20_share:.0f}% de los ingresos (CLRV).")
display(seg.round(2))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Estadística inferencial
# MAGIC
# MAGIC Pasamos de *"se ve una relación"* a **cuantificarla y contrastarla**:
# MAGIC
# MAGIC - **Correlaciones con significación** (§7.1)
# MAGIC - **Regresión de precio — OLS** (§7.2) y **de cancelación — Logit** (§7.3)
# MAGIC - **Intervalos de confianza** para diferencias de proporciones (§7.4)
# MAGIC - **Test A/B** — experimentación controlada (§7.5)
# MAGIC - **Análisis de cohortes** — retención de clientes (§7.6)
# MAGIC - **Detección de anomalías** — vigilancia de datos y negocio (§7.7)
# MAGIC
# MAGIC **Por qué pandas y no Spark MLlib aquí:** la tabla de hechos son ~77 k filas, que caben
# MAGIC de sobra en el driver. Lo que necesitamos de estos modelos no es escalar, sino
# MAGIC **interpretar**: p-valores, intervalos de confianza y odds ratios. `statsmodels` los da
# MAGIC de fábrica; MLlib obligaría a calcularlos a mano. Con volúmenes de verdad, el patrón
# MAGIC correcto sería agregar en Spark y modelar sobre el agregado, o usar MLlib.

# COMMAND ----------

# Bajamos UNA vez la tabla de hechos al driver para toda la sección estadística.
fact_pd = fact.toPandas()
print(f"Tabla de hechos en pandas: {fact_pd.shape[0]:,} filas × {fact_pd.shape[1]} columnas")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 7.1 Correlaciones con significación estadística

# COMMAND ----------

def corr_test(x, y, data):
    d = data[[x, y]].dropna()
    r, p = stats.pearsonr(d[x], d[y])
    rho, _ = stats.spearmanr(d[x], d[y])
    return {"par": f"{x} ~ {y}", "n": len(d), "pearson_r": round(r, 3),
            "p_value": f"{p:.1e}", "spearman_rho": round(rho, 3)}


display(pd.DataFrame([
    corr_test("product_age", "maintenance_cost", fact_pd),
    corr_test("rental_days", "rental_price", fact_pd),
    corr_test("reservation_lead_time", "review_score", fact_pd),
    corr_test("product_age", "review_score", fact_pd),
]))

# COMMAND ----------

# MAGIC %md
# MAGIC ### 7.2 Modelo de precio (OLS) — ¿qué explica el `rental_price`?
# MAGIC
# MAGIC > **¿Qué es OLS?** *Ordinary Least Squares* es la **regresión lineal** clásica: modela una variable **continua** —aquí el precio, en €— como una **suma ponderada** de predictores, eligiendo los coeficientes que **minimizan la suma de los errores al cuadrado**. Cada coeficiente β se lee como *"manteniendo lo demás constante, un incremento de 1 unidad en ese factor cambia el precio en β €"*. La métrica **R²** indica qué proporción de la variabilidad del precio explica el modelo. Lo usamos porque el precio es numérico y queremos **cuantificar e interpretar** cada driver, no solo predecir.

# COMMAND ----------

model_df = fact_pd[fact_pd["completed"] & fact_pd["rental_price"].notna()].copy()
for c in ["category", "season", "store_country"]:
    model_df[c] = model_df[c].astype(object)
model_df = model_df.dropna(
    subset=["rental_days", "rental_price", "category", "season", "store_country"])

ols = smf.ols("rental_price ~ rental_days + C(category) + C(season) + C(store_country)",
              data=model_df).fit()
print(ols.summary().tables[0])
print(f"\nR² = {ols.rsquared:.3f} · N = {int(ols.nobs):,}")

coefs = (ols.params.to_frame("coef")
         .join(ols.conf_int().rename(columns={0: "ci_low", 1: "ci_high"}))
         .join(ols.pvalues.to_frame("p_value")))
print("\nDrivers de precio (selección):")
display(coefs.loc[["rental_days"] +
                  [c for c in coefs.index if c.startswith("C(category)")]].round(3))

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight (OLS):** cada **día adicional** de alquiler añade un incremento de precio
# MAGIC > estable y muy significativo, y las categorías de **nieve** llevan el mayor *premium*
# MAGIC > respecto a la base. El modelo explica una parte alta de la varianza → el pricing actual
# MAGIC > es **coherente y predecible**, buena base para automatizarlo.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 7.3 Modelo de cancelación (Logit) — ¿quién cancela y por qué?
# MAGIC
# MAGIC > **¿Qué es Logit?** La **regresión logística** modela una variable **binaria** (cancela = 1 / no cancela = 0). Predice la **probabilidad** del evento usando la función *logit* para mantener el resultado entre 0 y 1. Sus coeficientes se interpretan como **odds ratios** (`exp(β)`): un valor **> 1** aumenta las probabilidades de cancelar y **< 1** las reduce (un OR de 0.7 = un 30 % menos de *odds* de cancelar). Lo usamos porque la cancelación es un sí/no —donde OLS no aplica— y el *odds ratio* traduce el modelo a lenguaje de negocio.

# COMMAND ----------

logit_df = fact_pd.copy()
logit_df["cancelled_int"] = logit_df["cancelled"].astype(int)
for c in ["membership_level", "customer_segment"]:
    logit_df[c] = logit_df[c].astype(object)
logit_df = logit_df.dropna(
    subset=["reservation_lead_time", "membership_level", "customer_segment"])

logit = smf.logit("cancelled_int ~ reservation_lead_time + C(membership_level) + C(customer_segment)",
                  data=logit_df).fit(disp=False)

odds = np.exp(logit.params).to_frame("odds_ratio")
odds = odds.join(np.exp(logit.conf_int()).rename(columns={0: "or_low", 1: "or_high"}))
odds["p_value"] = logit.pvalues
print("Odds ratios de cancelación (>1 sube prob., <1 la baja):")
display(odds.round(3))

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight (Logit):** ser socio **Premium/Gold** reduce de forma significativa la
# MAGIC > probabilidad de cancelar (odds ratio < 1), mientras un **lead time largo** la aumenta
# MAGIC > (más margen para arrepentirse). Palancas claras: **empujar membresía** y **acortar la
# MAGIC > ventana reserva–uso** (recordatorios, prepago parcial).

# COMMAND ----------

# MAGIC %md
# MAGIC ### 7.4 Intervalo de confianza — ¿cancelan menos los socios de pago?

# COMMAND ----------

paid = fact_pd["membership_level"].isin(["Premium", "Gold"])
grp = pd.DataFrame({"paid": paid, "cancelled": fact_pd["cancelled"].astype(int)})
counts = grp.groupby("paid")["cancelled"].agg(["sum", "count"])

z, pval = proportions_ztest(counts["sum"].values, counts["count"].values)
for is_paid in [True, False]:
    lo, hi = proportion_confint(counts.loc[is_paid, "sum"],
                                counts.loc[is_paid, "count"], method="wilson")
    label = "Premium/Gold" if is_paid else "Basic/Standard"
    rate = counts.loc[is_paid, "sum"] / counts.loc[is_paid, "count"]
    print(f"{label:<14} cancel rate = {rate:6.3%}  IC95% [{lo:.3%}, {hi:.3%}]")
print(f"\nDiferencia de proporciones: z = {z:.2f}, p-value = {pval:.2e}")

# COMMAND ----------

# MAGIC %md
# MAGIC > **💡 Insight (IC):** la diferencia es **estadísticamente significativa** y los intervalos
# MAGIC > de confianza **no se solapan**: convertir a un cliente a Premium/Gold reduce su
# MAGIC > cancelación de forma real, no por azar. Esto **cuantifica el ROI** de la membresía en
# MAGIC > términos de ingresos protegidos.

# COMMAND ----------

# MAGIC %md
# MAGIC ### 7.5 Test A/B — experimentación controlada sobre el canal
# MAGIC
# MAGIC > **¿Qué es un test A/B?** Un **experimento controlado** que compara dos variantes —**A (control)** y **B (variante)**— sobre una métrica objetivo para decidir si un cambio produce una mejora **real** y no fruto del azar. Se plantea una **hipótesis nula** (H₀: no hay diferencia), se mide el **uplift**, se contrasta con un **test de dos proporciones** (p-value < 0.05 → significativo) y se comprueba la **potencia**. Buena práctica: **no desplegar** cambios cuyo p-value no sea significativo.
# MAGIC
# MAGIC Aquí lo aplicamos de forma **observacional** (no es un experimento aleatorizado, pero la mecánica del contraste es idéntica): **¿el canal `App` reduce la cancelación frente a `Online`?**

# COMMAND ----------

from statsmodels.stats.proportion import proportion_effectsize
from statsmodels.stats.power import NormalIndPower

groups = {"Control (Online)": "Online", "Variante (App)": "App"}
succ, nobs, rows = [], [], []
for label, chan in groups.items():
    s = fact_pd.loc[fact_pd["booking_channel"] == chan, "cancelled"]
    succ.append(int(s.sum())); nobs.append(int(s.count()))
    rows.append({"grupo": label, "cancelaciones": int(s.sum()),
                 "n": int(s.count()), "cancel_rate_pct": round(100 * s.mean(), 2)})
display(pd.DataFrame(rows))

p_ctrl, p_var = succ[0] / nobs[0], succ[1] / nobs[1]
z, pval = proportions_ztest(succ, nobs)
abs_uplift = p_var - p_ctrl
es = proportion_effectsize(p_var, p_ctrl)
power = NormalIndPower().solve_power(effect_size=abs(es), nobs1=nobs[1],
                                     alpha=0.05, ratio=nobs[0] / nobs[1])

print(f"Cancelación  ·  Control (Online) = {p_ctrl:.2%}   Variante (App) = {p_var:.2%}")
print(f"Uplift  ·  absoluto = {abs_uplift * 100:+.2f} pp   relativo = {abs_uplift / p_ctrl:+.1%}")
print(f"Contraste  ·  z = {z:.2f}   p-value = {pval:.3f}   potencia ≈ {power:.0%}")
if pval < 0.05:
    print("Decisión A/B → SIGNIFICATIVO: la diferencia es real, el canal influye en la cancelación.")
else:
    print("Decisión A/B → NO significativo: no hay evidencia de que el canal cambie la "
          "cancelación; no desplegaríamos el cambio (posible falso positivo).")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 7.6 Análisis de cohortes — retención de clientes
# MAGIC
# MAGIC > **¿Qué es un análisis de cohortes?** Agrupa a los clientes por su **periodo de adquisición** (aquí, el **mes de su primer alquiler**) y sigue su comportamiento **mes a mes**. La **matriz de retención** muestra, para cada cohorte, qué **% de sus clientes sigue activo** N meses después. Separa el efecto *"cuándo entró el cliente"* del efecto *"cuánto tiempo lleva"*, y revela si el negocio **fideliza** o **gotea**.
# MAGIC
# MAGIC La matriz la calcula `mart_cohort_retention`; aquí solo la pivotamos para verla.

# COMMAND ----------

coh = spark.table(TABLES["cohort_retention"]).toPandas()
retention = (coh.pivot(index="cohort_month", columns="months_since_first_rental",
                       values="retention_pct")
             .iloc[:, :13])
retention.index = retention.index.astype(str)

fig, ax = plt.subplots(figsize=(12, 6.5))
sns.heatmap(retention, annot=True, fmt=".0f", cmap="Blues",
            cbar_kws={"label": "% de la cohorte activo"}, linewidths=.4, ax=ax)
ax.set_title("Retención por cohorte (mes de primer alquiler → meses desde el alta)")
ax.set_xlabel("Meses desde el primer alquiler"); ax.set_ylabel("Cohorte")
plt.tight_layout(); plt.show()

m1 = retention.iloc[:, 1].mean()
print(f"Retención media a 1 mes: {m1:.0f}% · el resto reaparece de forma estacional "
      f"(alquiler = compra puntual, no suscripción).")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 7.7 Detección de anomalías — vigilancia de datos y negocio
# MAGIC
# MAGIC > **¿Qué es la detección de anomalías?** Identificar de forma automática puntos que se **desvían del patrón esperado** — un pico o caída anómala de ingresos, un producto con métricas fuera de rango. Sirve para **monitorización** (alertar de errores de datos o incidencias de negocio) y para **priorizar** dónde mirar. Dos enfoques complementarios:
# MAGIC > - **Univariante robusto (MAD):** sobre la serie semanal de ingresos, señalamos las semanas cuyo residuo respecto a la tendencia local (mediana móvil) supera un **z-score robusto** (basado en la *mediana* y la *desviación absoluta mediana*, insensibles a los propios outliers). Umbral |z| > 5.
# MAGIC > - **Multivariante (Isolation Forest):** detecta productos atípicos por la **combinación** de ocupación, margen, mantenimiento y cancelación.

# COMMAND ----------

# --- Serie semanal agregada en Spark (date_trunc WEEK), analizada en pandas ---
wk = (fact.filter("completed")
      .withColumn("semana", F.date_trunc("WEEK", F.col("rental_date")))
      .groupBy("semana").agg(F.sum("revenue").alias("revenue"))
      .orderBy("semana")
      .toPandas()
      .set_index("semana"))

wk["baseline"] = wk["revenue"].rolling(13, center=True, min_periods=1).median()
resid = wk["revenue"] - wk["baseline"]
mad = (resid - resid.median()).abs().median()
wk["robust_z"] = 0.6745 * (resid - resid.median()) / (mad if mad else 1.0)
wk["anomaly"] = wk["robust_z"].abs() > 5.0

fig, ax = plt.subplots(figsize=(12, 4.6))
ax.plot(wk.index, wk["revenue"], color=BRAND_BLUE, lw=1.3, label="Ingresos semanales")
ax.plot(wk.index, wk["baseline"], color="grey", lw=1.0, ls="--", label="Tendencia local (mediana móvil)")
an = wk[wk["anomaly"]]
ax.scatter(an.index, an["revenue"], color="#E3262F", zorder=5, s=55, label="Semana señalada (|z| > 5)")
ax.set_title("Detección de anomalías en ingresos semanales (z-score robusto / MAD)")
ax.set_ylabel("€"); ax.legend()
plt.tight_layout(); plt.show()

print(f"Semanas señaladas para revisión (|z| robusto > 5): {int(wk['anomaly'].sum())} de {len(wk)}")
if wk["anomaly"].any():
    display(an[["revenue", "robust_z"]].round(1))

# COMMAND ----------

# --- Detección multivariante con Isolation Forest ---
from sklearn.ensemble import IsolationForest

feats = ["occupancy_rate", "margin", "maintenance_ratio", "cancellation_rate"]
X = pm[feats].fillna(0)
iso = IsolationForest(contamination=0.03, random_state=42).fit(X)
flagged = pm.assign(is_anomaly=(iso.predict(X) == -1))

print(f"Isolation Forest: {int(flagged['is_anomaly'].sum())} productos atípicos por la "
      f"combinación de ocupación/margen/mantenimiento/cancelación.")
display(flagged.loc[flagged["is_anomaly"], ["product_name", "category"] + feats].head(8).round(3))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8. Insights consolidados
# MAGIC
# MAGIC 1. **La ocupación es la palanca #1.** El dinero se pierde en **inventario ocioso**,
# MAGIC    sobre todo en categorías estacionales, no en el coste unitario de mantenimiento.
# MAGIC 2. **Pareto de producto.** Un grupo reducido de referencias "Saturadas" rota muy por
# MAGIC    encima de la media con poco stock; muchas "Infrautilizadas" inmovilizan capital.
# MAGIC 3. **Estacionalidad estructural.** Esquí/nieve (invierno) y agua/camping (verano) dejan
# MAGIC    el inventario parado medio año → cross-selling estacional y pricing dinámico.
# MAGIC 4. **La fidelización protege ingresos.** Premium/Gold cancelan significativamente menos
# MAGIC    (validado con IC) y puntúan mejor: el programa de socios tiene ROI medible.
# MAGIC 5. **El envejecimiento tiene coste doble.** Más averías y más mantenimiento, y peor
# MAGIC    review → existe una edad óptima de retirada de flota.
# MAGIC 6. **El precio es explicable y automatizable** (OLS con R² alto): duración, categoría,
# MAGIC    temporada y país explican el ticket, base para un motor de pricing.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 9. Recomendaciones accionables (priorizadas por impacto)
# MAGIC
# MAGIC | # | Palanca | Acción concreta | Impacto esperado | Esfuerzo |
# MAGIC |---|---------|-----------------|------------------|----------|
# MAGIC | 1 | **Inventario** | Redistribuir stock de referencias *Infrautilizadas* hacia tiendas/temporadas *Saturadas*; ampliar unidades del Top saturado | ↑ Occupancy y Revenue/Unit | Medio |
# MAGIC | 2 | **Pricing** | Motor de precio dinámico (base OLS) con recargo en pico estacional y descuento en valle para activar inventario ocioso | ↑ Ingresos y ocupación | Medio |
# MAGIC | 3 | **Mantenimiento** | Política de **renovación por edad umbral** + mantenimiento preventivo según `maintenance_interval` y uso acumulado | ↓ Averías, ↑ review | Bajo |
# MAGIC | 4 | **Fidelización** | Campaña de conversión a Premium/Gold enfocada a clientes de alta frecuencia y alto CLRV | ↓ Cancelación, ↑ LTV | Bajo |
# MAGIC | 5 | **Campañas** | Promos *off-peak* (esquí en primavera, camping en otoño) y recordatorios para acortar lead time | ↑ Ocupación valle, ↓ cancelación | Bajo |
# MAGIC | 6 | **Forecasting** | Modelo de demanda estacional por categoría/tienda para planificar compra y logística con 1–2 meses de antelación | ↓ Rotura y ocioso | Alto |
# MAGIC | 7 | **Segmentación** | RFM + CLRV para personalizar oferta (heavy users vs ocasionales) | ↑ Conversión | Medio |
# MAGIC
# MAGIC **Quick wins (0–1 mes):** ampliar stock del Top saturado, recordatorios anti-cancelación,
# MAGIC promos off-peak. **Estructural (1–2 trimestres):** pricing dinámico, forecasting y política
# MAGIC de renovación de flota.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 10. Estado de industrialización
# MAGIC
# MAGIC El notebook local original terminaba con un plan de "cómo convertir esto en un producto
# MAGIC de datos". Buena parte **ya está construida**:
# MAGIC
# MAGIC | Pieza | Estado | Dónde |
# MAGIC |-------|--------|-------|
# MAGIC | **Arquitectura medallion** | ✅ Hecho | `staging` → `intermediate` → `marts` en Unity Catalog |
# MAGIC | **Transformación en dbt** | ✅ Hecho | 17 modelos versionados en `databricks/dbt` |
# MAGIC | **Tests de calidad** | ✅ Hecho | 46 tests: `unique`, `not_null`, `relationships`, `accepted_values` + 3 singulares de negocio |
# MAGIC | **Catálogo de métricas** | ✅ Hecho | Cada KPI definido una sola vez en un modelo; este notebook los consume |
# MAGIC | **Orquestación** | ✅ Hecho | Job de Databricks con dependencias entre capas y puerta de calidad |
# MAGIC | **Documentación y linaje** | ✅ Hecho | `dbt docs generate` → DAG navegable |
# MAGIC | **Reproducibilidad** | ✅ Hecho | Orden total en la deduplicación: dos ejecuciones dan tablas idénticas (verificado con hash MD5 en dos motores) |
# MAGIC | **Data Contracts** | ⬜ Pendiente | Esquema + expectativas + SLA acordados con el equipo productor |
# MAGIC | **CI/CD** | ⬜ Pendiente | `dbt build` en cada PR, despliegue por entornos (dev/pre/prod) |
# MAGIC | **Alertas automáticas** | ⬜ Pendiente | Notificar si el Data Trust Score baja del umbral; *freshness checks* |
# MAGIC | **Consumo en BI** | ⬜ Pendiente | Dashboards sobre las tablas Gold (Databricks SQL / Tableau) |
# MAGIC
# MAGIC ### Lo que este notebook demuestra sobre la arquitectura
# MAGIC
# MAGIC Fíjate en lo que **no** hay en estas celdas: ni una sola regla de limpieza, ni una
# MAGIC definición de KPI, ni un `CASE WHEN` de negocio. Todo eso vive aguas arriba, testeado y
# MAGIC versionado. El notebook es una **capa de consumo**: si mañana cambia la definición de
# MAGIC *Occupancy*, se cambia en un modelo dbt y este análisis, el dashboard y cualquier query
# MAGIC ad-hoc se actualizan **a la vez y de forma consistente**.
# MAGIC
# MAGIC Ese es exactamente el problema que resuelve el analytics engineering: no que los números
# MAGIC existan, sino que **haya un único número** y todo el mundo mire el mismo.

# COMMAND ----------

# MAGIC %md
# MAGIC ---
# MAGIC ### Cierre
# MAGIC El análisis pasa de **datos crudos con problemas de calidad** a un conjunto de
# MAGIC **decisiones priorizadas por impacto**: subir ocupación (inventario), automatizar precio,
# MAGIC proteger ingresos vía fidelización y renovar flota a tiempo. La diferencia con el
# MAGIC prototipo local es que ahora todo lo que hay debajo es **gobernado, testeado y
# MAGIC reproducible**.
