# 🏷️ Sports Rental — Dataset sintético y análisis de negocio

Proyecto de **Analytics Engineering** que simula y analiza el negocio de **alquiler de
material deportivo (Rental)** de un retailer europeo. Consta de dos piezas:

1. **Generador de datos** (`generate_dataset.py`) — crea un dataset sintético realista,
   con relaciones lógicas entre variables y problemas de calidad introducidos a propósito.
2. **Notebook de análisis** (`rental_analysis.ipynb`) — un análisis de negocio
   de principio a fin (calidad del dato → KPIs → SQL → EDA → estadística → recomendaciones),
   pensado para Databricks y ejecutable localmente en VSCode.

> ⚠️ Todos los datos son **100 % sintéticos**. No contienen información real de clientes,
> productos ni tiendas reales.

---

## 📂 Estructura del proyecto

```
sports-rental-analytics/
├── generate_dataset.py              # Generador del dataset sintético
├── rental_analysis.ipynb  # Notebook de análisis (Databricks / VSCode)
├── requirements.txt                 # Dependencias del proyecto
├── README.md                        # Este archivo
└── output/                          # Salida del generador (se crea al ejecutar)
    ├── customers.csv                # Dimensión de clientes
    ├── products.csv                 # Dimensión de productos
    ├── stores.csv                   # Dimensión de tiendas
    ├── rentals.csv                  # Tabla de hechos de alquileres
    └── README.md                    # Diccionario de datos + KPIs (detalle de las tablas)
```

---

## 🚀 Quickstart

### 1. Requisitos
- Python 3.10+ (probado en 3.13)
- Recomendado: entorno virtual (`venv` o `conda`)

### 2. Instalación de dependencias
```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

python -m pip install -r requirements.txt
```

### 3. Generar el dataset
```bash
python generate_dataset.py
```
Crea la carpeta `output/` con los cuatro CSV y su diccionario de datos. El proceso es
**100 % reproducible** (semilla fija): dos ejecuciones producen ficheros idénticos.

### 4. Abrir el análisis
Abre `rental_analysis.ipynb` en **VSCode**, selecciona el kernel de Python del
entorno virtual y pulsa **Run All**. El notebook lee los CSV de `output/`.

---

## 🧩 Parte 1 · Generador del dataset (`generate_dataset.py`)

Simula el negocio: cada **alquiler** pertenece a un **cliente** que alquila un
**producto** en una **tienda**. El script está organizado en funciones separadas por
entidad (`generate_stores`, `generate_products`, `generate_customers`, `generate_rentals`)
más la inyección de calidad y la exportación.

### Volumen (por defecto)
| Tabla | Filas aprox. | Rol |
|-------|-------------:|-----|
| `customers.csv` | 25.000 | Dimensión |
| `products.csv`  | ~320   | Dimensión |
| `stores.csv`    | ~70    | Dimensión |
| `rentals.csv`   | 75.000–100.000 | **Tabla de hechos** |

10 categorías (Bicicletas, Esquí, Snowboard, Paddle Surf, Kayak, Camping, Escalada,
Running, Fitness, Raquetas) y 7 países (España, Francia, Italia, Alemania, Portugal,
Bélgica, Países Bajos).

### Reglas de negocio incorporadas
El dataset **no es aleatorio**: las variables dependen unas de otras.
- **Estacionalidad:** esquí/snowboard ≈ invierno; camping/kayak/paddle ≈ verano;
  bicicletas en primavera/verano; running todo el año; fitness sube en invierno.
- **Temporalidad:** más reservas en fin de semana y festivos; picos de volumen en
  verano e invierno; crecimiento interanual.
- **Cliente:** socios Premium/Gold cancelan menos; clientes frecuentes/VIP puntúan mejor.
- **Producto:** mayor antigüedad, duración e intensidad de uso → más averías y
  mantenimiento.
- **Precio dinámico:** `rental_price` = f(categoría, duración, temporada, país, demanda),
  con descuento por nivel de socio.

### Calidad del dato (problemas deliberados)
Para practicar limpieza real: ~1 % duplicados, ~2 % de nulos por columna, fechas
inconsistentes, reviews imposibles, outliers, categorías mal escritas y texto con
mayúsculas/espacios inconsistentes — **sin invalidar** el conjunto.

> 📖 El **diccionario de datos completo** (columnas, tipos, cardinalidades y KPIs) está en
> [`output/README.md`](output/README.md), generado automáticamente por el script.

### Modelo de datos (esquema estrella)
```
customers ─┐
products  ─┼──<  rentals   (fact table)
stores    ─┘
```
Cardinalidades: `customers 1—N rentals`, `products 1—N rentals`, `stores 1—N rentals`.

---

## 📊 Parte 2 · Notebook de análisis (`rental_analysis.ipynb`)

Un análisis orientado a **negocio y producto**: encuentra oportunidades de mejora y las
prioriza por impacto. Alterna **SQL** (celdas `%%sql`) y **Python** para el análisis
avanzado.

### Contenido (10 secciones)
1. **Introducción** — contexto, objetivos, hipótesis y catálogo de KPIs.
2. **Carga y validación** — lectura, comprobación de PK/FK, merge del modelo estrella.
3. **Data Quality Assessment** — missing, duplicados, tipos, valores imposibles, outliers
   (IQR), categorías inconsistentes y un **Data Trust Score** (0–100), con pipeline de
   limpieza documentado.
4. **Ingeniería de variables** — Occupancy Rate, Utilization, Revenue per Unit, Profit,
   Margin, Maintenance Ratio, Cancellation/Late/Damage Rate, Customer Lifetime Rental Value.
5. **SQL** — top tiendas, categorías, productos infrautilizados/saturados, clientes más
   activos, ingresos por país, evolución mensual y ranking de ciudades.
6. **EDA** — heatmap estacional, series temporales con media móvil, boxplot, violin,
   scatter/bubble, treemap y matriz de correlación. Cada gráfico responde una pregunta.
7. **Estadística** — correlaciones con significación, **regresión OLS** de precio,
   **regresión logística** de cancelación e **intervalos de confianza**.
8. **Insights consolidados** — conclusiones accionables.
9. **Recomendaciones** — inventario, pricing, mantenimiento, campañas, forecasting,
   segmentación (priorizadas por impacto/esfuerzo).
10. **Producción** — cómo industrializarlo: dbt, Lakehouse (medallion), Data Mart,
    Tableau, Git/CI, tests de calidad, alertas, catálogo de métricas y Data Contracts.

### Compatibilidad Databricks ↔ VSCode
Las celdas `%%sql` se ejecutan **localmente con DuckDB** (motor SQL embebido, equivalente
funcional a *Databricks SQL* sobre las mismas tablas). En Databricks se usaría `%sql`
nativo sobre las tablas del Lakehouse. Incluye una demo **opcional** de transformación con
PySpark, controlada por el flag `RUN_PYSPARK` (desactivada por defecto para no depender de
un runtime Spark local).

---

## 🛠️ Stack tecnológico

| Uso | Librerías |
|-----|-----------|
| Generación de datos | `pandas`, `numpy`, `faker` |
| Análisis y visualización | `pandas`, `numpy`, `matplotlib`, `seaborn`, `plotly` |
| Estadística | `scipy`, `statsmodels` |
| SQL local | `duckdb` |
| Notebook | `ipykernel` (extensión Jupyter de VSCode) |
| Opcional (escala) | `pyspark` (requiere Java; nativo en Databricks) |

Versiones fijadas en [`requirements.txt`](requirements.txt).

---

## 🔁 Reproducibilidad
El generador usa un `numpy.random.Generator` con semilla fija (`SEED = 42`) propagada a
NumPy, `random` y Faker. El notebook se apoya en esos datos deterministas, por lo que los
resultados (KPIs, modelos, Data Trust Score) son estables entre ejecuciones.

---

## 🎯 KPIs principales
Occupancy Rate · Utilization · Revenue per Inventory Unit · Gross Profit · Margin ·
Maintenance Ratio · Cancellation Rate · Late Return Rate · Damage Rate ·
Customer Lifetime Rental Value (CLRV). Definiciones detalladas en el notebook (sección 4)
y en [`output/README.md`](output/README.md).
