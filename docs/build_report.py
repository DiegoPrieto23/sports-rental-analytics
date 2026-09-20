"""
build_report.py
===============

Genera `docs/informe.html`: un informe interactivo autocontenido sobre los CSV de
`output/`, sin dependencias externas en tiempo de ejecucion (ni CDN ni servidor).

Aplica el mismo pipeline de limpieza y las mismas definiciones de metricas que
`rental_analysis.ipynb`, de modo que los KPIs del informe y los del notebook
coinciden cifra a cifra.

La tabla de hechos limpia (77.231 filas) viaja dentro del HTML codificada en
columnas binarias -> deflate -> base64 (~690 KB), asi que todos los filtros se
cruzan de forma exacta en el navegador: no hay preagregados que limiten los
cortes posibles. Las filas se ordenan por producto y mes antes de comprimir,
porque la localidad mejora la compresion en ~200 KB.

Uso:
    python docs/build_report.py

Salida:
    docs/informe.html                 documento completo (doble clic)
    docs/_informe_fragment.html       mismo contenido sin <html>/<head>/<body>
"""

from __future__ import annotations

import base64
import json
import zlib
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "output"
DOCS_DIR = ROOT / "docs"

# ---------------------------------------------------------------------------
# 1. Orden canonico de las dimensiones (fija el codigo numerico de cada valor)
# ---------------------------------------------------------------------------

CATEGORIES = ["Bicicletas", "Esquí", "Snowboard", "Paddle Surf", "Kayak",
              "Camping", "Escalada", "Running", "Fitness", "Raquetas"]
CHANNELS = ["Online", "App", "Store", "Phone"]
CHANNEL_LABELS = {"Online": "Online", "App": "App", "Store": "Tienda", "Phone": "Teléfono"}
MEMBERS = ["Basic", "Standard", "Premium", "Gold"]
SEGMENTS = ["Occasional", "Regular", "Frequent", "VIP"]
SEASONS = ["Winter", "Spring", "Summer", "Autumn"]
SEASON_LABELS = {"Winter": "Invierno", "Spring": "Primavera",
                 "Summer": "Verano", "Autumn": "Otoño"}
SIZES = ["Small", "Medium", "Large", "Flagship"]

CATEGORY_MAP = {
    "bicicletas": "Bicicletas", "biciletas": "Bicicletas",
    "esqui": "Esquí", "esquí": "Esquí",
    "snowboard": "Snowboard", "snow board": "Snowboard",
    "paddle surf": "Paddle Surf", "kayak": "Kayak", "camping": "Camping",
    "escalada": "Escalada", "running": "Running", "fitness": "Fitness",
    "raquetas": "Raquetas",
}
CANONICAL_CATEGORIES = set(CATEGORIES)

# ---------------------------------------------------------------------------
# 2. Pipeline de limpieza (identico al de la seccion 3.1 del notebook)
# ---------------------------------------------------------------------------


def standardize_text(series):
    return series.astype("string").str.strip().str.title()


def canon_category(series):
    key = series.astype("string").str.strip().str.lower()
    return key.map(CATEGORY_MAP).fillna(series)


def dedupe_rental_ids(df):
    """Caso A: filas 100% duplicadas. Caso B: PK repetida con datos en conflicto."""
    df = df.drop_duplicates().copy()
    df["_nulls"] = df.isna().sum(axis=1)
    df = (df.sort_values(["rental_id", "_nulls", "rental_date"],
                         ascending=[True, True, False])
            .drop_duplicates("rental_id", keep="first")
            .drop(columns="_nulls"))
    return df


def clean_rentals(df):
    df = dedupe_rental_ids(df)
    df["review_score"] = df["review_score"].where(df["review_score"].between(1, 5))
    df["rental_price"] = df["rental_price"].where(df["rental_price"].between(0.01, 2000))
    df["rental_days"] = df["rental_days"].where(df["rental_days"].between(1, 30))
    df["maintenance_cost"] = df["maintenance_cost"].where(df["maintenance_cost"] >= 0)
    bad_dates = df["return_date"].notna() & (df["return_date"] < df["rental_date"])
    df.loc[bad_dates, "return_date"] = pd.NaT
    df["booking_channel"] = standardize_text(df["booking_channel"])
    df["weather"] = standardize_text(df["weather"])
    df["completed"] = ~df["cancelled"]
    return df


def data_trust_score(rentals, products):
    """Indice 0-100 sobre cuatro dimensiones ponderadas (seccion 3 del notebook)."""
    crit = ["rental_price", "store_id", "booking_channel", "review_score", "return_date"]
    completeness = 1 - rentals[crit].isna().mean().mean()
    uniqueness = 1 - rentals.duplicated().mean()
    invalid = (
        (rentals["review_score"].notna() & ~rentals["review_score"].between(1, 5)) |
        (rentals["rental_price"].notna() & ~rentals["rental_price"].between(0.01, 2000)) |
        (~rentals["rental_days"].between(1, 30)) |
        (rentals["maintenance_cost"] < 0) |
        (rentals["return_date"].notna() & (rentals["return_date"] < rentals["rental_date"]))
    )
    validity = 1 - invalid.mean()
    consistency = products["category"].isin(CANONICAL_CATEGORIES).mean()
    dims = {"Completitud": completeness, "Unicidad": uniqueness,
            "Validez": validity, "Consistencia": consistency}
    weights = {"Completitud": 0.30, "Unicidad": 0.20,
               "Validez": 0.35, "Consistencia": 0.15}
    score = sum(dims[d] * weights[d] for d in dims) * 100
    return score, dims, weights


# ---------------------------------------------------------------------------
# 3. Carga y preparacion
# ---------------------------------------------------------------------------

def load():
    customers = pd.read_csv(DATA_DIR / "customers.csv", parse_dates=["signup_date"])
    products = pd.read_csv(DATA_DIR / "products.csv")
    stores = pd.read_csv(DATA_DIR / "stores.csv")
    rentals = pd.read_csv(
        DATA_DIR / "rentals.csv",
        parse_dates=["rental_date", "return_date", "reservation_date"])
    return customers, products, stores, rentals


def build_fact(customers, products, stores, rentals):
    products_cl = products.copy()
    products_cl["category"] = canon_category(products_cl["category"])
    customers_cl = customers.copy()
    customers_cl["country"] = standardize_text(customers_cl["country"])
    customers_cl["gender"] = standardize_text(customers_cl["gender"])
    stores_cl = stores.copy()
    stores_cl["country"] = standardize_text(stores_cl["country"])
    rentals_cl = clean_rentals(rentals)

    stores_j = stores_cl.rename(columns={"city": "store_city", "country": "store_country"})
    customers_j = customers_cl.rename(columns={
        "age": "customer_age", "gender": "customer_gender",
        "country": "customer_country", "city": "customer_city"})
    fact = (rentals_cl
            .merge(products_cl, on="product_id", how="left")
            .merge(stores_j, on="store_id", how="left")
            .merge(customers_j, on="customer_id", how="left"))
    fact["revenue"] = np.where(fact["completed"], fact["rental_price"], 0.0)
    return fact, products_cl, stores_cl, customers_cl


# ---------------------------------------------------------------------------
# 4. Codificacion binaria de la tabla de hechos
# ---------------------------------------------------------------------------

def encode_fact(fact, months, store_ids, product_ids):
    """Columnas -> arrays tipados -> concatenacion -> deflate -> base64.

    Solo se codifica lo que NO es derivable: categoria, pais, temporada y tamano
    de tienda salen por lookup desde producto/tienda/mes en el navegador.
    """
    month_ix = {m: i for i, m in enumerate(months)}
    store_ix = {s: i + 1 for i, s in enumerate(store_ids)}      # 0 = sin tienda
    prod_ix = {p: i + 1 for i, p in enumerate(product_ids)}     # 0 = sin producto

    def code(col, order):
        m = {c: i + 1 for i, c in enumerate(order)}
        return fact[col].astype(object).map(m).fillna(0).astype(np.uint8).to_numpy()

    def flag(col):
        return fact[col].fillna(False).to_numpy(dtype=bool).astype(np.uint8)

    cols = {}
    cols["month"] = (fact["rental_date"].dt.to_period("M").astype(str)
                     .map(month_ix).astype(np.uint8).to_numpy())
    cols["day"] = fact["rental_date"].dt.day.astype(np.uint8).to_numpy()
    cols["channel"] = code("booking_channel", CHANNELS)
    cols["member"] = code("membership_level", MEMBERS)
    cols["segment"] = code("customer_segment", SEGMENTS)
    cols["store"] = fact["store_id"].map(store_ix).fillna(0).astype(np.uint8).to_numpy()
    cols["product"] = fact["product_id"].map(prod_ix).fillna(0).astype(np.uint16).to_numpy()
    cols["days"] = fact["rental_days"].fillna(0).astype(np.uint8).to_numpy()
    cols["review"] = fact["review_score"].fillna(0).astype(np.uint8).to_numpy()
    # Predictores de la seccion de estadistica (correlaciones, OLS, Logit).
    cols["lead"] = fact["reservation_lead_time"].fillna(255).clip(0, 254).astype(np.uint8).to_numpy()
    cols["cage"] = fact["customer_age"].fillna(0).clip(0, 255).astype(np.uint8).to_numpy()
    cols["prevr"] = fact["total_previous_rentals"].fillna(255).clip(0, 254).astype(np.uint8).to_numpy()
    cols["flags"] = (flag("cancelled")
                     | (flag("late_return") << 1)
                     | (flag("damage_reported") << 2)
                     | (fact["rental_price"].isna().to_numpy().astype(np.uint8) << 3)
                     | (fact["rental_days"].isna().to_numpy().astype(np.uint8) << 4)
                     | (fact["maintenance_cost"].isna().to_numpy().astype(np.uint8) << 5))
    cols["price"] = (fact["rental_price"].fillna(0) * 100).round().astype(np.uint32).to_numpy()
    cols["maint"] = (fact["maintenance_cost"].fillna(0) * 100).round().astype(np.uint16).to_numpy()

    # El orden de fila es irrelevante para el informe; agrupar por producto y fecha
    # da rachas de valores iguales y ahorra ~200 KB tras comprimir.
    order = np.lexsort((cols["day"], cols["month"], cols["product"]))
    cols = {k: v[order] for k, v in cols.items()}

    raw = b"".join(v.tobytes() for v in cols.values())
    payload = base64.b64encode(zlib.compress(raw, 9)).decode("ascii")
    schema = [{"name": k, "type": str(v.dtype)} for k, v in cols.items()]
    return payload, schema, len(fact)


# ---------------------------------------------------------------------------
# 5. Tablas precalculadas (ciclo de vida de cliente: no dependen del filtro)
# ---------------------------------------------------------------------------

def customer_lifecycle(fact):
    """CLRV, concentracion y cohortes: definidas sobre el historico completo.

    Filtrar una cohorte por categoria o canal cambiaria su definicion (el primer
    alquiler del cliente deja de ser el primero), por eso estas tablas se
    calculan una vez y el informe las marca como no filtrables.
    """
    comp = fact[fact["completed"]]
    clrv = comp.groupby("customer_id")["revenue"].sum().sort_values(ascending=False)
    n20 = max(1, int(0.20 * len(clrv)))
    top20_share = 100 * clrv.iloc[:n20].sum() / clrv.sum()

    # Curva de concentracion en 20 puntos (percentiles de cliente).
    cum = clrv.cumsum() / clrv.sum() * 100
    idx = np.linspace(0, len(clrv) - 1, 21).astype(int)
    curve = [{"x": round(100 * (i + 1) / len(clrv), 2), "y": round(float(cum.iloc[i]), 2)}
             for i in idx]

    seg = (comp.groupby("customer_segment")
           .agg(customers=("customer_id", "nunique"), revenue=("revenue", "sum"))
           .reindex(SEGMENTS))
    seg["avg_clrv"] = seg["revenue"] / seg["customers"]

    # Cohortes: mes del primer alquiler -> retencion mes a mes.
    ev = comp[["customer_id", "rental_date"]].dropna().copy()
    ev["order_m"] = ev["rental_date"].dt.to_period("M")
    cohort = ev.groupby("customer_id")["order_m"].min().rename("cohort")
    ev = ev.join(cohort, on="customer_id")
    ev["offset"] = ((ev["order_m"].dt.year - ev["cohort"].dt.year) * 12
                    + (ev["order_m"].dt.month - ev["cohort"].dt.month))
    sizes = ev.groupby("cohort")["customer_id"].nunique()
    active = ev.groupby(["cohort", "offset"])["customer_id"].nunique().unstack("offset")
    retention = (active.div(sizes, axis=0) * 100).iloc[:, :13]

    return {
        "top20_share": round(float(top20_share), 1),
        "curve": curve,
        "segments": [
            {"segment": s,
             "customers": int(seg.loc[s, "customers"]),
             "revenue": round(float(seg.loc[s, "revenue"]), 2),
             "avg_clrv": round(float(seg.loc[s, "avg_clrv"]), 2)}
            for s in SEGMENTS],
        "cohort": {
            "labels": [str(c) for c in retention.index],
            "sizes": [int(sizes.loc[c]) for c in retention.index],
            "matrix": [[None if pd.isna(v) else round(float(v), 1) for v in row]
                       for row in retention.to_numpy()],
        },
    }


def quality_report(rentals_raw, products_raw, fact, customers_raw):
    """Fotografia de calidad del dato CRUDO, antes de limpiar."""
    score, dims, weights = data_trust_score(rentals_raw, products_raw)
    miss = rentals_raw.isna().sum()
    missing = [{"columna": c, "n": int(miss[c]), "pct": round(100 * miss[c] / len(rentals_raw), 2)}
               for c in miss.index if miss[c] > 0]
    missing.sort(key=lambda d: -d["pct"])

    checks = {
        "review_score fuera de [1,5]":
            rentals_raw["review_score"].notna() & ~rentals_raw["review_score"].between(1, 5),
        "rental_price ≤ 0 o > 2000":
            rentals_raw["rental_price"].notna() & ~rentals_raw["rental_price"].between(0.01, 2000),
        "rental_days fuera de [1,30]": ~rentals_raw["rental_days"].between(1, 30),
        "maintenance_cost negativo": rentals_raw["maintenance_cost"] < 0,
        "return_date < rental_date":
            rentals_raw["return_date"].notna() &
            (rentals_raw["return_date"] < rentals_raw["rental_date"]),
        # Integridad temporal contra la dimension de cliente: nadie puede alquilar
        # antes de darse de alta. Es la unica regla que cruza dos tablas, y por eso
        # se escapaba: el generador sorteaba el cliente de todo el padron sin mirar
        # signup_date. Se espera 0; si deja de serlo, el generador ha retrocedido.
        "rental_date < signup_date del cliente":
            rentals_raw["rental_date"] < rentals_raw["customer_id"].map(
                customers_raw.set_index("customer_id")["signup_date"]),
    }
    invalid = [{"regla": k, "n": int(v.sum()), "pct": round(100 * v.mean(), 3)}
               for k, v in checks.items()]

    dirty = sorted(set(products_raw["category"].dropna().unique()) - CANONICAL_CATEGORIES)
    return {
        "score": round(float(score), 2),
        "dims": [{"dim": d, "valor": round(100 * float(dims[d]), 2), "peso": weights[d]}
                 for d in dims],
        "missing": missing,
        "invalid": invalid,
        "dirty_categories": [str(c) for c in dirty],
        "n_raw": int(len(rentals_raw)),
        "n_clean": int(len(fact)),
        "exact_dups": int(rentals_raw.duplicated().sum()),
        "dup_ids": int(rentals_raw["rental_id"].duplicated().sum()),
    }


def cancel_model(fact):
    """Logit de cancelacion sobre el HISTORICO COMPLETO, precalculado aqui.

    La pagina de estadistica ajusta este mismo modelo en el navegador, pero sobre
    la SELECCION: responde a los filtros, y esa es su gracia. El bloque de
    recomendaciones necesita la version no filtrada —una recomendacion no puede
    cambiar de sentido al marcar una casilla de pais— y ajustarla en el navegador
    cuesta ~1,2 s sobre las 171k filas, justo en la primera pantalla que se ve.

    Se precalcula aqui por la misma razon que `customer_lifecycle` y
    `quality_report`: caro y ajeno al filtro. Y no duplica logica de negocio, que
    es lo que si habria que evitar: es el mismo ajuste que `verify_report.py`
    contrasta contra el motor JS, asi que las dos cifras no pueden divergir sin
    que salte la prueba.
    """
    import statsmodels.formula.api as smf   # import local: encarece el arranque

    ld = fact[fact["reservation_lead_time"].notna() & fact["rental_days"].notna()].copy()
    ld["cancelled"] = ld["cancelled"].astype(int)   # patsy trataria el bool como categorica
    fit = smf.logit("cancelled ~ reservation_lead_time + rental_days", data=ld).fit(disp=0)
    return {
        "n": int(fit.nobs),
        "intercept": float(fit.params["Intercept"]),
        "lead": float(fit.params["reservation_lead_time"]),
        "days": float(fit.params["rental_days"]),
        "se_lead": float(fit.bse["reservation_lead_time"]),
        "p_lead": float(fit.pvalues["reservation_lead_time"]),
    }


# ---------------------------------------------------------------------------
# 6. Ensamblado del payload
# ---------------------------------------------------------------------------

def build_payload():
    customers, products, stores, rentals = load()
    fact, products_cl, stores_cl, customers_cl = build_fact(customers, products, stores, rentals)

    months = sorted(fact["rental_date"].dt.to_period("M").astype(str).unique())
    store_ids = sorted(stores_cl["store_id"].unique())
    product_ids = sorted(products_cl["product_id"].unique())

    b64, schema, n_rows = encode_fact(fact, months, store_ids, product_ids)

    cat_ix = {c: i for i, c in enumerate(CATEGORIES)}
    countries = sorted(stores_cl["country"].dropna().unique())
    country_ix = {c: i for i, c in enumerate(countries)}
    size_ix = {s: i for i, s in enumerate(SIZES)}

    p = products_cl.set_index("product_id").reindex(product_ids)
    s = stores_cl.set_index("store_id").reindex(store_ids)

    def col(df, name, cast=float):
        out = []
        for v in df[name]:
            out.append(None if pd.isna(v) else cast(v))
        return out

    products_dim = {
        "id": product_ids,
        "name": [str(v) if pd.notna(v) else "—" for v in p["product_name"]],
        "cat": [cat_ix.get(v, -1) for v in p["category"]],
        "sport": [str(v) if pd.notna(v) else "—" for v in p["sport"]],
        "age": [None if pd.isna(v) else round(float(v), 2) for v in p["product_age"]],
        "units": col(p, "inventory_units", int),
        "purchase": [None if pd.isna(v) else round(float(v), 2) for v in p["purchase_price"]],
        "replacement": [None if pd.isna(v) else round(float(v), 2) for v in p["replacement_cost"]],
        "maint_interval": col(p, "maintenance_interval", int),
    }
    stores_dim = {
        "id": store_ids,
        "name": [str(v) if pd.notna(v) else "—" for v in s["store_name"]],
        "city": [str(v) if pd.notna(v) else "—" for v in s["city"]],
        "country": [country_ix.get(v, -1) for v in s["country"]],
        "size": [size_ix.get(v, -1) for v in s["store_size"]],
        "visitors": col(s, "annual_visitors", int),
    }

    d0, d1 = fact["rental_date"].min(), fact["rental_date"].max()
    payload = {
        "meta": {
            "generated": datetime.now().strftime("%Y-%m-%d"),
            "first_date": d0.strftime("%Y-%m-%d"),
            "last_date": d1.strftime("%Y-%m-%d"),
            "period_days": int((d1 - d0).days),
            "n_rows": n_rows,
        },
        "dims": {
            "months": months,
            # Dias transcurridos desde el inicio de la ventana hasta el dia 1 de cada
            # mes: permite reconstruir la fecha exacta de cada fila en el navegador
            # (serie semanal, dia de la semana, deteccion de anomalias).
            "month_offset": [int((pd.Timestamp(m + "-01") - pd.Timestamp(months[0] + "-01")).days)
                             for m in months],
            "first_weekday": int(pd.Timestamp(months[0] + "-01").weekday()),
            "categories": CATEGORIES,
            "countries": countries,
            "channels": CHANNELS,
            "channel_labels": [CHANNEL_LABELS[c] for c in CHANNELS],
            "members": MEMBERS,
            "segments": SEGMENTS,
            "seasons": SEASONS,
            "season_labels": [SEASON_LABELS[c] for c in SEASONS],
            "sizes": SIZES,
        },
        "products": products_dim,
        "stores": stores_dim,
        "lifecycle": customer_lifecycle(fact),
        "quality": quality_report(rentals, products, fact, customers),
        # Modelos ajustados sobre el historico entero, para el bloque de
        # recomendaciones. Ver `cancel_model`.
        "models": {"cancel_logit": cancel_model(fact)},
        "facts": {"schema": schema, "n": n_rows, "b64": b64},
    }
    return payload, fact


# ---------------------------------------------------------------------------
# 7. Render
# ---------------------------------------------------------------------------

#: piezas del informe, en orden de ensamblado. Los .js se concatenan dentro de
#: un unico <script>, asi que comparten ambito global.
PARTS_DIR = DOCS_DIR / "report"
HTML_PARTS = ["01_head.html", "02_body.html"]
JS_PARTS = ["03_core.js", "03b_geo.js", "04_charts.js", "05_ui.js", "05b_reco.js",
            "06_pages_a.js", "07_pages_b.js", "08_pages_c.js"]

BOOT = """
boot().catch(e => {
  document.getElementById("boot").textContent =
    "No se pudo cargar el informe: " + e.message +
    " · Requiere Chrome, Edge, Firefox 113+ o Safari 16.4+.";
  console.error(e);
});
"""


def assemble(data_js: str) -> str:
    html = "\n".join((PARTS_DIR / p).read_text(encoding="utf-8") for p in HTML_PARTS)
    js = "\n".join((PARTS_DIR / p).read_text(encoding="utf-8") for p in JS_PARTS)
    # "use strict" debe ser la PRIMERA sentencia del script para surtir efecto:
    # dentro de las piezas concatenadas no seria mas que una cadena suelta.
    return (html + '\n<script>\n"use strict";\nconst DATA = ' + data_js + ";\n"
            + js + BOOT + "</script>\n")


def main():
    payload, fact = build_payload()
    data_js = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    fragment = assemble(data_js)

    head_extra = ('<meta charset="utf-8">\n'
                  '<meta name="viewport" content="width=device-width, initial-scale=1">\n')
    standalone = ("<!doctype html>\n<html lang=\"es\">\n<head>\n"
                  + head_extra + "</head>\n<body>\n" + fragment + "\n</body>\n</html>\n")

    (DOCS_DIR / "informe.html").write_text(standalone, encoding="utf-8")
    (DOCS_DIR / "_informe_fragment.html").write_text(fragment, encoding="utf-8")

    size = len(standalone.encode("utf-8")) / 1e6
    comp = fact[fact["completed"]]
    print(f"docs/informe.html   {size:.2f} MB")
    print(f"  filas             {payload['meta']['n_rows']:,}")
    print(f"  datos (base64)    {len(payload['facts']['b64'])/1e6:.2f} MB")
    print(f"  ingresos          {comp['revenue'].sum():,.2f} EUR")
    print(f"  ticket medio      {comp['revenue'].mean():,.2f} EUR")
    print(f"  cancelacion       {100*fact['cancelled'].mean():.3f} %")
    print(f"  data trust score  {payload['quality']['score']}")


if __name__ == "__main__":
    main()
