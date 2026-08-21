/* ===========================================================================
   Banco de pruebas del motor del informe.

   Carga `docs/informe.html`, extrae el payload y ejecuta contra el MISMO
   `report/03_core.js` que corre en el navegador: decodificacion, filtros,
   agregacion, correlaciones, OLS y regresion logistica. Imprime los resultados
   en JSON para que `verify_report.py` los contraste con pandas y statsmodels.

   Uso (normalmente a traves de verify_report.py):
       node docs/test_report.js
   =========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "informe.html"), "utf8");
// Node no traduce saltos de linea: el fichero puede venir con CRLF.
const m = html.match(/const DATA = (\{[\s\S]*?\});\r?\n/);
if (!m) { console.error("No se encontro el payload en informe.html"); process.exit(1); }
globalThis.DATA = JSON.parse(m[1]);

const core = require("./report/03_core.js");

function kpisOf(A) {
  const t = A.total;
  return {
    alquileres: t.n[0], completados: t.comp[0], ingresos: t.rev[0],
    ticket: core.kpi.ticket(t, 0), duracion: core.kpi.avgDays(t, 0),
    cancelacion: core.kpi.cancel(t, 0), averias: core.kpi.damage(t, 0),
    tardias: core.kpi.late(t, 0), review: core.kpi.review(t, 0),
    maint_ratio: core.kpi.maintR(t, 0), lead: core.kpi.avgLead(t, 0),
  };
}

(async () => {
  await core.decodeFacts(DATA);
  const { F, N, D, P, rowCat, rowCountry, monthSeason } = core.ctx();
  const out = {};

  const notCancelled = i => !(F.flags[i] & 1);
  const hasPrice = i => !((F.flags[i] >> 3) & 1);
  const hasDays = i => !((F.flags[i] >> 4) & 1);

  /* 1 · Sin filtros */
  const full = core.buildMask(0, D.months.length - 1);
  out.global = kpisOf(core.aggregate(full));

  /* 2 · Con filtros cruzados: Esqui + Snowboard, Espana + Francia, canal App */
  const iEsqui = D.categories.indexOf("Esquí"), iSnow = D.categories.indexOf("Snowboard");
  const iEs = D.countries.indexOf("España"), iFr = D.countries.indexOf("Francia");
  core.state.cat.add(iEsqui); core.state.cat.add(iSnow);
  core.state.country.add(iEs); core.state.country.add(iFr);
  core.state.channel.add(D.channels.indexOf("App"));
  const filtered = core.buildMask(0, D.months.length - 1);
  out.filtrado = kpisOf(core.aggregate(filtered));
  out.filtro = { categorias: ["Esquí", "Snowboard"], paises: ["España", "Francia"], canal: "App" };
  core.state.cat.clear(); core.state.country.clear(); core.state.channel.clear();

  /* 3 · Solo 2025 */
  const [a, b] = core.monthRange("2025");
  out.anio2025 = kpisOf(core.aggregate(core.buildMask(a, b)));

  /* 4 · Correlaciones de Pearson */
  const get = {
    days: i => hasDays(i) ? F.days[i] : null,
    price: i => hasPrice(i) ? F.price[i] / 100 : null,
    maint: i => ((F.flags[i] >> 5) & 1) ? null : F.maint[i] / 100,
    review: i => F.review[i] || null,
    lead: i => F.lead[i] === 255 ? null : F.lead[i],
    age: i => F.product[i] ? P.age[F.product[i] - 1] : null,
    cage: i => F.cage[i] || null,
  };
  out.correlaciones = {
    days_price: core.pearson(get.days, get.price, full),
    age_maint: core.pearson(get.age, get.maint, full),
    age_review: core.pearson(get.age, get.review, full),
    lead_review: core.pearson(get.lead, get.review, full),
    cage_price: core.pearson(get.cage, get.price, full),
  };

  /* 5 · OLS: rental_price ~ rental_days + C(category) + C(season) */
  const catLv = [], seaLv = [];
  for (let i = 0; i < N; i++) {
    if (!full[i] || !notCancelled(i) || !hasPrice(i) || !hasDays(i) || rowCat[i] < 0) continue;
    if (!catLv.includes(rowCat[i])) catLv.push(rowCat[i]);
    const s = monthSeason[F.month[i]];
    if (!seaLv.includes(s)) seaLv.push(s);
  }
  catLv.sort((x, y) => x - y); seaLv.sort((x, y) => x - y);
  const p = 2 + (catLv.length - 1) + (seaLv.length - 1);
  const rows = cb => {
    const x = new Float64Array(p);
    for (let i = 0; i < N; i++) {
      if (!full[i] || !notCancelled(i) || !hasPrice(i) || !hasDays(i) || rowCat[i] < 0) continue;
      x.fill(0);
      x[0] = 1; x[1] = F.days[i];
      const ci = catLv.indexOf(rowCat[i]); if (ci > 0) x[1 + ci] = 1;
      const si = seaLv.indexOf(monthSeason[F.month[i]]);
      if (si > 0) x[1 + catLv.length - 1 + si] = 1;
      cb(x, F.price[i] / 100);
    }
  };
  const fit = core.ols(rows, p);
  out.ols = {
    n: fit.n, r2: fit.r2, r2adj: fit.r2adj,
    intercepto: fit.beta[0], dias: fit.beta[1], se_dias: fit.se[1],
    terminos: catLv.slice(1).map((k, j) => ({ nivel: D.categories[k], coef: fit.beta[2 + j] })),
    ref_categoria: D.categories[catLv[0]],
    ref_temporada: D.seasons[seaLv[0]],
    temporadas: seaLv.slice(1).map((s, j) => ({ nivel: D.seasons[s], coef: fit.beta[1 + catLv.length + j] })),
  };

  /* 6 · Logit: cancelled ~ lead + rental_days */
  const lrows = cb => {
    const x = new Float64Array(3);
    for (let i = 0; i < N; i++) {
      if (!full[i] || F.lead[i] === 255 || !hasDays(i)) continue;
      x[0] = 1; x[1] = F.lead[i]; x[2] = F.days[i];
      cb(x, F.flags[i] & 1);
    }
  };
  const lfit = core.logit(lrows, 3);
  out.logit = {
    n: lfit.n, iter: lfit.iter, ll: lfit.ll,
    intercepto: lfit.beta[0], lead: lfit.beta[1], dias: lfit.beta[2],
    se_lead: lfit.se[1], or_lead: Math.exp(lfit.beta[1]),
  };

  /* 7 · Dos proporciones: Premium+Gold vs Basic+Standard */
  const A = core.aggregate(full);
  const s1 = A.member.canc[3] + A.member.canc[4], n1 = A.member.n[3] + A.member.n[4];
  const s2 = A.member.canc[1] + A.member.canc[2], n2 = A.member.n[1] + A.member.n[2];
  out.proporciones = Object.assign({ s1, n1, s2, n2 }, core.twoProportions(s1, n1, s2, n2));

  /* 8 · Caja del precio y anomalias semanales */
  const prices = [];
  for (let i = 0; i < N; i++) if (full[i] && notCancelled(i) && hasPrice(i)) prices.push(F.price[i] / 100);
  out.caja_precio = core.boxStats(prices);
  out.suma_semanal = Array.from(A.weekRev).reduce((x, y) => x + y, 0);

  console.log(JSON.stringify(out, (k, v) => (typeof v === "number" && !isFinite(v)) ? null : v, 1));
})().catch(e => { console.error(e); process.exit(1); });
