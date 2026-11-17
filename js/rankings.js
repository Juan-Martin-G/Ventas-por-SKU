/*
 * Rankings para la pestaña Análisis. ÚNICO lugar con esta lógica.
 * Mismos criterios que las láminas (presentaciones/top_por_linea_v2.py y v3):
 *  - SKU, familias y marcas: solo productos tangibles (esTangible); % sobre la venta de productos
 *    tangibles de la línea y año.
 *  - Clientes: todo lo facturado en la línea (productos, glosas, servicios, convenios, arriendos), neto,
 *    ISM incluido; % sobre el total facturado de la línea y año. N° SKU y producto principal: solo tangibles.
 *  - Ranking propio por año: solo ítems con monto neto positivo, por monto (redondeado a centavos) y nombre.
 * Funciona en el navegador (window.VS.rankings) y en Node (module.exports), para probarlo contra los Excel.
 */
(function (raiz) {
  'use strict';
  const VS = raiz.VS = raiz.VS || {};

  const LINEAS = ['E. Esterilización', 'Servicio Técnico', 'E. Endoscopía', 'Incardia', 'Dental',
                  'C. Esterilización', 'C. Endoscopía', 'MMQ'];
  const LINEAS_FUERA = ['REAS', 'Trazabilidad', 'Otros', 'Sin Catalogar'];

  // ── Criterio de producto tangible (idéntico a es_tangible() de top_por_linea_v2.py / v3) ──
  const TIPOS_NO_PRODUCTO = ['Glosa', 'Servicio'];                 // regla 1
  const ORIGEN_NO_PRODUCTO = ['Arriendo'];                         // regla 2
  const PREFIJOS_SKU_SERVICIO = ['SERV', 'SERV_', 'CONV', 'MANT', 'S-', 'VISITA', 'INSTALACION', 'REPARACION'];  // regla 3
  const SKU_NO_PRODUCTO = ['CUADRE ISM', 'EXTRA-COST', '0'];       // regla 3
  const PREFIJOS_FAMILIA_SERVICIO = ['SERVICIO', 'CONVENIO', 'GLOSA'];  // regla 4
  const SKU_SIEMPRE_PRODUCTO = ['S-VIDEO'];                        // ajustes revisados con el usuario
  const SKU_SIEMPRE_SERVICIO = ['TRAT-REAS', '45261', 'R022921'];
  const SIN_PRODUCTOS = '— (solo servicios/glosas)';

  function esTangible(tipo, origen, sku, familia) {
    const s = String(sku).trim().toUpperCase();
    if (TIPOS_NO_PRODUCTO.indexOf(tipo) !== -1 || ORIGEN_NO_PRODUCTO.indexOf(origen) !== -1) return false;
    if (SKU_SIEMPRE_SERVICIO.indexOf(s) !== -1) return false;
    if (SKU_SIEMPRE_PRODUCTO.indexOf(s) !== -1) return true;
    if (PREFIJOS_SKU_SERVICIO.some(p => s.startsWith(p)) || SKU_NO_PRODUCTO.indexOf(s) !== -1) return false;
    const f = String(familia).trim().toUpperCase();
    if (PREFIJOS_FAMILIA_SERVICIO.some(p => f.startsWith(p))) return false;
    return true;
  }

  /** Suma compensada (Neumaier): totales al peso, sin depender del orden. */
  function Suma() { this.s = 0; this.c = 0; }
  Suma.prototype.mas = function (x) {
    const t = this.s + x;
    this.c += Math.abs(this.s) >= Math.abs(x) ? (this.s - t) + x : (x - t) + this.s;
    this.s = t;
  };
  Suma.prototype.valor = function () { return this.s + this.c; };

  const r2 = x => Math.round(x * 100) / 100;
  const cmpTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);      // orden por código, como Python

  /**
   * Marca cada fila del modelo (VS.preparar) con:
   *  _t   true si es producto tangible
   *  _cat 'producto' | 'servicio' | 'arriendo' | 'glosa'  (glosa sin detalle = Tipo Glosa)
   * Se calcula una sola vez por modelo.
   */
  function anotar(M) {
    if (M._rankings) return M._rankings;
    const D = M.dic, cache = new Map();
    const arr = D.origen.indexOf('Arriendo');
    for (const r of M.filas) {
      const k = r.t + '|' + r.o + '|' + r.s + '|' + r.f;
      let t = cache.get(k);
      if (t === undefined) {
        t = esTangible(D.tipo[r.t], D.origen[r.o], D.sku[r.s], D.familia[r.f]);
        cache.set(k, t);
      }
      r._t = t;
      r._cat = r.g ? 'glosa' : (r.o === arr ? 'arriendo' : (t ? 'producto' : 'servicio'));
    }
    const idx = {};
    D.linea.forEach((n, i) => { idx[n] = i; });
    M._rankings = {
      lineas: LINEAS.map(n => idx[n]).filter(i => i !== undefined),
      fuera: LINEAS_FUERA.map(n => idx[n]).filter(i => i !== undefined),
    };
    return M._rankings;
  }

  // Dimensiones: campo de la fila, diccionario y si usa solo productos tangibles.
  const DIMS = {
    sku: { campo: 's', dic: 'sku', tangible: true, nombre: 'SKU' },
    familia: { campo: 'f', dic: 'familia', tangible: true, nombre: 'Familia' },
    marca: { campo: 'k', dic: 'marca', tangible: true, nombre: 'Marca' },
    cliente: { campo: 'c', dic: 'cliente', tangible: false, nombre: 'Cliente' },
  };

  /**
   * Agrega `filas` (ya filtradas) de las líneas pedidas por la dimensión `dim`.
   * lineas: arreglo de índices de línea (una o varias). Devuelve, por año:
   *   { lista: ítems con monto > 0 ordenados (ranking), den: denominador del %, total, prod }
   * y `todos`: Map id → { id, nombre, m: {año: neto} } con todos los ítems (para la variación).
   * Ítem: { id, nombre, m, u, pct, nsku, principal, desc }.
   */
  function calcular(M, filas, dim, lineas) {
    anotar(M);
    const def = DIMS[dim], D = M.dic, dic = D[def.dic];
    const enLineas = new Set(lineas);
    const anios = M.anios;
    const total = {}, prod = {};
    anios.forEach(a => { total[a] = new Suma(); prod[a] = new Suma(); });
    const mapa = new Map();
    for (const r of filas) {
      if (!enLineas.has(r.l)) continue;
      total[r.a].mas(r.m);
      if (r._t) prod[r.a].mas(r.m);
      if (def.tangible && !r._t) continue;
      const id = r[def.campo];
      let it = mapa.get(id);
      if (!it) {
        it = { id: id, nombre: dic[id], m: {}, u: {}, skus: {}, porSku: {}, desc: null };
        anios.forEach(a => { it.m[a] = new Suma(); it.u[a] = new Suma(); it.skus[a] = new Set(); it.porSku[a] = new Map(); });
        mapa.set(id, it);
      }
      it.m[r.a].mas(r.m);
      it.u[r.a].mas(r.u);
      if (dim === 'sku' && it.desc === null) it.desc = D.descripcion[r.d];
      if (r._t && (dim === 'cliente' || dim === 'familia')) {
        // filas en cero ya no vienen (VS.preparar las oculta): toda fila cuenta como "con movimiento"
        it.skus[r.a].add(r.s);
        const ps = it.porSku[r.a];
        let s = ps.get(r.s);
        if (!s) { s = new Suma(); ps.set(r.s, s); }
        s.mas(r.m);
      }
    }
    const res = { dim: dim, anios: {}, todos: new Map() };
    mapa.forEach(it => {
      const m = {};
      anios.forEach(a => { m[a] = it.m[a].valor(); });
      res.todos.set(it.id, { id: it.id, nombre: it.nombre, desc: it.desc, m: m });
    });
    anios.forEach(a => {
      const den = def.tangible ? prod[a].valor() : total[a].valor();
      const lista = [];
      mapa.forEach(it => {
        const m = it.m[a].valor();
        if (!(m > 0.5)) return;
        const out = { id: it.id, nombre: it.nombre, desc: it.desc, m: m, u: it.u[a].valor(), pct: den ? m / den : 0 };
        if (dim === 'cliente' || dim === 'familia') {
          let principal = null, mejor = null;
          let conVenta = 0;
          it.porSku[a].forEach((s, sku) => {
            const v = s.valor(), cod = D.sku[sku];
            if (v > 0.5) conVenta++;
            if (principal === null || r2(v) > mejor || (r2(v) === mejor && cmpTexto(cod, principal) < 0)) { principal = cod; mejor = r2(v); }
          });
          out.principal = principal === null ? SIN_PRODUCTOS : principal;
          // clientes: SKU tangibles con movimiento en el año; familias: SKU con venta neta positiva
          out.nsku = dim === 'cliente' ? it.skus[a].size : conVenta;
        }
        lista.push(out);
      });
      lista.sort((x, y) => (r2(y.m) - r2(x.m)) || cmpTexto(x.nombre, y.nombre));
      lista.forEach((it, i) => { it.rank = i + 1; });
      res.anios[a] = { lista: lista, den: den, total: total[a].valor(), prod: prod[a].valor() };
    });
    return res;
  }

  /** Suma del top n / denominador (concentración). */
  function concentracion(res, a, n) {
    const d = res.anios[a];
    if (!d || !d.den) return 0;
    const s = new Suma();
    d.lista.slice(0, n).forEach(it => s.mas(it.m));
    return s.valor() / d.den;
  }

  /** Curva de Pareto: % acumulado (sobre el denominador) por n.º de ítems del ranking. */
  function pareto(res, a) {
    const d = res.anios[a], s = new Suma(), puntos = [{ x: 0, y: 0 }];
    let n80 = null;
    d.lista.forEach((it, i) => {
      s.mas(it.m);
      const y = d.den ? s.valor() / d.den : 0;
      puntos.push({ x: i + 1, y: y });
      if (n80 === null && y >= 0.8) n80 = i + 1;
    });
    return { puntos: puntos, n80: n80, n: d.lista.length };
  }

  /** Mayores alzas y bajas (monto último año − año anterior), n de cada lado. */
  function variacion(res, a0, a1, n) {
    const v = [];
    res.todos.forEach(it => {
      const d = (it.m[a1] || 0) - (it.m[a0] || 0);
      if (Math.abs(d) >= 0.5) v.push({ id: it.id, nombre: it.nombre, desc: it.desc, m0: it.m[a0] || 0, m1: it.m[a1] || 0, d: d });
    });
    const alzas = v.filter(x => x.d > 0).sort((x, y) => y.d - x.d || cmpTexto(x.nombre, y.nombre)).slice(0, n);
    const bajas = v.filter(x => x.d < 0).sort((x, y) => x.d - y.d || cmpTexto(x.nombre, y.nombre)).slice(0, n);
    return { alzas: alzas, bajas: bajas };
  }

  /**
   * Mix: por línea (las 8 + «Otras líneas») y año, total facturado y su split
   * producto tangible / servicios / arriendos / glosas sin detalle.
   */
  function mix(M, filas) {
    const info = anotar(M);
    const grupos = info.lineas.map(l => ({ id: l, nombre: M.dic.linea[l] }));
    grupos.push({ id: 'otras', nombre: 'Otras líneas', detalle: LINEAS_FUERA.join(', ') });
    const pos = new Map();
    grupos.forEach((g, i) => { pos.set(g.id, i); });
    const cats = ['producto', 'servicio', 'arriendo', 'glosa'];
    grupos.forEach(g => {
      g.total = {}; g.cat = {};
      M.anios.forEach(a => { g.total[a] = new Suma(); g.cat[a] = {}; cats.forEach(c => { g.cat[a][c] = new Suma(); }); });
    });
    const tot = {};
    M.anios.forEach(a => { tot[a] = new Suma(); });
    for (const r of filas) {
      const i = pos.has(r.l) ? pos.get(r.l) : pos.get('otras');
      const g = grupos[i];
      g.total[r.a].mas(r.m);
      g.cat[r.a][r._cat].mas(r.m);
      tot[r.a].mas(r.m);
    }
    grupos.forEach(g => {
      M.anios.forEach(a => {
        g.total[a] = g.total[a].valor();
        cats.forEach(c => { g.cat[a][c] = g.cat[a][c].valor(); });
      });
    });
    const total = {};
    M.anios.forEach(a => { total[a] = tot[a].valor(); });
    return { grupos: grupos, total: total, categorias: cats };
  }

  /** Concentración top 5 y top 10 de SKU, familias y clientes para cada una de las 8 líneas. */
  function resumenConcentracion(M, filas) {
    const info = anotar(M);
    return info.lineas.map(l => {
      const fila = { linea: l, nombre: M.dic.linea[l] };
      ['sku', 'familia', 'cliente'].forEach(dim => {
        const res = calcular(M, filas, dim, [l]);
        fila[dim] = {};
        M.anios.forEach(a => { fila[dim][a] = { 5: concentracion(res, a, 5), 10: concentracion(res, a, 10) }; });
      });
      return fila;
    });
  }

  const R = {
    LINEAS: LINEAS, LINEAS_FUERA: LINEAS_FUERA, SIN_PRODUCTOS: SIN_PRODUCTOS, DIMS: DIMS,
    esTangible: esTangible, anotar: anotar, calcular: calcular, concentracion: concentracion,
    pareto: pareto, variacion: variacion, mix: mix, resumenConcentracion: resumenConcentracion,
  };
  VS.rankings = R;
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(typeof window !== 'undefined' ? window : globalThis);
