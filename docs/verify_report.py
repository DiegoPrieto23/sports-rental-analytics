"""
verify_report.py
================

Comprueba que el informe dice la verdad. Dos niveles:

1. **Codificacion**: decodifica el payload embebido en `docs/informe.html` igual
   que lo hace el navegador y recalcula los KPIs sobre esas columnas.
2. **Motor**: ejecuta `docs/test_report.js` en Node, que corre el MISMO
   `report/03_core.js` del informe (filtros, agregacion, correlaciones, OLS,
   logistica, contraste de proporciones) y contrasta su salida con pandas,
   scipy y statsmodels.

Sin navegador no se puede comprobar como se ve el informe, pero si se puede
comprobar que lo que calcula es correcto, que es donde un error pasaria
inadvertido.

Uso:
    python docs/verify_report.py
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_report import build_fact, load  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "docs" / "informe.html"
HARNESS = ROOT / "docs" / "test_report.js"

TYPES = {"uint8": np.uint8, "uint16": np.uint16, "uint32": np.uint32}
TOL = 1e-6           # tolerancia relativa para comparaciones numericas
TOL_FIT = 2e-4       # holgura para modelos ajustados por metodos distintos

_checks = []


def check(name, got, want, tol=TOL, unit=""):
    if got is None or want is None or (isinstance(want, float) and not np.isfinite(want)):
        ok = got is None and want is None
    else:
        scale = max(abs(want), 1e-9)
        ok = abs(got - want) <= max(tol, tol * scale)
    _checks.append((name, got, want, ok, unit))
    return ok


def report(title):
    print(f"\n{title}")
    print("-" * 78)
    for name, got, want, ok, unit in _checks:
        g = f"{got:,.6f}" if isinstance(got, float) else f"{got:,}" if isinstance(got, int) else str(got)
        w = f"{want:,.6f}" if isinstance(want, float) else f"{want:,}" if isinstance(want, int) else str(want)
        print(f"  {name:<34}{g:>17}{w:>17}   {'OK' if ok else 'DIFIERE'}")
    bad = sum(1 for c in _checks if not c[3])
    _checks.clear()
    return bad


# ---------------------------------------------------------------------------
# 1. Codificacion del payload
# ---------------------------------------------------------------------------

def extract_payload(html: str) -> dict:
    m = re.search(r"const DATA = (\{.*?\});\n", html, re.S)
    if not m:
        raise SystemExit("No se encontro el payload en el HTML")
    return json.loads(m.group(1))


def decode(payload: dict) -> dict:
    raw = zlib.decompress(base64.b64decode(payload["facts"]["b64"]))
    n = payload["facts"]["n"]
    cols, off = {}, 0
    for spec in payload["facts"]["schema"]:
        dt = TYPES[spec["type"]]
        cols[spec["name"]] = np.frombuffer(raw, dtype=dt, count=n, offset=off)
        off += n * np.dtype(dt).itemsize
    if off != len(raw):
        raise SystemExit(f"Bytes sobrantes tras decodificar: {len(raw) - off}")
    return cols


def kpis_pandas(fact):
    comp = fact[fact["completed"]]
    products = fact.drop_duplicates("product_id").set_index("product_id")
    period = (fact["rental_date"].max() - fact["rental_date"].min()).days
    cap = (products.loc[comp["product_id"].unique(), "inventory_units"].fillna(0) * period).sum()
    return {
        "alquileres": len(fact), "completados": len(comp),
        "ingresos": comp["revenue"].sum(), "ticket": comp["revenue"].mean(),
        "duracion": comp["rental_days"].mean(), "cancelacion": fact["cancelled"].mean(),
        "averias": comp["damage_reported"].mean(), "tardias": comp["late_return"].mean(),
        "review": comp["review_score"].mean(),
        "maint_ratio": comp["maintenance_cost"].fillna(0).sum() / comp["revenue"].sum(),
        "lead": comp["reservation_lead_time"].mean(),
        "ocupacion": comp["rental_days"].fillna(0).sum() / cap,
    }


def check_encoding(payload, cols, fact):
    flags = cols["flags"]
    canc = (flags & 1).astype(bool)
    comp = ~canc
    price = np.where(((flags >> 3) & 1).astype(bool), 0.0, cols["price"] / 100.0)
    days = np.where(((flags >> 4) & 1).astype(bool), 0, cols["days"])
    maint = np.where(((flags >> 5) & 1).astype(bool), 0.0, cols["maint"] / 100.0)
    rev = np.where(canc, 0.0, price)
    has_price = ~((flags >> 3) & 1).astype(bool)
    has_days = ~((flags >> 4) & 1).astype(bool)
    review = cols["review"]

    units = np.array([u or 0 for u in payload["products"]["units"]])
    used = np.zeros(len(units), dtype=bool)
    used[cols["product"][cols["product"] > 0] - 1] = True
    sel = comp & (cols["product"] > 0)
    days_sum = np.zeros(len(units))
    np.add.at(days_sum, cols["product"][sel] - 1, days[sel])

    want = kpis_pandas(fact)
    got = {
        "alquileres": int(len(flags)), "completados": int(comp.sum()),
        "ingresos": float(rev[comp].sum()), "ticket": float(price[comp & has_price].mean()),
        "duracion": float(days[comp & has_days].mean()), "cancelacion": float(canc.mean()),
        "averias": float(((flags >> 2) & 1)[comp].mean()),
        "tardias": float(((flags >> 1) & 1)[comp].mean()),
        "review": float(review[comp & (review > 0)].mean()),
        "maint_ratio": float(maint[comp].sum() / rev[comp].sum()),
        "lead": float(cols["lead"][comp & (cols["lead"] != 255)].mean()),
        "ocupacion": float(days_sum.sum() / (units[used] * payload["meta"]["period_days"]).sum()),
    }
    for k in want:
        check(k, got[k], float(want[k]) if not isinstance(want[k], (int, np.integer)) else int(want[k]))
    return report("1 · CODIFICACION · payload decodificado frente a pandas")


# ---------------------------------------------------------------------------
# 2. Motor del informe (Node) frente a pandas / statsmodels
# ---------------------------------------------------------------------------

def slice_pandas(fact, **flt):
    d = fact
    if "cats" in flt:
        d = d[d["category"].isin(flt["cats"])]
    if "countries" in flt:
        d = d[d["store_country"].isin(flt["countries"])]
    if "channel" in flt:
        d = d[d["booking_channel"] == flt["channel"]]
    if "year" in flt:
        d = d[d["rental_date"].dt.year == flt["year"]]
    return d


def check_engine(fact, payload):
    print("\nEjecutando el motor del informe en Node…")
    res = subprocess.run([("node"), str(HARNESS)], capture_output=True, text=True,
                         encoding="utf-8", cwd=str(ROOT))
    if res.returncode != 0:
        print(res.stdout[-2000:]); print(res.stderr[-2000:])
        raise SystemExit("El banco de pruebas de Node fallo")
    js = json.loads(res.stdout)

    bad = 0
    # --- KPIs sin filtro, con filtro cruzado y por anio ---
    for label, key, flt in [
        ("global", "global", {}),
        ("filtrado", "filtrado", dict(cats=["Esquí", "Snowboard"],
                                      countries=["España", "Francia"], channel="App")),
        ("2025", "anio2025", dict(year=2025)),
    ]:
        want = kpis_pandas(slice_pandas(fact, **flt))
        got = js[key]
        for k in ["alquileres", "completados", "ingresos", "ticket", "duracion",
                  "cancelacion", "averias", "tardias", "review", "maint_ratio", "lead"]:
            check(f"{label} · {k}", float(got[k]), float(want[k]))
        bad += report(f"2 · MOTOR · KPIs del corte «{label}» frente a pandas")

    # --- correlaciones ---
    from scipy import stats as sps
    comp = fact.copy()
    pairs = {
        "days_price": ("rental_days", "rental_price"),
        "age_maint": ("product_age", "maintenance_cost"),
        "age_review": ("product_age", "review_score"),
        "lead_review": ("reservation_lead_time", "review_score"),
        "cage_price": ("customer_age", "rental_price"),
    }
    for key, (a, b) in pairs.items():
        d = comp[[a, b]].dropna()
        r, p = sps.pearsonr(d[a], d[b])
        check(f"r · {a} ~ {b}", float(js["correlaciones"][key]["r"]), float(r))
        check(f"n · {a} ~ {b}", int(js["correlaciones"][key]["n"]), int(len(d)))
    bad += report("3 · MOTOR · correlaciones de Pearson frente a scipy")

    # --- OLS ---
    import statsmodels.formula.api as smf
    md = fact[fact["completed"] & fact["rental_price"].notna() & fact["rental_days"].notna()].copy()
    for c in ["category", "season"]:
        md[c] = md[c].astype(object)
    md = md.dropna(subset=["category", "season", "rental_price", "rental_days"])
    fit = smf.ols("rental_price ~ rental_days + C(category, Treatment(reference='Bicicletas'))"
                  " + C(season, Treatment(reference='Winter'))", data=md).fit()
    check("OLS · n", int(js["ols"]["n"]), int(fit.nobs))
    check("OLS · R²", float(js["ols"]["r2"]), float(fit.rsquared), TOL_FIT)
    check("OLS · R² ajustado", float(js["ols"]["r2adj"]), float(fit.rsquared_adj), TOL_FIT)
    check("OLS · intercepto", float(js["ols"]["intercepto"]), float(fit.params["Intercept"]), TOL_FIT)
    check("OLS · coef rental_days", float(js["ols"]["dias"]), float(fit.params["rental_days"]), TOL_FIT)
    check("OLS · se rental_days", float(js["ols"]["se_dias"]), float(fit.bse["rental_days"]), TOL_FIT)
    for term in js["ols"]["terminos"]:
        name = ("C(category, Treatment(reference='Bicicletas'))[T." + term["nivel"] + "]")
        check(f"OLS · {term['nivel']}", float(term["coef"]), float(fit.params[name]), TOL_FIT)
    for term in js["ols"]["temporadas"]:
        name = ("C(season, Treatment(reference='Winter'))[T." + term["nivel"] + "]")
        check(f"OLS · {term['nivel']}", float(term["coef"]), float(fit.params[name]), TOL_FIT)
    bad += report("4 · MOTOR · regresión lineal frente a statsmodels")

    # --- Logit ---
    ld = fact[fact["reservation_lead_time"].notna() & fact["rental_days"].notna()].copy()
    ld["cancelled"] = ld["cancelled"].astype(int)   # patsy trataria el bool como categorica
    lfit = smf.logit("cancelled ~ reservation_lead_time + rental_days", data=ld).fit(disp=0)
    check("Logit · n", int(js["logit"]["n"]), int(lfit.nobs))
    check("Logit · intercepto", float(js["logit"]["intercepto"]), float(lfit.params["Intercept"]), TOL_FIT)
    check("Logit · coef lead", float(js["logit"]["lead"]),
          float(lfit.params["reservation_lead_time"]), TOL_FIT)
    check("Logit · coef días", float(js["logit"]["dias"]), float(lfit.params["rental_days"]), TOL_FIT)
    check("Logit · se lead", float(js["logit"]["se_lead"]),
          float(lfit.bse["reservation_lead_time"]), TOL_FIT)
    check("Logit · log-verosimilitud", float(js["logit"]["ll"]), float(lfit.llf), TOL_FIT)
    # El MISMO modelo, pero el que viaja precalculado en el payload y alimenta el
    # bloque de recomendaciones. Va contra el mismo ajuste de statsmodels que el
    # del motor: si alguien toca uno de los dos, esto lo separa del otro.
    pm = payload["models"]["cancel_logit"]
    check("Logit payload · n", int(pm["n"]), int(lfit.nobs))
    check("Logit payload · coef lead", float(pm["lead"]),
          float(lfit.params["reservation_lead_time"]), TOL_FIT)
    check("Logit payload · coef días", float(pm["days"]), float(lfit.params["rental_days"]), TOL_FIT)
    check("Logit payload · se lead", float(pm["se_lead"]),
          float(lfit.bse["reservation_lead_time"]), TOL_FIT)
    bad += report("5 · MOTOR · regresión logística frente a statsmodels")

    # --- proporciones y cuantiles ---
    from statsmodels.stats.proportion import proportions_ztest
    hi = fact[fact["membership_level"].isin(["Premium", "Gold"])]
    lo = fact[fact["membership_level"].isin(["Basic", "Standard"])]
    z, p = proportions_ztest([hi["cancelled"].sum(), lo["cancelled"].sum()], [len(hi), len(lo)])
    check("Proporciones · n grupo alto", int(js["proporciones"]["n1"]), int(len(hi)))
    check("Proporciones · n grupo bajo", int(js["proporciones"]["n2"]), int(len(lo)))
    check("Proporciones · tasa alto", float(js["proporciones"]["p1"]), float(hi["cancelled"].mean()))
    check("Proporciones · tasa bajo", float(js["proporciones"]["p2"]), float(lo["cancelled"].mean()))
    check("Proporciones · z", float(js["proporciones"]["z"]), float(z), TOL_FIT)

    prices = fact.loc[fact["completed"] & fact["rental_price"].notna(), "rental_price"]
    box = js["caja_precio"]
    check("Caja · mediana", float(box["med"]), float(prices.median()))
    check("Caja · Q1", float(box["q1"]), float(prices.quantile(.25)))
    check("Caja · Q3", float(box["q3"]), float(prices.quantile(.75)))
    q1, q3 = prices.quantile(.25), prices.quantile(.75)
    iqr = q3 - q1
    n_out = int(((prices < q1 - 1.5 * iqr) | (prices > q3 + 1.5 * iqr)).sum())
    check("Caja · outliers", int(box["nOut"]), n_out)
    check("Serie semanal · suma", float(js["suma_semanal"]),
          float(fact.loc[fact["completed"], "revenue"].sum()))
    bad += report("6 · MOTOR · proporciones, cuantiles y serie semanal")
    return bad


def main():
    payload = extract_payload(REPORT.read_text(encoding="utf-8"))
    cols = decode(payload)
    fact, *_ = build_fact(*load())

    bad = check_encoding(payload, cols, fact)
    bad += check_engine(fact, payload)

    print()
    if bad:
        raise SystemExit(f"{bad} comprobaciones no cuadran")
    print(f"Todo cuadra. Payload: {payload['facts']['n']:,} filas, "
          f"{len(payload['facts']['b64'])/1e6:.2f} MB en base64.")


if __name__ == "__main__":
    main()
