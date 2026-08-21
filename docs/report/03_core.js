/* ===========================================================================
   NUCLEO: decodificacion, filtros, agregacion y estadistica.
   Sin DOM a proposito: `docs/test_report.js` carga este mismo fichero en Node y
   contrasta sus resultados contra pandas/statsmodels. Si algo de aqui usa
   `document`, la prueba deja de correr.
   =========================================================================== */
"use strict";

const TYPE_ARRAY = { uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array };

const F = {};                 // columnas de la tabla de hechos
let N, D, P, S;               // filas, dimensiones, productos, tiendas
let rowCat, rowCountry, rowSize, rowDay, rowWeek, rowDow;
let monthSeason, monthYear;

async function inflate(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Este navegador no soporta DecompressionStream");
  }
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodeFacts(data) {
  N = data.facts.n; D = data.dims; P = data.products; S = data.stores;
  const buf = await inflate(data.facts.b64);
  let off = 0;
  for (const col of data.facts.schema) {
    const Ctor = TYPE_ARRAY[col.type];
    const bytes = N * Ctor.BYTES_PER_ELEMENT;
    F[col.name] = new Ctor(buf.slice(off, off + bytes).buffer);
    off += bytes;
  }
  if (off !== buf.length) throw new Error("Bytes sobrantes al decodificar");

  monthSeason = D.months.map(m => {
    const mm = +m.slice(5, 7);
    return mm === 12 || mm <= 2 ? 0 : mm <= 5 ? 1 : mm <= 8 ? 2 : 3;
  });
  monthYear = D.months.map(m => +m.slice(0, 4));

  rowCat = new Int8Array(N); rowCountry = new Int8Array(N); rowSize = new Int8Array(N);
  rowDay = new Int16Array(N); rowWeek = new Int16Array(N); rowDow = new Int8Array(N);
  const off0 = D.month_offset, w0 = D.first_weekday;
  for (let i = 0; i < N; i++) {
    const pi = F.product[i], si = F.store[i];
    rowCat[i] = pi ? P.cat[pi - 1] : -1;
    rowCountry[i] = si ? S.country[si - 1] : -1;
    rowSize[i] = si ? S.size[si - 1] : -1;
    const d = off0[F.month[i]] + F.day[i] - 1;   // dias desde el inicio de la ventana
    rowDay[i] = d;
    rowWeek[i] = Math.floor(d / 7);
    rowDow[i] = (w0 + d) % 7;                    // 0 = lunes
  }
}

/* --------------------------------------------------------------------------
   Filtros
   -------------------------------------------------------------------------- */
const state = {
  period: "all",
  country: new Set(), cat: new Set(), channel: new Set(),
  member: new Set(), segment: new Set(),
  page: 0,
};

function monthRange(period) {
  const last = D.months.length - 1;
  if (period === "all") return [0, last];
  if (period === "last12") return [Math.max(0, last - 11), last];
  if (period === "h1") return [0, Math.floor(last / 2)];
  const idx = D.months.map((m, i) => [m, i]).filter(([m]) => m.startsWith(period)).map(([, i]) => i);
  return idx.length ? [idx[0], idx[idx.length - 1]] : [0, last];
}

function buildMask(m0, m1) {
  const mask = new Uint8Array(N);
  const uc = state.country.size, uk = state.cat.size, uh = state.channel.size,
        um = state.member.size, ug = state.segment.size;
  for (let i = 0; i < N; i++) {
    const mo = F.month[i];
    if (mo < m0 || mo > m1) continue;
    if (uk && !state.cat.has(rowCat[i])) continue;
    if (uc && !state.country.has(rowCountry[i])) continue;
    if (uh && !state.channel.has(F.channel[i] - 1)) continue;
    if (um && !state.member.has(F.member[i] - 1)) continue;
    if (ug && !state.segment.has(F.segment[i] - 1)) continue;
    mask[i] = 1;
  }
  return mask;
}

function periodDays(m0, m1) {
  if (m0 === 0 && m1 === D.months.length - 1) return DATA.meta.period_days;
  const a = D.months[m0], b = D.months[m1];
  const start = new Date(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, 1));
  const end = new Date(Date.UTC(+b.slice(0, 4), +b.slice(5, 7), 0));
  return Math.round((end - start) / 86400000) + 1;
}

/* --------------------------------------------------------------------------
   Agregacion: una sola pasada llena todos los cortes de la pagina
   -------------------------------------------------------------------------- */
const MEASURES = ["n", "comp", "rev", "days", "dn", "maint", "canc", "late", "dmg",
                  "rsum", "rn", "psum", "pn", "lead", "ln"];
function acc(k) {
  const o = {};
  for (const m of MEASURES) o[m] = new Float64Array(k);
  return o;
}
function bump(a, b, price, days, maint, canc, late, dmg, rev, rvN, lead) {
  a.n[b] += 1;
  if (canc) { a.canc[b] += 1; return; }
  a.comp[b] += 1;
  a.rev[b] += rev; a.days[b] += days; a.maint[b] += maint;
  a.late[b] += late; a.dmg[b] += dmg;
  if (days > 0) a.dn[b] += 1;
  if (rvN) { a.rsum[b] += rvN; a.rn[b] += 1; }
  if (price > 0) { a.psum[b] += price; a.pn[b] += 1; }
  if (lead >= 0) { a.lead[b] += lead; a.ln[b] += 1; }
}

function aggregate(mask) {
  const K = D.categories.length, nMonths = D.months.length;
  const out = {
    total: acc(1), month: acc(nMonths), cat: acc(K), country: acc(D.countries.length + 1),
    channel: acc(D.channels.length + 1), member: acc(D.members.length + 1),
    segment: acc(D.segments.length + 1), size: acc(D.sizes.length + 1), season: acc(4),
    dow: acc(7), product: acc(P.id.length), store: acc(S.id.length + 1),
    catMonth: acc(K * 12),
    reviewByMember: new Float64Array((D.members.length + 1) * 5),
    daysHist: new Float64Array(31),
    weekRev: new Float64Array(Math.ceil((DATA.meta.period_days + 40) / 7)),
    weekN: new Float64Array(Math.ceil((DATA.meta.period_days + 40) / 7)),
  };
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    const fl = F.flags[i];
    const canc = fl & 1, late = (fl >> 1) & 1, dmg = (fl >> 2) & 1;
    const price = ((fl >> 3) & 1) ? 0 : F.price[i] / 100;
    const days = ((fl >> 4) & 1) ? 0 : F.days[i];
    const maint = ((fl >> 5) & 1) ? 0 : F.maint[i] / 100;
    const rev = canc ? 0 : price;
    const rv = F.review[i];
    const lead = F.lead[i] === 255 ? -1 : F.lead[i];
    const mo = F.month[i], k = rowCat[i], si = F.store[i], pi = F.product[i];
    const m = F.member[i];

    bump(out.total, 0, price, days, maint, canc, late, dmg, rev, rv, lead);
    bump(out.month, mo, price, days, maint, canc, late, dmg, rev, rv, lead);
    if (k >= 0) {
      bump(out.cat, k, price, days, maint, canc, late, dmg, rev, rv, lead);
      bump(out.catMonth, k * 12 + (+D.months[mo].slice(5, 7) - 1),
           price, days, maint, canc, late, dmg, rev, rv, lead);
    }
    bump(out.country, rowCountry[i] + 1, price, days, maint, canc, late, dmg, rev, rv, lead);
    bump(out.channel, F.channel[i], price, days, maint, canc, late, dmg, rev, rv, lead);
    bump(out.member, m, price, days, maint, canc, late, dmg, rev, rv, lead);
    bump(out.segment, F.segment[i], price, days, maint, canc, late, dmg, rev, rv, lead);
    bump(out.size, rowSize[i] + 1, price, days, maint, canc, late, dmg, rev, rv, lead);
    bump(out.season, monthSeason[mo], price, days, maint, canc, late, dmg, rev, rv, lead);
    bump(out.dow, rowDow[i], price, days, maint, canc, late, dmg, rev, rv, lead);
    if (pi) bump(out.product, pi - 1, price, days, maint, canc, late, dmg, rev, rv, lead);
    bump(out.store, si, price, days, maint, canc, late, dmg, rev, rv, lead);

    if (!canc) {
      if (rv >= 1 && rv <= 5) out.reviewByMember[m * 5 + (rv - 1)] += 1;
      if (days > 0 && days <= 30) out.daysHist[days] += 1;
      out.weekRev[rowWeek[i]] += rev;
      out.weekN[rowWeek[i]] += 1;
    }
  }
  return out;
}

/* Derivadas de un bucket. Ojo con los denominadores: el ticket y la duracion
   media excluyen los alquileres sin precio o sin duracion, igual que
   `global_kpis` en el notebook. Meterlos con valor 0 hunde el ticket ~1,6 EUR. */
const kpi = {
  ticket:  (a, b) => a.pn[b] ? a.psum[b] / a.pn[b] : NaN,
  cancel:  (a, b) => a.n[b] ? a.canc[b] / a.n[b] : NaN,
  late:    (a, b) => a.comp[b] ? a.late[b] / a.comp[b] : NaN,
  damage:  (a, b) => a.comp[b] ? a.dmg[b] / a.comp[b] : NaN,
  review:  (a, b) => a.rn[b] ? a.rsum[b] / a.rn[b] : NaN,
  maintR:  (a, b) => a.rev[b] ? a.maint[b] / a.rev[b] : NaN,
  margin:  (a, b) => a.rev[b] ? (a.rev[b] - a.maint[b]) / a.rev[b] : NaN,
  avgDays: (a, b) => a.dn[b] ? a.days[b] / a.dn[b] : NaN,
  avgLead: (a, b) => a.ln[b] ? a.lead[b] / a.ln[b] : NaN,
};

/* --------------------------------------------------------------------------
   Utilidades numericas
   -------------------------------------------------------------------------- */
function quantileSorted(a, q) {
  if (!a.length) return NaN;
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
function boxStats(values) {
  if (!values.length) return null;
  const a = Float64Array.from(values).sort();
  const q1 = quantileSorted(a, .25), med = quantileSorted(a, .5), q3 = quantileSorted(a, .75);
  const iqr = q3 - q1;
  const loLim = q1 - 1.5 * iqr, hiLim = q3 + 1.5 * iqr;
  let lo = a[0], hi = a[a.length - 1], nOut = 0;
  for (let i = 0; i < a.length; i++) if (a[i] >= loLim) { lo = a[i]; break; }
  for (let i = a.length - 1; i >= 0; i--) if (a[i] <= hiLim) { hi = a[i]; break; }
  for (let i = 0; i < a.length; i++) if (a[i] < loLim || a[i] > hiLim) nOut++;
  return { q1, med, q3, lo, hi, loLim, hiLim, nOut, n: a.length, min: a[0], max: a[a.length - 1] };
}

// Aproximacion de Abramowitz-Stegun 7.1.26 (error maximo 1.5e-7).
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 +
               t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - poly * Math.exp(-x * x));
}
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
const pTwoSided = z => 2 * (1 - normCdf(Math.abs(z)));

/* Correlacion de Pearson en una pasada sobre pares (x, y) validos. */
function pearson(getX, getY, mask) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    const x = getX(i); if (x == null || !isFinite(x)) continue;
    const y = getY(i); if (y == null || !isFinite(y)) continue;
    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  if (n < 3) return { r: NaN, n, p: NaN };
  const cov = sxy - sx * sy / n;
  const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
  const r = cov / Math.sqrt(vx * vy);
  const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
  return { r, n, p: pTwoSided(t) };
}

/* Matriz de correlaciones. Materializa cada variable una sola vez en un array
   tipado y luego recorre los pares: 45 pasadas con indireccion de funcion
   costaban ~1,8 s en el primer render; asi baja a decenas de milisegundos. */
function pearsonMatrix(getters, mask) {
  const p = getters.length;
  const cols = getters.map(g => {
    const a = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      if (!mask[i]) { a[i] = NaN; continue; }
      const v = g(i);
      a[i] = (v == null || !isFinite(v)) ? NaN : v;
    }
    return a;
  });
  const M = Array.from({ length: p }, () => new Array(p).fill(NaN));
  for (let a = 0; a < p; a++) {
    M[a][a] = 1;
    for (let b = a + 1; b < p; b++) {
      const X = cols[a], Y = cols[b];
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let i = 0; i < N; i++) {
        const x = X[i]; if (x !== x) continue;
        const y = Y[i]; if (y !== y) continue;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
      let r = NaN;
      if (n >= 3) {
        const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
        if (vx > 0 && vy > 0) r = (sxy - sx * sy / n) / Math.sqrt(vx * vy);
      }
      M[a][b] = r; M[b][a] = r;
    }
  }
  return M;
}

/* Resuelve A·x = b y devuelve tambien A⁻¹ (Gauss-Jordan con pivoteo parcial). */
function solveWithInverse(A, b, p) {
  const M = new Float64Array(p * 2 * p);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) M[i * 2 * p + j] = A[i * p + j];
    M[i * 2 * p + p + i] = 1;
  }
  const x = Float64Array.from(b);
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) {
      if (Math.abs(M[r * 2 * p + c]) > Math.abs(M[piv * 2 * p + c])) piv = r;
    }
    if (Math.abs(M[piv * 2 * p + c]) < 1e-10) return null;   // singular
    if (piv !== c) {
      for (let j = 0; j < 2 * p; j++) {
        const t = M[c * 2 * p + j]; M[c * 2 * p + j] = M[piv * 2 * p + j]; M[piv * 2 * p + j] = t;
      }
      const t = x[c]; x[c] = x[piv]; x[piv] = t;
    }
    const d = M[c * 2 * p + c];
    for (let j = 0; j < 2 * p; j++) M[c * 2 * p + j] /= d;
    x[c] /= d;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = M[r * 2 * p + c];
      if (!f) continue;
      for (let j = 0; j < 2 * p; j++) M[r * 2 * p + j] -= f * M[c * 2 * p + j];
      x[r] -= f * x[c];
    }
  }
  const inv = new Float64Array(p * p);
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) inv[i * p + j] = M[i * 2 * p + p + j];
  return { beta: x, inv };
}

/* Minimos cuadrados ordinarios por ecuaciones normales.
   `rows(cb)` invoca cb(x[], y) por cada observacion valida. */
function ols(rows, p) {
  const XtX = new Float64Array(p * p), Xty = new Float64Array(p);
  let n = 0, sy = 0, syy = 0;
  rows((x, y) => {
    n++; sy += y; syy += y * y;
    for (let j = 0; j < p; j++) {
      const xj = x[j];
      if (xj) { Xty[j] += xj * y; for (let k = j; k < p; k++) XtX[j * p + k] += xj * x[k]; }
    }
  });
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) XtX[j * p + k] = XtX[k * p + j];
  if (n <= p) return null;
  const sol = solveWithInverse(XtX, Xty, p);
  if (!sol) return null;
  let bXty = 0;
  for (let j = 0; j < p; j++) bXty += sol.beta[j] * Xty[j];
  const rss = Math.max(0, syy - bXty);
  const tss = syy - sy * sy / n;
  const df = n - p;
  const sigma2 = rss / df;
  const se = new Float64Array(p), t = new Float64Array(p), pv = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    se[j] = Math.sqrt(Math.max(0, sigma2 * sol.inv[j * p + j]));
    t[j] = se[j] > 0 ? sol.beta[j] / se[j] : NaN;
    pv[j] = pTwoSided(t[j]);
  }
  return { beta: sol.beta, se, t, p: pv, n, df, r2: 1 - rss / tss,
           r2adj: 1 - (rss / df) / (tss / (n - 1)) };
}

/* Regresion logistica por IRLS. */
function logit(rows, p, maxIter = 30) {
  let beta = new Float64Array(p);
  let last = null;
  for (let it = 0; it < maxIter; it++) {
    const XtWX = new Float64Array(p * p), XtWz = new Float64Array(p);
    let n = 0, ll = 0;
    rows((x, y) => {
      let eta = 0;
      for (let j = 0; j < p; j++) eta += beta[j] * x[j];
      eta = Math.max(-30, Math.min(30, eta));
      const mu = 1 / (1 + Math.exp(-eta));
      const w = Math.max(1e-6, mu * (1 - mu));
      const z = eta + (y - mu) / w;
      n++;
      ll += y ? Math.log(Math.max(1e-12, mu)) : Math.log(Math.max(1e-12, 1 - mu));
      for (let j = 0; j < p; j++) {
        const xw = x[j] * w;
        if (xw) { XtWz[j] += xw * z; for (let k = j; k < p; k++) XtWX[j * p + k] += xw * x[k]; }
      }
    });
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) XtWX[j * p + k] = XtWX[k * p + j];
    for (let j = 0; j < p; j++) XtWX[j * p + j] += 1e-8;      // ridge minimo
    const sol = solveWithInverse(XtWX, XtWz, p);
    if (!sol) return last;
    let delta = 0;
    for (let j = 0; j < p; j++) delta = Math.max(delta, Math.abs(sol.beta[j] - beta[j]));
    beta = sol.beta;
    const se = new Float64Array(p), pv = new Float64Array(p);
    for (let j = 0; j < p; j++) {
      se[j] = Math.sqrt(Math.max(0, sol.inv[j * p + j]));
      pv[j] = pTwoSided(se[j] > 0 ? beta[j] / se[j] : NaN);
    }
    last = { beta, se, p: pv, n, ll, iter: it + 1 };
    if (delta < 1e-8) break;
  }
  return last;
}

/* Contraste de dos proporciones + IC de Wald por grupo. */
function twoProportions(s1, n1, s2, n2) {
  const p1 = s1 / n1, p2 = s2 / n2;
  const pp = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
  const z = se > 0 ? (p1 - p2) / se : NaN;
  const ci = (p, n) => {
    const s = Math.sqrt(p * (1 - p) / n);
    return [Math.max(0, p - 1.96 * s), Math.min(1, p + 1.96 * s)];
  };
  return { p1, p2, z, p: pTwoSided(z), ci1: ci(p1, n1), ci2: ci(p2, n2),
           diff: p1 - p2, rel: p2 ? (p1 - p2) / p2 : NaN };
}

/* z robusto sobre la mediana movil: marca semanas anomalas sin que los propios
   outliers inflen la escala (MAD en vez de desviacion tipica). */
function robustAnomalies(series, window = 13, threshold = 5) {
  const n = series.length, base = new Float64Array(n), resid = new Float64Array(n);
  const half = window >> 1;
  for (let i = 0; i < n; i++) {
    const w = [];
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) w.push(series[j]);
    w.sort((a, b) => a - b);
    base[i] = quantileSorted(Float64Array.from(w), .5);
    resid[i] = series[i] - base[i];
  }
  const rs = Float64Array.from(resid).sort();
  const medR = quantileSorted(rs, .5);
  const dev = Float64Array.from(resid, v => Math.abs(v - medR)).sort();
  const mad = quantileSorted(dev, .5) || 1;
  const z = Float64Array.from(resid, v => 0.6745 * (v - medR) / mad);
  return { base, z, flagged: Array.from(z, (v, i) => Math.abs(v) > threshold ? i : -1).filter(i => i >= 0) };
}

if (typeof module !== "undefined") {
  module.exports = {
    decodeFacts, aggregate, buildMask, monthRange, periodDays, kpi, state,
    ols, logit, pearson, pearsonMatrix, twoProportions, boxStats, robustAnomalies, quantileSorted,
    pTwoSided, normCdf,
    ctx: () => ({ F, N, D, P, S, rowCat, rowCountry, rowSize, rowDay, rowWeek, rowDow, monthSeason }),
  };
}
