# Sports Rental — Pipeline en Databricks (Staging → Intermediate → Data Marts)

Réplica del análisis del notebook local como **pipeline gobernado** en Databricks:
tres capas encadenadas, tests de calidad que rompen el pipeline y Data Marts listos
para que el notebook de análisis solo tenga que leer y visualizar.

```
CSV  ──►  staging.*_raw                                    (crudo, subido por UI)
             │
             ▼  01 · STAGING        casting, renombrado, estandarización de texto
          staging.stg_*             1:1 con la fuente · vistas
             │
             ▼  02 · INTERMEDIATE   dedup de PK, reglas de negocio, join estrella
          intermediate.int_*        tablas
             │
             ▼  02b · QUALITY GATE  ¿alguna regla de negocio sobrevivió? → falla
             │
             ▼  03 · MARTS          métricas y KPIs
          marts.mart_*              tablas
             │
             ▼  04 · TESTS          reconciliación de ingresos entre capas
```

## Qué hay en esta carpeta

| Ruta | Qué es |
|------|--------|
| `dbt/` | **Proyecto dbt: la única fuente de verdad de la lógica.** 17 modelos + 46 tests |
| `dbt/profiles.yml` | Conexión a Databricks (host, warehouse, catálogo). **Sin secretos** |
| `dbt/env.local.ps1` | Token de acceso. **Ignorado por git — no lo subas** |
| `notebooks/` | Notebooks SQL de Databricks **generados** desde `dbt/` — no editar a mano |
| `build_databricks_notebooks.py` | Traduce los modelos dbt a SQL puro de Databricks |
| `resources/job_pipeline_notebooks.json` | Definición del Job encadenado (opción SQL) |
| `resources/job_pipeline_dbt.json` | Definición del Job encadenado (opción dbt) |

**Por qué las dos opciones:** dbt no viene instalado dentro de un notebook de
Databricks, así que la ruta "dbt nativo" pasa por un **task de tipo dbt en Workflows**
(necesita repo Git + SQL Warehouse) o por **dbt Core desde tu máquina**. La ruta SQL
funciona hoy, sin dependencias. Como los notebooks se **generan** desde los modelos dbt,
no hay dos copias del código: cambias el modelo, regeneras, y ambas rutas quedan iguales.

---

## Paso 0 · Cargar los CSV (ya lo estás haciendo)

`Data Ingestion` → `Create or modify table` → sube los cuatro ficheros de `output/`.
Destino: **`Catalog` › `My organization` › `workspace` › `staging`**, y los nombres de
tabla deben ser **exactamente** estos:

| Fichero | Tabla destino |
|---------|---------------|
| `rentals.csv` | `workspace.staging.rentals_raw` |
| `customers.csv` | `workspace.staging.customers_raw` |
| `products.csv` | `workspace.staging.products_raw` |
| `stores.csv` | `workspace.staging.stores_raw` |

El sufijo `_raw` no es decorativo: marca lo que es **fuente inmutable** frente a lo que
es modelo. En el mismo schema `staging` conviven las cuatro `*_raw` (crudo, nunca se
modifica) y las cuatro vistas `stg_*` (ya casteadas y estandarizadas), y así se
distinguen de un vistazo en el Catalog Explorer.

> Son CSV, no Excel: en el diálogo de subida elige **coma** como separador y marca
> *"First row contains header"*. Da igual si el asistente infiere los tipos o si deja
> todo como `STRING`: la capa staging usa `try_cast`, que funciona en ambos casos.

> ⚠️ **Sube los ficheros de uno en uno, en cuatro pasadas.** Si seleccionas los cuatro
> a la vez con un único nombre de tabla destino, Databricks los **une en una sola tabla**
> haciendo *schema merge*: acabas con una tabla de 37 columnas y 103.393 filas
> (78.003 + 25.000 + 320 + 70) en lugar de las cuatro tablas del modelo estrella.
> Es un fallo silencioso —la carga "funciona"— que solo se detecta al ejecutar los
> tests: `unique_customer_id` y `not_null_customer_id` fallan porque las filas de
> `products` y `stores` no tienen `customer_id`. Comprueba siempre las cuatro
> volumetrías con la query de abajo antes de lanzar el pipeline.

**Si tu catálogo no es `workspace`** (en el trial premium suele ser `main`), regenera
los notebooks apuntando al tuyo:

```powershell
python databricks\build_databricks_notebooks.py --catalog main
```

y cambia también `database:` en `dbt/models/staging/_sources.yml`.

Comprueba que la carga fue bien (deberías ver 78.003 / 25.000 / 320 / 70):

```sql
SELECT 'rentals_raw'   AS tabla, count(*) AS filas FROM workspace.staging.rentals_raw
UNION ALL SELECT 'customers_raw', count(*) FROM workspace.staging.customers_raw
UNION ALL SELECT 'products_raw',  count(*) FROM workspace.staging.products_raw
UNION ALL SELECT 'stores_raw',    count(*) FROM workspace.staging.stores_raw;
```

> **¿Ya las habías cargado sin el sufijo?** No hace falta volver a subir los ficheros:
> ```sql
> ALTER TABLE workspace.staging.rentals   RENAME TO workspace.staging.rentals_raw;
> ALTER TABLE workspace.staging.customers RENAME TO workspace.staging.customers_raw;
> ALTER TABLE workspace.staging.products  RENAME TO workspace.staging.products_raw;
> ALTER TABLE workspace.staging.stores    RENAME TO workspace.staging.stores_raw;
> ```

---

## Opción A · SQL puro (recomendada para empezar hoy)

### A.1 · Subir los notebooks

1. En el menú lateral: **Workspace** → tu carpeta de usuario → `Create` → `Folder`,
   llámala `sports_rental`.
2. Dentro de la carpeta: **`Import`** → `File` → arrastra los cinco ficheros de
   `databricks/notebooks/`:
   `01_staging.sql`, `02_intermediate.sql`, `02b_quality_gate.sql`, `03_marts.sql`,
   `04_tests.sql`.

Databricks reconoce la cabecera `-- Databricks notebook source` y los convierte en
notebooks con las celdas ya separadas. No hace falta copiar y pegar nada.

### A.2 · Probarlos a mano una vez

Abre `01_staging`, conecta a **Serverless** (arriba a la derecha) y `Run all`. Repite
con `02_intermediate`, `02b_quality_gate`, `03_marts` y `04_tests`, en ese orden.
La última celda de cada notebook de capa imprime la volumetría, así ves de un vistazo
si algo se quedó a cero.

Valores esperados tras `02_intermediate`: **77.231** filas (de 78.003 crudas; se van
772 duplicados) y `rental_id` ya único.

### A.3 · Encadenar las capas en un Job

**Por la UI** (5 minutos):

1. Menú lateral → **Job Runs** / **Workflows** → `Create job`.
2. Nombre del job: `sports_rental_pipeline`.
3. **Tarea 1** — `task_key`: `staging` · Type: `Notebook` · Path: `01_staging` ·
   Compute: `Serverless`.
4. `+ Add task` → **Tarea 2** `intermediate` → notebook `02_intermediate` →
   en **`Depends on`** selecciona **`staging`**. *Esto es lo que encadena las capas.*
5. **Tarea 3** `data_quality_gate` → `02b_quality_gate` → depends on `intermediate`.
6. **Tarea 4** `marts` → `03_marts` → depends on `data_quality_gate`.
7. **Tarea 5** `tests_marts` → `04_tests` → depends on `marts`.
8. `Run now`.

El grafo debe quedar en línea recta: `staging → intermediate → data_quality_gate →
marts → tests_marts`. Databricks **no arranca una tarea hasta que la anterior termina
en éxito**, así que si la puerta de calidad falla, los Data Marts no se reconstruyen y
negocio sigue viendo la versión buena anterior.

**Por JSON** (más rápido y versionable): en la pantalla del job, arriba a la derecha,
`⋮` → **`Edit as JSON`** → pega `resources/job_pipeline_notebooks.json` y sustituye
`TU_EMAIL` por tu email en las 5 rutas y en las notificaciones.

> El JSON trae un `schedule` diario a las 05:00 (Europe/Madrid) en estado `PAUSED`.
> Cámbialo a `UNPAUSED` cuando quieras que corra solo.

---

## Opción B · dbt

Misma lógica, con lo que dbt aporta encima: **el orden de las capas lo resuelve el
propio DAG** (no hay que declarar dependencias en ningún sitio), 46 tests automáticos,
documentación y linaje navegable.

### B.1 · dbt Core desde tu máquina contra Databricks

Es la ruta recomendada: dbt corre en tu portátil, pero **todas las tablas se crean en
Databricks**. El SQL se ejecuta en tu SQL Warehouse; por tu red solo viaja el texto de
las consultas, nunca los datos.

#### Estado actual del proyecto

Ya está todo montado y validado. Lo único que falta es un token válido:

| Pieza | Estado |
|-------|--------|
| `dbt-core` 1.12 + `dbt-databricks` 1.10 | ✅ instalados |
| `dbt/profiles.yml` con host, http_path y catálogo | ✅ creado |
| `dbt/env.local.ps1` con el token (ignorado por git) | ⚠️ **token inválido, hay que regenerarlo** |
| `dbt parse` — 17 modelos, 4 sources, 46 tests | ✅ sin errores |

#### Paso 1 · Generar un Personal Access Token

El token que hay en `env.local.ps1` devuelve **HTTP 401** contra la API. Un PAT de
Databricks tiene **36 caracteres y empieza por `dapi`** (p.ej.
`dapi1a2b3c4d5e6f...`); un valor de 64 caracteres hexadecimales sin prefijo es otra
cosa —normalmente el *client secret* de un service principal OAuth—, y no sirve para
este flujo.

En tu workspace: **avatar (arriba a la derecha) → `Settings` → `Developer` →
`Access tokens` → `Manage` → `Generate new token`**. Cópialo entero: solo se muestra
una vez.

> Si en tu cuenta no aparece la opción de PAT, hay una alternativa OAuth: crea un
> service principal (`Settings` → `Identity and access` → `Service principals`),
> genera un secret y sustituye en `profiles.yml` la línea `token:` por
> `auth_type: oauth`, `client_id: <Application ID>` y
> `client_secret: "{{ env_var('DATABRICKS_CLIENT_SECRET') }}"`.

#### Paso 2 · Guardar el token

Abre `databricks\dbt\env.local.ps1` y pega el nuevo token. Ese fichero está en
`.gitignore`: **el token nunca entra en el repo**. `profiles.yml`, en cambio, sí se
commitea porque solo contiene host y ruta, que no son secretos.

#### Paso 3 · Ejecutar

```powershell
cd databricks\dbt

. .\env.local.ps1        # el punto inicial es obligatorio (dot-sourcing)

dbt debug   --profiles-dir .    # ¿conecta? debe decir "All checks passed!"
dbt build   --profiles-dir .    # construye las 3 capas EN ORDEN + los 46 tests
```

> **El `--profiles-dir .` no es opcional.** Por defecto dbt busca el perfil en
> `~/.dbt/profiles.yml`; aquí vive dentro del proyecto para que la configuración viaje
> con el repo. Si te cansa escribirlo: `$env:DBT_PROFILES_DIR = "."`.

Salida esperada de `dbt build`: 4 vistas en `staging`, 3 tablas en `intermediate`,
10 tablas en `marts` y `PASS=46 WARN=0 ERROR=0`.

#### Paso 4 · Documentación y linaje

```powershell
dbt docs generate --profiles-dir .
dbt docs serve    --profiles-dir .    # abre http://localhost:8080
```

Te da el **grafo de linaje navegable** (`staging → intermediate → marts`) con las
descripciones de cada modelo y columna que están en los `.yml`. Es la pieza que mejor
demuestra el trabajo de analytics engineering.

#### Comandos del día a día

| Comando | Qué hace |
|---------|----------|
| `dbt build` | Modelos + tests, en orden de dependencias. **El que usarás casi siempre** |
| `dbt run` | Solo materializa modelos, sin tests |
| `dbt test` | Solo los 46 tests, sin reconstruir nada |
| `dbt build --select staging` | Solo esa capa |
| `dbt build --select +mart_product_metrics` | Ese modelo **y todo lo que necesita** aguas arriba |
| `dbt build --select int_rentals_enriched+` | Ese modelo **y todo lo que depende de él** |
| `dbt build --select state:modified+` | Solo lo que cambiaste y sus descendientes (CI) |
| `dbt compile --select <modelo>` | Escribe el SQL final en `target/compiled/` sin ejecutarlo |
| `dbt source freshness` | Antigüedad de las tablas `*_raw` (requiere `loaded_at_field`) |

#### Si algo falla

| Síntoma | Causa y arreglo |
|---------|-----------------|
| `Credential was not sent or was of an unsupported type` (401) | Token inválido o caducado → regenera el PAT (Paso 1) |
| `Env var required but not provided: 'DATABRICKS_TOKEN'` | Olvidaste el punto: `. .\env.local.ps1`, no `.\env.local.ps1` |
| `Could not find profile named 'sports_rental'` | Falta `--profiles-dir .` |
| `Table or view not found: workspace.staging.rentals_raw` | Las tablas base no están cargadas o no llevan el sufijo `_raw` → Paso 0 |
| La ejecución se queda parada al arrancar | El SQL Warehouse estaba dormido; tarda ~1-2 min en despertar |
| `PERMISSION_DENIED` al crear schema | Tu usuario no tiene `CREATE SCHEMA` en el catálogo → créalos a mano con `CREATE SCHEMA workspace.intermediate;` y `CREATE SCHEMA workspace.marts;` |

### B.2 · dbt dentro de Databricks Workflows

Requiere que el proyecto esté en **Git** (GitHub/GitLab) y un **SQL Warehouse**:

1. Sube este repo a GitHub.
2. Databricks → `Settings` → `Linked accounts` → conecta tu proveedor Git.
3. `Workflows` → `Create job` → Task type **`dbt`**.
4. Git source: tu repo · Project directory: `databricks/dbt` · SQL warehouse: el tuyo.
5. Comandos: `dbt deps`, `dbt build`.

O pega `resources/job_pipeline_dbt.json` con `Edit as JSON` (sustituye `TU_USUARIO`,
`TU_REPO`, `TU_WAREHOUSE_ID` y `TU_EMAIL`). Ese JSON separa el build en **tres tareas
encadenadas** —`dbt_staging → dbt_intermediate → dbt_marts`— para que el grafo del Job
muestre las capas y puedas reintentar una sola. Con una única tarea `dbt build` también
funcionaría; se separa por legibilidad operativa.

> **Aquí no se usa `profiles.yml`.** El JSON no declara `profiles_directory` a
> propósito: en un task dbt, Databricks **genera el perfil solo** a partir de
> `warehouse_id`, `catalog` y `schema`, y se autentica con la identidad del Job. Si le
> pasaras nuestro `profiles.yml`, buscaría `DATABRICKS_TOKEN` en el entorno del cluster
> y fallaría. Ese fichero es solo para la ruta B.1 (dbt desde tu máquina).

> **Free Edition:** el task type `dbt` puede no estar disponible según la cuenta. Si no
> lo ves en el desplegable, usa B.1 (dbt desde tu máquina) — el resultado en el
> Lakehouse es exactamente el mismo — y deja la Opción A como pipeline programado.

---

## Los modelos

### `staging` — 1:1 con la fuente (vistas)

| Modelo | Qué hace |
|--------|----------|
| `stg_rentals` | Casting con `try_cast`, `initcap(trim())` en canal y meteorología |
| `stg_products` | Normaliza `category` al catálogo canónico (`esqui`→`Esquí`, `Snow Board`→`Snowboard`…) |
| `stg_stores` | Estandariza `country` (`ESPAÑA`→`España`) |
| `stg_customers` | Estandariza `country` y `gender` |

No se pierde ni una fila. `customer_segment` y `membership_level` **no** llevan
`initcap` a propósito: convertiría `VIP` en `Vip` y rompería joins y ordenaciones.

### `intermediate` — reglas de negocio (tablas)

| Modelo | Qué hace |
|--------|----------|
| `int_rentals_deduplicated` | **Caso A**: fila 100 % duplicada → `SELECT DISTINCT`. **Caso B**: `rental_id` repetido con datos en conflicto → se conserva el registro más completo (menos nulos) y, en empate, el `rental_date` más reciente |
| `int_rentals_cleaned` | Valores imposibles → `NULL` (review ∉[1,5], precio ≤0 o >2000, duración ∉[1,30], coste negativo, `return_date` < `rental_date`) + flags `completed` y `has_invalid_return_date` |
| `int_rentals_enriched` | Modelo estrella desnormalizado + `revenue`, `profit`, `margin`, `month`, `price_per_day`. **Es la tabla de hechos que consumen todos los marts** |

Criterio conservador: se **anula el valor imposible**, no se borra la fila (el resto de
sus campos sigue siendo válido). Solo se eliminan filas que no aportan información.

### `marts` — Data Marts (tablas)

| Modelo | Grano | Responde a |
|--------|-------|-----------|
| `mart_global_kpis` | 1 fila | Cuadro de mando: ingresos, ticket, cancelación, avería, retraso, review, maintenance ratio |
| `mart_product_metrics` | producto | Ocupación, utilización, revenue/unidad, margen, `rotation_class`, clase `ABC` |
| `mart_store_metrics` | tienda | Ingresos, ingresos por visitante, cancelación, avería |
| `mart_customer_metrics` | cliente | CLRV, frecuencia, recencia, cohorte |
| `mart_category_performance` | categoría | Transaccional + inventario en una sola tabla |
| `mart_monthly_revenue` | mes | Serie con media móvil 3M y variación interanual |
| `mart_pricing_by_season` | categoría × temporada | Mediana €/día y recorrido de pricing dinámico |
| `mart_channel_performance` | canal | Mix digital vs físico y fricción por canal |
| `mart_cohort_retention` | cohorte × mes | Retención por mes de primer alquiler |
| `mart_data_quality` | dimensión | **Data Trust Score** sobre las tablas `*_raw` |

---

## Tests de calidad

**Genéricos** (en los `.yml`): `unique` y `not_null` en todas las PK,
`relationships` para las FK del hecho a las tres dimensiones, y `accepted_values` para
categoría, temporada, canal, membresía, segmento, `rotation_class` y `abc_class`.

**Singulares** (en `dbt/tests/`):

| Test | Qué protege |
|------|-------------|
| `assert_cleaned_rentals_business_rules` | Que ninguna regla de validez sobreviva a la limpieza |
| `assert_revenue_only_on_completed` | Que un alquiler cancelado nunca aporte ingresos |
| `assert_no_revenue_leakage_between_layers` | Que los ingresos de los marts cuadren con los del hecho — detecta el JOIN que duplica filas, el fallo silencioso más caro |

En la ruta dbt los ejecuta `dbt build`. En la ruta SQL están traducidos
automáticamente a `assert_true(...)` en `02b_quality_gate` y `04_tests`: si un test
devuelve filas, la celda lanza un error y el Job se detiene.

---

## Verificación

El pipeline se ha ejecutado **de verdad en Databricks** (`dbt build` → `PASS=63
WARN=0 ERROR=0`) y sus resultados se han comparado con la lógica pandas del notebook:

| KPI | Notebook (pandas) | Pipeline en Databricks |
|-----|------------------:|-----------------------:|
| Alquileres tras limpieza | 77.231 | 77.231 |
| Alquileres completados | 72.964 | 72.964 |
| Ingresos totales | 5.420.622 € | 5.420.690 € |
| Ticket medio | 75,90 € | 75,90 € |
| Duración media | 3,883 días | 3,883 días |
| Cancellation rate | 5,525 % | 5,525 % |
| Late return rate | 8,521 % | 8,521 % |
| Damage rate | 15,546 % | 15,546 % |
| Review media | 3,658 | 3,658 |
| Maintenance ratio | 27,398 % | 27,398 % |
| Data Trust Score | 96,12 / 100 | 96,12 / 100 |

### Los 68 € de diferencia en ingresos

No es un error: es el **único punto donde SQL no puede replicar a pandas**, y conviene
entenderlo porque es un caso de manual.

De los `rental_id` con PK duplicada, **14 empatan en los dos criterios de la regla de
negocio** (mismo número de nulos *y* misma `rental_date`). Hay que elegir una fila de
cada par, y ambas son igual de válidas según la regla:

- **pandas** ordena de forma estable, así que se queda con la que venía **primera en el
  CSV**. El orden de fichero es información que existe en un DataFrame.
- **SQL no tiene orden de fila.** Una tabla Delta es un conjunto, no una secuencia: ese
  criterio sencillamente no está disponible.

Elegir la otra fila de esos 14 pares mueve el total 68 € sobre 5,42 M — un **0,001 %**,
sin efecto en ninguna decisión de negocio.

Lo que sí era inaceptable, y está corregido, es que la elección fuera **aleatoria**: sin
un desempate final, cada `dbt build` devolvía un número distinto. `int_rentals_deduplicated`
ordena ahora por todas las columnas, de modo que el orden es total y el resultado
reproducible. Verificado ejecutando el pipeline en **dos motores independientes**
(DuckDB en local y Databricks) y comparando el hash MD5 del contenido de
`int_rentals_cleaned`: **`841aaa54d4dd45e2b72759004c70556d` en ambos**.

Los agregados en coma flotante todavía bailan en el **décimo dígito significativo**
(`5420689.930000043` vs `...052`) porque el motor suma en paralelo y el orden de sumación
varía. Es inevitable en cualquier motor distribuido y no afecta a nada.

Para reproducirlo:

```sql
SELECT * FROM workspace.marts.mart_global_kpis;
SELECT * FROM workspace.marts.mart_data_quality ORDER BY dimension_order;
```

---

## El notebook de análisis

`analysis/rental_analysis_databricks.py` es el análisis de negocio sobre las
tablas Gold. Réplica del notebook local, adaptada al Lakehouse: **no transforma nada**,
solo consume, visualiza y contrasta.

### Cómo importarlo

`Workspace` → tu carpeta → `Import` → `File` → arrastra el `.py`. Databricks reconoce la
cabecera `# Databricks notebook source` y lo convierte en notebook con sus 102 celdas
(59 markdown, 30 Python, 12 SQL, 1 `%pip`). Conecta a **Serverless** y `Run all`.

Si tu catálogo no es `workspace`, cámbialo en el **widget** que aparece arriba del
notebook al ejecutar la primera celda. No hay que tocar código.

### Cómo alterna PySpark y SQL

Una celda registra las tablas del Lakehouse como **vistas temporales** con nombres
cortos (`fact`, `product_metrics`, `store_metrics`…). A partir de ahí:

| Herramienta | Se usa para | Ejemplos |
|-------------|-------------|----------|
| **`%sql`** | Rankings y agregaciones, donde SQL es más legible que cualquier API | Q1–Q7, reglas de validez, duplicados |
| **PySpark** | Perfilado dinámico de nulos, `approxQuantile`, pivots, ventanas (`percent_rank`), agregación temporal | Estacionalidad, outliers, concentración de CLRV |
| **pandas** | Solo el último paso antes de graficar, y la estadística inferencial | matplotlib/seaborn/plotly, statsmodels |

La regla: **Spark agrega donde está el volumen, pandas dibuja lo que ya son decenas de
filas.** Nunca se baja al driver más de lo que se va a pintar, salvo en la sección 7,
donde 77 k filas caben de sobra y `statsmodels` da p-valores e intervalos de confianza
que MLlib obligaría a calcular a mano.

### Qué cambia respecto al notebook local

| Sección | Antes (local) | Ahora (Databricks) |
|---------|---------------|--------------------|
| 2 · Validación PK/FK | Exploración: ¿aguanta el modelo? | **Evidencia** de que los tests del pipeline se cumplen |
| 3 · Data Quality | Diagnostica **y limpia** | Diagnostica las `*_raw` en solo lectura; la limpieza la garantiza dbt. El Data Trust Score se **lee** de `mart_data_quality` |
| 4 · Métricas | Define las métricas con pandas/DuckDB | **Consume** los marts; muestra la técnica SQL como material didáctico |
| 5–7 · SQL, EDA, estadística | Igual | Igual, sobre las tablas Gold |
| 10 · Productivización | Plan a futuro | **Estado real**: qué está hecho y qué falta |

### Verificación

- Las **12 celdas SQL se han ejecutado contra tu workspace**: todas OK.
- **Todas las referencias a columnas** de las celdas PySpark/pandas se han cruzado con
  los esquemas reales de las 11 tablas: cero ausencias.
- Sintaxis Python de las 30 celdas de código: sin errores.

---

## Modificar la lógica

La regla es una sola: **se edita el modelo dbt, nunca el notebook generado.**

```powershell
# 1. editas databricks/dbt/models/.../<modelo>.sql
# 2. regeneras los notebooks SQL
python databricks\build_databricks_notebooks.py
# 3. vuelves a importar los .sql en Databricks (o haces push si usas Git + dbt)
```
