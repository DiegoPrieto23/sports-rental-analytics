"""
generate_dataset.py
====================

Generador de datos sintéticos para el negocio de **Alquiler de material
deportivo (Rental / Rent)** de un retailer europeo.

El objetivo es producir un dataset realista, con relaciones lógicas entre
variables y patrones de negocio coherentes (estacionalidad, comportamiento
de cliente, desgaste de producto, precios dinámicos...), pensado como base
para un notebook de análisis avanzado (EDA, modelización, KPIs de negocio).

Modelo de datos (esquema estrella):

    customers ─┐
    products  ─┼──<  rentals   (tabla de hechos)
    stores    ─┘

Salida:
    output/customers.csv
    output/products.csv
    output/stores.csv
    output/rentals.csv
    output/README.md

Reproducibilidad: todo el aleatorio se controla con una única semilla
(`SEED`) propagada a NumPy, `random` y Faker.

Autor: Analytics Engineering - Sports Rental
Dependencias: pandas, numpy, faker (stdlib: datetime, random, pathlib)
"""

from __future__ import annotations

import random
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from faker import Faker

# ---------------------------------------------------------------------------
# 1. CONFIGURACIÓN GLOBAL Y REPRODUCIBILIDAD
# ---------------------------------------------------------------------------

SEED = 42

# Generador NumPy moderno (preferible a np.random.seed global).
rng = np.random.default_rng(SEED)
random.seed(SEED)
fake = Faker()
Faker.seed(SEED)

OUTPUT_DIR = Path(__file__).resolve().parent / "output"

# Ventana temporal del negocio (4 años y medio de histórico, 55 meses).
START_DATE = date(2022, 1, 1)
END_DATE = date(2026, 7, 31)
# Fecha de corte "hoy" para snapshots de cliente (antigüedad, etc.).
# Debe ser POSTERIOR a END_DATE: si cayera dentro de la ventana habría clientes
# con alquileres registrados después de la foto que describe su antigüedad.
SNAPSHOT_DATE = date(2026, 8, 1)

# Volumen objetivo. Se sortea dentro del rango pedido de forma reproducible.
# Dimensionado para mantener ~3.250 alquileres/mes al ampliar la ventana: si se
# cambian las fechas sin tocar esto, el negocio "encoge" y todos los KPI
# mensuales caen sin que haya pasado nada en el dominio.
N_RENTALS = int(rng.integers(170_000, 190_001))
N_CUSTOMERS = 45_000

# Índice de demanda por año. Perfil de recuperación y madurez: 2022 sale del
# bache, 2023-2024 crecen fuerte, 2025 modera y 2026 se estabiliza. Es lo que
# hace que la comparación contra el periodo anterior del informe diga algo.
YEAR_GROWTH = {2022: 0.80, 2023: 1.00, 2024: 1.20, 2025: 1.38, 2026: 1.52}

SEASONS = ["Winter", "Spring", "Summer", "Autumn"]

# ---------------------------------------------------------------------------
# 2. CATÁLOGO DE NEGOCIO (parámetros por categoría de producto)
# ---------------------------------------------------------------------------
# Cada categoría concentra en un único diccionario todos los parámetros que
# gobiernan su comportamiento: estacionalidad, precio base/día, rango de
# precio de compra, duración típica de alquiler, intensidad de desgaste,
# lead time medio de reserva, submarcas propias y vocabulario de modelo.
#
# `seasonal_weights` son pesos relativos de demanda por estación; se
# normalizan al muestrear y también derivan el factor estacional de precio.

CATEGORY_CONFIG = {
    "Bicicletas": {
        "sport": "Ciclismo",
        "seasonal_weights": {"Winter": 0.40, "Spring": 1.30, "Summer": 1.40, "Autumn": 0.90},
        "base_daily_price": 15.0,
        "purchase_price_range": (150, 1500),
        "avg_rental_days": 2,
        "damage_intensity": 0.80,
        "lead_time_mean": 4,
        "brands": ["Veloq", "Terrano", "Corsa", "Urbano"],
        "models": ["MTB", "Trail", "Road", "City", "E-Bike", "Gravel"],
    },
    "Esquí": {
        "sport": "Esquí Alpino",
        "seasonal_weights": {"Winter": 2.60, "Spring": 0.18, "Summer": 0.02, "Autumn": 0.20},
        "base_daily_price": 25.0,
        "purchase_price_range": (200, 700),
        "avg_rental_days": 4,
        "damage_intensity": 0.70,
        "lead_time_mean": 22,
        "brands": ["Nevado"],
        "models": ["Boost", "Cross", "Freeride", "Piste", "AllMountain"],
    },
    "Snowboard": {
        "sport": "Snowboard",
        "seasonal_weights": {"Winter": 2.40, "Spring": 0.15, "Summer": 0.02, "Autumn": 0.16},
        "base_daily_price": 24.0,
        "purchase_price_range": (200, 650),
        "avg_rental_days": 4,
        "damage_intensity": 0.90,
        "lead_time_mean": 18,
        "brands": ["Driftline"],
        "models": ["Carve", "Park", "Powder", "AllRound"],
    },
    "Paddle Surf": {
        "sport": "Paddle Surf",
        "seasonal_weights": {"Winter": 0.05, "Spring": 0.45, "Summer": 1.60, "Autumn": 0.30},
        "base_daily_price": 18.0,
        "purchase_price_range": (250, 900),
        "avg_rental_days": 2,
        "damage_intensity": 0.40,
        "lead_time_mean": 6,
        "brands": ["Aquia"],
        "models": ["Touring", "Race", "Inflatable", "Compact"],
    },
    "Kayak": {
        "sport": "Piragüismo",
        "seasonal_weights": {"Winter": 0.10, "Spring": 0.60, "Summer": 1.40, "Autumn": 0.40},
        "base_daily_price": 20.0,
        "purchase_price_range": (200, 1200),
        "avg_rental_days": 2,
        "damage_intensity": 0.50,
        "lead_time_mean": 7,
        "brands": ["Aquia"],
        "models": ["Sit-On", "Touring", "Whitewater", "Tandem"],
    },
    "Camping": {
        "sport": "Camping",
        "seasonal_weights": {"Winter": 0.15, "Spring": 0.70, "Summer": 1.70, "Autumn": 0.50},
        "base_daily_price": 12.0,
        "purchase_price_range": (60, 600),
        "avg_rental_days": 4,
        "damage_intensity": 0.50,
        "lead_time_mean": 12,
        "brands": ["Bivac", "Nomada"],
        "models": ["QuickTent", "CT100", "Trail900", "Sendero", "Base"],
    },
    "Escalada": {
        "sport": "Escalada",
        "seasonal_weights": {"Winter": 0.60, "Spring": 1.00, "Summer": 0.90, "Autumn": 1.00},
        "base_daily_price": 14.0,
        "purchase_price_range": (40, 400),
        "avg_rental_days": 2,
        "damage_intensity": 0.60,
        "lead_time_mean": 5,
        "brands": ["Granit"],
        "models": ["Rock", "Edge", "Ascent", "Cliff"],
    },
    "Running": {
        "sport": "Running",
        "seasonal_weights": {"Winter": 0.90, "Spring": 1.00, "Summer": 0.90, "Autumn": 1.00},
        "base_daily_price": 8.0,
        "purchase_price_range": (40, 200),
        "avg_rental_days": 1,
        "damage_intensity": 0.20,
        "lead_time_mean": 2,
        "brands": ["Zancada", "Pulso"],
        "models": ["RN500", "Run", "Support", "Comfort"],
    },
    "Fitness": {
        "sport": "Fitness",
        "seasonal_weights": {"Winter": 1.20, "Spring": 0.90, "Summer": 0.70, "Autumn": 1.00},
        "base_daily_price": 10.0,
        "purchase_price_range": (50, 900),
        "avg_rental_days": 6,
        "damage_intensity": 0.30,
        "lead_time_mean": 5,
        "brands": ["Corpus", "Ferra"],
        "models": ["Home", "Bench", "Rower", "Elliptical", "Weights"],
    },
    "Raquetas": {
        "sport": "Deportes de Raqueta",
        "seasonal_weights": {"Winter": 0.50, "Spring": 1.10, "Summer": 1.20, "Autumn": 0.90},
        "base_daily_price": 9.0,
        "purchase_price_range": (30, 300),
        "avg_rental_days": 2,
        "damage_intensity": 0.30,
        "lead_time_mean": 3,
        "brands": ["Volea", "Smashly"],
        "models": ["RQ160", "Feel", "Control", "Power"],
    },
}

# Factor de precio por país (mix de poder adquisitivo / posicionamiento).
COUNTRY_PRICE_FACTOR = {
    "España": 0.95,
    "Francia": 1.05,
    "Italia": 1.00,
    "Alemania": 1.10,
    "Portugal": 0.90,
    "Bélgica": 1.05,
    "Países Bajos": 1.08,
}

# Catálogo de ciudades donde opera el servicio. `tourism=True` marca plazas
# con fuerte estacionalidad turística (mayor demanda en picos de temporada).
CITY_CATALOG = [
    ("Madrid", "España", False), ("Barcelona", "España", True),
    ("Valencia", "España", True), ("Sevilla", "España", True),
    ("Málaga", "España", True), ("Bilbao", "España", False),
    ("Zaragoza", "España", False), ("Granada", "España", True),
    ("Paris", "Francia", True), ("Lyon", "Francia", False),
    ("Marseille", "Francia", True), ("Toulouse", "Francia", False),
    ("Nice", "Francia", True), ("Bordeaux", "Francia", False),
    ("Chamonix", "Francia", True), ("Annecy", "Francia", True),
    ("Roma", "Italia", True), ("Milano", "Italia", False),
    ("Napoli", "Italia", True), ("Torino", "Italia", False),
    ("Venezia", "Italia", True), ("Firenze", "Italia", True),
    ("Bologna", "Italia", False), ("Cortina", "Italia", True),
    ("Berlin", "Alemania", False), ("München", "Alemania", True),
    ("Hamburg", "Alemania", False), ("Köln", "Alemania", False),
    ("Frankfurt", "Alemania", False), ("Garmisch", "Alemania", True),
    ("Lisboa", "Portugal", True), ("Porto", "Portugal", True),
    ("Faro", "Portugal", True), ("Braga", "Portugal", False),
    ("Coimbra", "Portugal", False),
    ("Bruxelles", "Bélgica", False), ("Antwerpen", "Bélgica", False),
    ("Gent", "Bélgica", True), ("Brugge", "Bélgica", True),
    ("Liège", "Bélgica", False),
    ("Amsterdam", "Países Bajos", True), ("Rotterdam", "Países Bajos", False),
    ("Utrecht", "Países Bajos", False), ("Eindhoven", "Países Bajos", False),
    ("Den Haag", "Países Bajos", True), ("Groningen", "Países Bajos", False),
]

# Pesos de demanda / capacidad por tamaño de tienda.
STORE_SIZE_CONFIG = {
    "Small": {"prob": 0.35, "weight": 1.0, "visitors": 120_000},
    "Medium": {"prob": 0.40, "weight": 2.2, "visitors": 350_000},
    "Large": {"prob": 0.20, "weight": 4.0, "visitors": 800_000},
    "Flagship": {"prob": 0.05, "weight": 7.0, "visitors": 1_800_000},
}

CUSTOMER_SEGMENTS = ["Occasional", "Regular", "Frequent", "VIP"]
# Peso de aparición en alquileres (los VIP alquilan mucho más a menudo).
SEGMENT_ACTIVITY_WEIGHT = {"Occasional": 1.0, "Regular": 2.5, "Frequent": 6.0, "VIP": 12.0}
# Lambda base de alquileres históricos por segmento.
SEGMENT_HISTORY_LAMBDA = {"Occasional": 2, "Regular": 8, "Frequent": 25, "VIP": 60}
# Se usa "Basic" (no "None") para evitar que pandas lo interprete como NaN al leer.
MEMBERSHIP_LEVELS = ["Basic", "Standard", "Premium", "Gold"]
MEMBERSHIP_DISCOUNT = {"Basic": 1.00, "Standard": 0.98, "Premium": 0.93, "Gold": 0.90}


# ---------------------------------------------------------------------------
# 3. UTILIDADES
# ---------------------------------------------------------------------------

def sigmoid(x: np.ndarray) -> np.ndarray:
    """Función logística, para modelar probabilidades a partir de un score."""
    return 1.0 / (1.0 + np.exp(-x))


def season_from_month(month: np.ndarray) -> np.ndarray:
    """Deriva la estación (hemisferio norte) a partir del número de mes."""
    out = np.empty(len(month), dtype=object)
    out[np.isin(month, [12, 1, 2])] = "Winter"
    out[np.isin(month, [3, 4, 5])] = "Spring"
    out[np.isin(month, [6, 7, 8])] = "Summer"
    out[np.isin(month, [9, 10, 11])] = "Autumn"
    return out


def build_holidays(years: range) -> set[pd.Timestamp]:
    """Conjunto de festivos europeos clave (aproximados) para dar picos de demanda."""
    fixed = [(1, 1), (5, 1), (8, 15), (10, 12), (11, 1),
             (12, 6), (12, 8), (12, 25), (12, 26), (12, 31)]
    # Domingo de Pascua aproximado por año (motor de demanda de invierno/primavera).
    # Debe cubrir todos los años de la ventana: un año ausente no rompe nada, pero
    # se queda sin su pico de Semana Santa y la estacionalidad cojea ese año.
    easter = {2022: (4, 17), 2023: (4, 9), 2024: (3, 31), 2025: (4, 20), 2026: (4, 5)}
    holidays: set[pd.Timestamp] = set()
    for year in years:
        for month, day in fixed:
            holidays.add(pd.Timestamp(year, month, day))
        if year in easter:
            e_month, e_day = easter[year]
            holidays.add(pd.Timestamp(year, e_month, e_day))
            holidays.add(pd.Timestamp(year, e_month, e_day) - pd.Timedelta(days=2))  # Viernes Santo
    return holidays


# ---------------------------------------------------------------------------
# 4. GENERACIÓN DE DIMENSIONES
# ---------------------------------------------------------------------------

def generate_stores() -> pd.DataFrame:
    """Genera la dimensión de tiendas repartidas por ciudades y países europeos.

    El tamaño de tienda condiciona su peso de demanda y sus visitantes anuales.
    Las grandes ciudades reciben una segunda tienda para dar densidad realista.
    """
    records = []
    store_seq = 1
    for city, country, tourism in CITY_CATALOG:
        # Las plazas turísticas o capitales tienden a concentrar más tiendas.
        n_stores = 2 if tourism else 1
        for _ in range(n_stores):
            size = rng.choice(
                list(STORE_SIZE_CONFIG),
                p=[STORE_SIZE_CONFIG[s]["prob"] for s in STORE_SIZE_CONFIG],
            )
            base_visitors = STORE_SIZE_CONFIG[size]["visitors"]
            # Ruido lognormal alrededor de la media de visitantes del tamaño.
            visitors = int(base_visitors * rng.lognormal(mean=0.0, sigma=0.20))
            records.append({
                "store_id": f"S{store_seq:03d}",
                "store_name": f"Sportia {city} {fake.bothify('??').upper()}",
                "city": city,
                "country": country,
                "store_size": size,
                "annual_visitors": visitors,
                # Campos auxiliares (no exportados) para las reglas de negocio.
                "_tourism": tourism,
                "_weight": STORE_SIZE_CONFIG[size]["weight"] * (1.4 if tourism else 1.0),
            })
            store_seq += 1
    return pd.DataFrame(records)


def generate_products() -> pd.DataFrame:
    """Genera la dimensión de productos alquilables por categoría.

    Cada categoría instancia entre 20 y 45 referencias con precios, coste de
    reposición, intervalo de mantenimiento, antigüedad e inventario coherentes.
    """
    records = []
    product_seq = 1
    for category, cfg in CATEGORY_CONFIG.items():
        n_products = int(rng.integers(20, 45))
        lo, hi = cfg["purchase_price_range"]
        for _ in range(n_products):
            purchase_price = round(float(rng.uniform(lo, hi)), 2)
            # La reposición añade logística/margen sobre el precio de compra.
            replacement_cost = round(purchase_price * float(rng.uniform(1.05, 1.35)), 2)
            brand = rng.choice(cfg["brands"])
            model = rng.choice(cfg["models"])
            records.append({
                "product_id": f"P{product_seq:05d}",
                "category": category,
                "sport": cfg["sport"],
                "product_name": f"{brand} {model} {fake.bothify('##').upper()}",
                "purchase_price": purchase_price,
                "replacement_cost": replacement_cost,
                "maintenance_interval": int(rng.choice([30, 45, 60, 90, 120, 180])),
                "product_age": round(float(rng.uniform(0, 8)), 1),
                "inventory_units": int(rng.integers(5, 60)),
                # Auxiliar (no exportado): dureza de uso para el modelo de averías.
                "_damage_intensity": cfg["damage_intensity"],
            })
            product_seq += 1
    return pd.DataFrame(records)


def generate_customers(n_customers: int) -> pd.DataFrame:
    """Genera la dimensión de clientes con segmentación y fidelización.

    El segmento (comportamental) y el nivel de socio (fidelización) están
    correlacionados y alimentan las reglas de cancelación, frecuencia y precio.
    """
    # Segmento comportamental.
    segment = rng.choice(CUSTOMER_SEGMENTS, size=n_customers, p=[0.50, 0.30, 0.15, 0.05])

    # Nivel de socio condicionado por el segmento (VIP -> Gold/Premium probables).
    membership_probs = {
        "Occasional": [0.60, 0.35, 0.05, 0.00],  # [Basic, Standard, Premium, Gold]
        "Regular": [0.25, 0.50, 0.20, 0.05],
        "Frequent": [0.05, 0.35, 0.45, 0.15],
        "VIP": [0.00, 0.10, 0.40, 0.50],
    }
    membership = np.empty(n_customers, dtype=object)
    for seg in CUSTOMER_SEGMENTS:
        mask = segment == seg
        membership[mask] = rng.choice(MEMBERSHIP_LEVELS, size=mask.sum(), p=membership_probs[seg])

    # Datos sociodemográficos.
    age = np.clip(rng.normal(38, 13, n_customers), 18, 78).astype(int)
    gender = rng.choice(["Male", "Female", "Other"], size=n_customers, p=[0.49, 0.48, 0.03])

    city_idx = rng.integers(0, len(CITY_CATALOG), size=n_customers)
    city = np.array([CITY_CATALOG[i][0] for i in city_idx])
    country = np.array([CITY_CATALOG[i][1] for i in city_idx])

    # Alta como socio en los últimos ~9 años. El rango tiene que cubrir con holgura
    # la ventana de alquileres (55 meses): los alquileres solo pueden asignarse a
    # clientes ya dados de alta, así que si casi nadie tuviera antigüedad anterior
    # a START_DATE los primeros meses se repartirían entre cuatro clientes.
    tenure_days = rng.integers(30, 9 * 365, size=n_customers)
    signup_date = np.array([SNAPSHOT_DATE - timedelta(days=int(d)) for d in tenure_days])
    tenure_years = tenure_days / 365.0

    # Histórico de alquileres: lambda por segmento escalada por antigüedad.
    lam = np.array([SEGMENT_HISTORY_LAMBDA[s] for s in segment])
    tenure_factor = np.clip(tenure_years / 3.0, 0.4, 1.6)
    total_previous = rng.poisson(lam * tenure_factor)

    customers = pd.DataFrame({
        "customer_id": [f"C{i:06d}" for i in range(1, n_customers + 1)],
        "age": age,
        "gender": gender,
        "country": country,
        "city": city,
        "customer_segment": segment,
        "membership_level": membership,
        "signup_date": signup_date,
        "total_previous_rentals": total_previous,
        # Auxiliar (no exportado): peso de actividad para el muestreo de alquileres.
        "_activity_weight": np.array([SEGMENT_ACTIVITY_WEIGHT[s] for s in segment]),
    })
    return customers


# ---------------------------------------------------------------------------
# 5. GENERACIÓN DE LA TABLA DE HECHOS (RENTALS)
# ---------------------------------------------------------------------------

def _sample_rental_dates(n: int) -> pd.DatetimeIndex:
    """Muestrea fechas de alquiler ponderando fines de semana, festivos,
    estacionalidad de volumen y crecimiento interanual del negocio."""
    all_days = pd.date_range(START_DATE, END_DATE, freq="D")
    holidays = build_holidays(range(START_DATE.year, END_DATE.year + 1))

    weekday_factor = np.where(all_days.weekday == 5, 1.7,          # sábado
                              np.where(all_days.weekday == 6, 1.4,  # domingo
                                       1.0))                        # laborable
    holiday_factor = np.where(all_days.normalize().isin(holidays), 1.8, 1.0)
    month_factor_map = {1: 1.20, 2: 1.15, 3: 1.00, 4: 1.05, 5: 1.10, 6: 1.25,
                        7: 1.40, 8: 1.35, 9: 1.10, 10: 1.00, 11: 0.95, 12: 1.25}
    month_factor = all_days.month.map(month_factor_map).to_numpy()
    # Crecimiento interanual: arranque flojo en 2022, recuperación fuerte en
    # 2023-2024, moderación en 2025 y estabilización en 2026. Un año que falte
    # aquí cae a 1.0, que es un escalón invisible en el dato pero muy visible en
    # la serie mensual del informe.
    year_factor = all_days.year.map(YEAR_GROWTH).to_numpy(dtype=float)

    weights = weekday_factor * holiday_factor * month_factor * year_factor
    probs = weights / weights.sum()
    idx = rng.choice(len(all_days), size=n, p=probs)
    return all_days[idx]


def _sample_categories(seasons: np.ndarray) -> np.ndarray:
    """Asigna una categoría a cada alquiler según los pesos estacionales
    (p. ej. esquí casi exclusivo de invierno, camping de verano)."""
    categories = list(CATEGORY_CONFIG)
    result = np.empty(len(seasons), dtype=object)
    for season in SEASONS:
        mask = seasons == season
        w = np.array([CATEGORY_CONFIG[c]["seasonal_weights"][season] for c in categories])
        result[mask] = rng.choice(categories, size=int(mask.sum()), p=w / w.sum())
    return result


def _sample_products(cat_per_row: np.ndarray, products: pd.DataFrame) -> np.ndarray:
    """Para cada alquiler elige un producto de su categoría, ponderando por
    unidades en inventario (más stock -> más rotación)."""
    result = np.empty(len(cat_per_row), dtype=object)
    for category in CATEGORY_CONFIG:
        mask = cat_per_row == category
        pool = products.loc[products["category"] == category]
        p = pool["inventory_units"].to_numpy(dtype=float)
        result[mask] = rng.choice(pool["product_id"].to_numpy(), size=int(mask.sum()), p=p / p.sum())
    return result


def _sample_booking_channel(age: np.ndarray) -> np.ndarray:
    """Canal de reserva por tramo de edad. Online + App son mayoría; los
    tramos jóvenes tiran de App y los mayores de tienda/teléfono."""
    channels = ["Online", "App", "Store", "Phone"]
    probs_by_bin = {
        "young": [0.40, 0.45, 0.10, 0.05],   # < 30
        "adult": [0.55, 0.25, 0.15, 0.05],   # 30-50
        "senior": [0.45, 0.10, 0.30, 0.15],  # > 50
    }
    result = np.empty(len(age), dtype=object)
    bins = np.where(age < 30, "young", np.where(age <= 50, "adult", "senior"))
    for b, probs in probs_by_bin.items():
        mask = bins == b
        result[mask] = rng.choice(channels, size=int(mask.sum()), p=probs)
    return result


def _sample_weather(seasons: np.ndarray) -> np.ndarray:
    """Meteorología correlada con la estación."""
    conditions = ["Sunny", "Cloudy", "Rainy", "Snowy", "Windy"]
    probs_by_season = {
        "Winter": [0.15, 0.30, 0.25, 0.20, 0.10],
        "Spring": [0.40, 0.25, 0.20, 0.02, 0.13],
        "Summer": [0.65, 0.18, 0.07, 0.00, 0.10],
        "Autumn": [0.30, 0.30, 0.25, 0.03, 0.12],
    }
    result = np.empty(len(seasons), dtype=object)
    for season in SEASONS:
        mask = seasons == season
        result[mask] = rng.choice(conditions, size=int(mask.sum()), p=probs_by_season[season])
    return result


def generate_rentals(customers: pd.DataFrame,
                     products: pd.DataFrame,
                     stores: pd.DataFrame,
                     n_rentals: int) -> pd.DataFrame:
    """Genera la tabla de hechos de alquileres encadenando reglas de negocio.

    El orden de derivación importa: primero fecha -> estación -> categoría ->
    producto, luego cliente/tienda, y a partir de ahí todas las variables
    derivadas (duración, cancelación, devolución, averías, precio, review...).
    """
    # --- Claves temporales y de dimensión ---------------------------------
    rental_dates = _sample_rental_dates(n_rentals)
    months = rental_dates.month.to_numpy()
    seasons = season_from_month(months)
    is_weekend = rental_dates.weekday.to_numpy() >= 5
    holidays = build_holidays(range(START_DATE.year, END_DATE.year + 1))
    is_holiday = rental_dates.normalize().isin(holidays)

    cat_per_row = _sample_categories(seasons)
    product_ids = _sample_products(cat_per_row, products)

    # Selección de tienda ponderada por tamaño y atractivo turístico.
    store_w = stores["_weight"].to_numpy()
    store_pos = rng.choice(len(stores), size=n_rentals, p=store_w / store_w.sum())
    store_ids = stores["store_id"].to_numpy()[store_pos]
    store_tourism = stores["_tourism"].to_numpy()[store_pos]
    store_large = np.isin(stores["store_size"].to_numpy()[store_pos], ["Large", "Flagship"])
    store_country = stores["country"].to_numpy()[store_pos]

    # Selección de cliente ponderada por actividad (los frecuentes aparecen más)
    # y restringida a quien YA ESTABA DADO DE ALTA ese día. Sin esa condición, el
    # cliente se sorteaba de todo el padrón y un 21 % de los alquileres quedaba
    # fechado antes del signup_date de su propio cliente; al ampliar la ventana a
    # 55 meses habría pasado del tercio.
    #
    # Se hace por CDF inversa sobre el prefijo elegible: ordenando el padrón por
    # fecha de alta, "los de alta anterior o igual al día X" es siempre un prefijo
    # del array, así que basta con truncar la acumulada de pesos en ese punto.
    # Vectorizado: dos searchsorted sobre 180k filas, frente a un muestreo por
    # fila que tardaría minutos.
    order = np.argsort(pd.to_datetime(customers["signup_date"]).to_numpy(), kind="stable")
    signup_sorted = pd.to_datetime(customers["signup_date"]).to_numpy()[order]
    cum_w = np.cumsum(customers["_activity_weight"].to_numpy()[order])

    n_eligible = np.searchsorted(signup_sorted, rental_dates.to_numpy(), side="right")
    if (n_eligible == 0).any():
        raise ValueError(
            "Hay alquileres anteriores al alta del cliente más antiguo: amplía el "
            "rango de antigüedad en generate_customers o retrasa START_DATE.")
    u = rng.random(n_rentals) * cum_w[n_eligible - 1]
    cust_pos = order[np.searchsorted(cum_w, u, side="right").clip(max=len(order) - 1)]
    customer_ids = customers["customer_id"].to_numpy()[cust_pos]
    cust_age = customers["age"].to_numpy()[cust_pos]
    cust_segment = customers["customer_segment"].to_numpy()[cust_pos]
    cust_membership = customers["membership_level"].to_numpy()[cust_pos]

    # --- Atributos de producto alineados por fila -------------------------
    prod_lookup = products.set_index("product_id")
    product_age = prod_lookup["product_age"].reindex(product_ids).to_numpy()
    purchase_price = prod_lookup["purchase_price"].reindex(product_ids).to_numpy()
    replacement_cost = prod_lookup["replacement_cost"].reindex(product_ids).to_numpy()
    damage_intensity = prod_lookup["_damage_intensity"].reindex(product_ids).to_numpy()

    # Parámetros de categoría vectorizados.
    cat_series = pd.Series(cat_per_row)
    avg_days = cat_series.map(lambda c: CATEGORY_CONFIG[c]["avg_rental_days"]).to_numpy()
    lead_mean = cat_series.map(lambda c: CATEGORY_CONFIG[c]["lead_time_mean"]).to_numpy()
    base_daily = cat_series.map(lambda c: CATEGORY_CONFIG[c]["base_daily_price"]).to_numpy()

    # --- Duración del alquiler --------------------------------------------
    rental_days = np.clip(rng.poisson(avg_days) + 1, 1, 30)

    # --- Reserva y lead time ----------------------------------------------
    # Lead time exponencial por categoría (esquí/camping se reservan con
    # antelación); fin de semana empuja algo más la anticipación.
    lead_time = rng.exponential(lead_mean) * np.where(is_weekend, 1.1, 1.0)
    lead_time = np.clip(np.round(lead_time), 0, 120).astype(int)
    reservation_date = rental_dates - pd.to_timedelta(lead_time, unit="D")

    booking_channel = _sample_booking_channel(cust_age)

    # --- Cancelación -------------------------------------------------------
    # Base 8%; los socios Premium/Gold y los segmentos frecuentes cancelan
    # menos; un lead time largo da más margen a cambiar de planes.
    cancel_logit = (-2.45
                    + np.isin(cust_membership, ["Premium", "Gold"]) * -0.7
                    + np.isin(cust_segment, ["Frequent", "VIP"]) * -0.5
                    + (lead_time / 60.0) * 0.6)
    cancelled = rng.random(n_rentals) < sigmoid(cancel_logit)

    # --- Devolución tardía -------------------------------------------------
    # Aumenta con la duración del alquiler.
    late_prob = np.clip(0.04 + 0.012 * rental_days, 0, 0.5)
    late_return = (rng.random(n_rentals) < late_prob) & ~cancelled
    late_days = np.where(late_return, rng.integers(1, 6, n_rentals), 0)
    return_date = rental_dates + pd.to_timedelta(rental_days + late_days, unit="D")

    # --- Averías -----------------------------------------------------------
    # Depende de antigüedad del producto, duración/uso e intensidad de la
    # categoría (snowboard/bici desgastan más que running/fitness).
    damage_logit = (-4.2 + 0.22 * product_age + 0.10 * rental_days
                    + 2.0 * damage_intensity)
    damage_reported = (rng.random(n_rentals) < sigmoid(damage_logit)) & ~cancelled

    # --- Coste de mantenimiento -------------------------------------------
    # Mayor uso -> más mantenimiento; las averías disparan la reparación.
    maintenance_cost = (5.0
                        + rental_days * purchase_price * 0.0015
                        + damage_reported * replacement_cost * 0.15
                        + rng.normal(0, 2, n_rentals))
    maintenance_cost = np.round(np.clip(maintenance_cost, 0, None), 2)

    # --- Precio del alquiler ----------------------------------------------
    # base_daily * duración * factor_estacional * factor_país * demanda * descuento.
    season_factor = np.array([
        0.80 + 0.5 * (CATEGORY_CONFIG[c]["seasonal_weights"][s]
                      / max(CATEGORY_CONFIG[c]["seasonal_weights"].values()))
        for c, s in zip(cat_per_row, seasons)
    ])
    country_factor = pd.Series(store_country).map(COUNTRY_PRICE_FACTOR).to_numpy()
    tourism_peak = store_tourism & np.isin(seasons, ["Summer", "Winter"])
    demand_factor = (1.0 + 0.10 * is_weekend + 0.15 * is_holiday
                     + 0.05 * store_large + 0.08 * tourism_peak)
    discount = pd.Series(cust_membership).map(MEMBERSHIP_DISCOUNT).to_numpy()
    price_noise = np.clip(rng.normal(1.0, 0.06, n_rentals), 0.8, 1.3)

    rental_price = (base_daily * rental_days * season_factor * country_factor
                    * demand_factor * discount * price_noise)
    rental_price = np.round(rental_price, 2)

    # --- Review score (escala 1-5) ----------------------------------------
    # Peor con averías, retrasos, esperas largas y productos viejos; mejor en
    # clientes frecuentes/premium.
    review = (4.4
              - 1.2 * damage_reported
              - 0.8 * late_return
              - 0.15 * product_age
              - 0.010 * lead_time
              + 0.30 * np.isin(cust_segment, ["Frequent", "VIP"])
              + 0.10 * np.isin(cust_membership, ["Premium", "Gold"])
              + rng.normal(0, 0.5, n_rentals))
    review_score = np.clip(np.round(review), 1, 5)
    # ~30% de alquileres no dejan valoración.
    no_review = rng.random(n_rentals) < 0.30
    review_score = np.where(no_review, np.nan, review_score)

    # --- Ensamblado --------------------------------------------------------
    weather = _sample_weather(seasons)
    rentals = pd.DataFrame({
        "rental_id": [f"R{i:08d}" for i in range(1, n_rentals + 1)],
        "customer_id": customer_ids,
        "product_id": product_ids,
        "store_id": store_ids,
        "rental_date": rental_dates,
        "return_date": return_date,
        "rental_days": rental_days,
        "reservation_date": reservation_date,
        "reservation_lead_time": lead_time,
        "cancelled": cancelled,
        "late_return": late_return,
        "damage_reported": damage_reported,
        "review_score": review_score,
        "booking_channel": booking_channel,
        "rental_price": rental_price,
        "maintenance_cost": maintenance_cost,
        "weather": weather,
        "season": seasons,
    })

    # Un alquiler cancelado no llega a materializarse: se anulan los campos
    # posteriores a la entrega del material.
    cancel_mask = rentals["cancelled"].to_numpy()
    rentals.loc[cancel_mask, "return_date"] = pd.NaT
    rentals.loc[cancel_mask, "late_return"] = False
    rentals.loc[cancel_mask, "damage_reported"] = False
    rentals.loc[cancel_mask, "review_score"] = np.nan
    rentals.loc[cancel_mask, "maintenance_cost"] = 0.0

    return rentals


# ---------------------------------------------------------------------------
# 6. PROBLEMAS DE CALIDAD DEL DATO (introducidos deliberadamente)
# ---------------------------------------------------------------------------

def _corrupt_text(values: pd.Series, frac: float) -> pd.Series:
    """Ensucia una fracción de una columna de texto con variantes de mayúsculas,
    minúsculas y espacios en blanco sobrantes."""
    values = values.astype(object).copy()
    idx = values.dropna().sample(frac=frac, random_state=SEED).index
    transforms = [str.upper, str.lower, lambda s: f" {s}", lambda s: f"{s} ",
                  lambda s: s.title()]
    for i in idx:
        transform = transforms[int(rng.integers(0, len(transforms)))]
        values.at[i] = transform(str(values.at[i]))
    return values


def inject_quality_issues(rentals: pd.DataFrame,
                          products: pd.DataFrame,
                          customers: pd.DataFrame,
                          stores: pd.DataFrame) -> tuple[pd.DataFrame, ...]:
    """Introduce problemas de calidad realistas sin romper el dataset.

    Incluye duplicados, valores faltantes, fechas inconsistentes, reviews
    imposibles, outliers, categorías mal escritas y texto inconsistente.
    """
    n = len(rentals)

    # (a) Duplicados exactos (~1%): mismas filas repetidas (mismo rental_id).
    dup_idx = rng.choice(n, size=int(n * 0.01), replace=False)
    rentals = pd.concat([rentals, rentals.iloc[dup_idx]], ignore_index=True)

    # (b) Fechas inconsistentes (~0.5%): devolución anterior al alquiler.
    valid = rentals.index[rentals["return_date"].notna()]
    bad_dates = rng.choice(valid, size=int(len(valid) * 0.005), replace=False)
    rentals.loc[bad_dates, "return_date"] = (
        rentals.loc[bad_dates, "rental_date"] - pd.to_timedelta(
            rng.integers(1, 10, len(bad_dates)), unit="D")
    )

    # (c) Reviews imposibles (~0.3%): fuera de la escala 1-5.
    rev_idx = rng.choice(n, size=int(n * 0.003), replace=False)
    rentals.loc[rev_idx, "review_score"] = rng.choice([-1, 0, 6, 7, 10], size=len(rev_idx))

    # (d) Outliers (~0.2%): precios y duraciones absurdas, coste negativo.
    out_idx = rng.choice(n, size=int(n * 0.002), replace=False)
    rentals.loc[out_idx, "rental_price"] = rentals.loc[out_idx, "rental_price"] * 50
    rentals.loc[out_idx[: len(out_idx) // 2], "rental_days"] = 999
    rentals.loc[out_idx[len(out_idx) // 2:], "maintenance_cost"] = -rng.integers(10, 500)

    # (e) Valores faltantes (~2% por columna) en un subconjunto de columnas.
    for col in ["booking_channel", "weather", "rental_price", "review_score", "store_id"]:
        miss = rentals.sample(frac=0.02, random_state=int(rng.integers(0, 1e6))).index
        rentals.loc[miss, col] = np.nan

    # (f) Categorías mal escritas en el catálogo de productos.
    typos = {"Bicicletas": "Biciletas", "Esquí": "esqui", "Snowboard": "Snow Board",
             "Paddle Surf": "Paddle surf ", "Running": "RUNNING"}
    for good, bad in typos.items():
        cand = products.index[products["category"] == good]
        if len(cand):
            hit = rng.choice(cand, size=max(1, len(cand) // 12), replace=False)
            products.loc[hit, "category"] = bad

    # (g) Texto inconsistente (mayúsculas/minúsculas/espacios) en varias tablas.
    rentals["booking_channel"] = _corrupt_text(rentals["booking_channel"], 0.03)
    rentals["weather"] = _corrupt_text(rentals["weather"], 0.03)
    customers["country"] = _corrupt_text(customers["country"], 0.02)
    customers["gender"] = _corrupt_text(customers["gender"], 0.02)
    stores["country"] = _corrupt_text(stores["country"], 0.05)

    return rentals, products, customers, stores


# ---------------------------------------------------------------------------
# 7. EXPORTACIÓN Y DOCUMENTACIÓN
# ---------------------------------------------------------------------------

def _drop_helpers(df: pd.DataFrame) -> pd.DataFrame:
    """Elimina columnas auxiliares (prefijo '_') antes de exportar."""
    return df.drop(columns=[c for c in df.columns if c.startswith("_")])


def write_readme(output_dir: Path,
                 customers: pd.DataFrame,
                 products: pd.DataFrame,
                 stores: pd.DataFrame,
                 rentals: pd.DataFrame) -> None:
    """Genera un README.md documentando tablas, relaciones y KPIs."""
    readme = f"""# Sports Rental — Dataset sintético

Dataset sintético del servicio de **alquiler de material deportivo** de
un retailer europeo. Generado con `generate_dataset.py` (semilla `{SEED}`,
100% reproducible). No contiene datos reales.

## Volumen

| Tabla | Filas | Descripción |
|-------|------:|-------------|
| `customers.csv` | {len(customers):,} | Dimensión de clientes |
| `products.csv`  | {len(products):,} | Dimensión de productos alquilables |
| `stores.csv`    | {len(stores):,} | Dimensión de tiendas europeas |
| `rentals.csv`   | {len(rentals):,} | **Tabla de hechos** de alquileres |

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
"""
    (output_dir / "README.md").write_text(readme, encoding="utf-8")


def save_outputs(customers: pd.DataFrame,
                 products: pd.DataFrame,
                 stores: pd.DataFrame,
                 rentals: pd.DataFrame) -> None:
    """Escribe las cuatro tablas en CSV y genera el README."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    _drop_helpers(customers).to_csv(OUTPUT_DIR / "customers.csv", index=False)
    _drop_helpers(products).to_csv(OUTPUT_DIR / "products.csv", index=False)
    _drop_helpers(stores).to_csv(OUTPUT_DIR / "stores.csv", index=False)
    _drop_helpers(rentals).to_csv(OUTPUT_DIR / "rentals.csv", index=False)
    write_readme(OUTPUT_DIR, customers, products, stores, rentals)


# ---------------------------------------------------------------------------
# 8. ORQUESTACIÓN
# ---------------------------------------------------------------------------

def main() -> None:
    """Punto de entrada: genera dimensiones, hechos, ensucia y exporta."""
    print(f"[1/5] Generando tiendas...")
    stores = generate_stores()

    print(f"[2/5] Generando productos...")
    products = generate_products()

    print(f"[3/5] Generando {N_CUSTOMERS:,} clientes...")
    customers = generate_customers(N_CUSTOMERS)

    print(f"[4/5] Generando {N_RENTALS:,} alquileres...")
    rentals = generate_rentals(customers, products, stores, N_RENTALS)

    print(f"[5/5] Inyectando problemas de calidad y exportando...")
    rentals, products, customers, stores = inject_quality_issues(
        rentals, products, customers, stores)
    save_outputs(customers, products, stores, rentals)

    print("\nDataset generado en:", OUTPUT_DIR.resolve())
    print(f"  customers.csv : {len(customers):>8,} filas")
    print(f"  products.csv  : {len(products):>8,} filas")
    print(f"  stores.csv    : {len(stores):>8,} filas")
    print(f"  rentals.csv   : {len(rentals):>8,} filas (incluye duplicados)")


if __name__ == "__main__":
    main()
