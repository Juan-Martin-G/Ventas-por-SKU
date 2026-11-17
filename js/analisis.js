/*
 * Vista 4: Análisis. Gráficos para descomponer la venta con los mismos criterios de las láminas
 * (toda la lógica de rankings está en js/rankings.js). Chart.js se carga solo al abrir esta pestaña.
 * Filtros globales: la línea se elige aquí (es el mismo filtro global de línea); el año decide qué
 * años se muestran; familia, marca, origen, cliente, búsqueda y glosas se aplican y se avisa que
 * entonces las cifras ya no son las de las láminas.
 */
window.VS = window.VS || {};
VS.analisis = (function (VS) {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = VS.esc;
  const R = VS.rankings;

  const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js';
  const CHART_SRI = 'sha384-dug+JxfBvklEQdJ4AYuBBAIScUz0bVN73xpy273gcAwHjb3qI0fXmuYNaNfdyYJG';

  // Paleta por POSICIÓN en el ranking (igual que las láminas) y gris para «Resto de la línea».
  const P25 = ['#F4908C', '#A9D18E', '#FFD966', '#8497B0', '#9DC3E6'];
  const P26 = ['#FAC8C6', '#D4E8C6', '#FFECB2', '#C2CBD8', '#CEE1F2'];
  const P26b = ['#FCE3E2', '#EAF4E3', '#FFF6D9', '#E0E5EC', '#E6F0F9'];
  const PALETA = { 5: { 2025: P25, 2026: P26 }, 10: { 2025: P25.concat(P26), 2026: P26.concat(P26b) } };
  const GRIS = '#D9D9D9';
  // Paleta categórica validada (daltonismo y contraste), en orden fijo: una por línea y por tipo de venta.
  const CATEG = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const GRIS_OTRAS = '#9aa1ab';
  const CATS = { producto: 'Producto tangible', servicio: 'Servicios y convenios', arriendo: 'Arriendos', glosa: 'Glosas sin detalle' };
  const COL_ANIO = { 2025: '#2a78d6', 2026: '#eb6834' };        // mismos colores por año que la vista Resumen
  const ALZA = '#2a78d6', BAJA = '#e34948';                      // par divergente azul ↔ rojo
  const TXT = '#1a1a2e', MUT = '#6b7280', GRILLA = '#eceef2';

  let M = null, info = null;
  const st = { dim: 'sku', top: 5 };
  let charts = [];
  let promesa = null;
  let turno = 0;
  const datos = {};                 // datos de cada tarjeta para CSV/PNG

  // ── Formatos ────────────────────────────────────────────────────────
  const mm1 = x => VS.num(x / 1e6, 1);
  const pct0 = p => VS.num(p * 100, 0) + '%';
  const pct1 = p => VS.num(p * 100, 1) + '%';
  const dimTxt = { sku: 'SKU', familia: 'Familias', cliente: 'Clientes', marca: 'Marcas' };
  const esTangible = dim => dim !== 'cliente';
  const baseTxt = dim => (esTangible(dim) ? 'la venta de productos tangibles de la línea' : 'el total facturado de la línea');

  // Nombres de clientes abreviados sin cortar palabras (como las láminas).
  const ABREV = [['SERVICIO DE SALUD', 'S.S.'], ['SERVICIO SALUD', 'S.S.'], ['ILUSTRE MUNICIPALIDAD', 'Munic.'],
    ['MUNICIPALIDAD', 'Munic.'], ['DIRECCION', 'Dir.'], ['DIRECCIÓN', 'Dir.'], ['HOSPITAL', 'Hosp.'],
    ['UNIVERSIDAD', 'Univ.'], ['INSTITUTO', 'Inst.'], ['METROPOLITANO', 'Metrop.'], ['METROPOLITANA', 'Metrop.'],
    ['GOBIERNO REGIONAL', 'Gob. Regional'], ['SOCIEDAD', 'Soc.'], ['COMERCIALIZADORA', 'Com.'], ['COMERCIAL', 'Com.'],
    ['CORPORACION', 'Corp.'], ['CORPORACIÓN', 'Corp.'], ['FUNDACION', 'Fund.'], ['FUNDACIÓN', 'Fund.'],
    ['ASOCIACION', 'Asoc.'], ['CENTRO', 'Ctro.'], ['LIMITADA', 'Ltda.'], ['CONCESIONARIA', 'Conc.'],
    ['ASISTENCIAL', 'Asist.'], ['NACIONAL', 'Nac.'], ['REGIONAL', 'Reg.']];
  const MINUSC = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'EN', 'EL', 'PARA']);
  const SIGLAS = { 'S.A.': 'S.A.', 'SA': 'SA', 'S.A': 'S.A', 'SPA': 'SpA', 'LTDA': 'Ltda.', 'LTDA.': 'Ltda.', 'EIRL': 'EIRL',
    'UC': 'UC', 'ACHS': 'ACHS', 'IST': 'IST', 'FACH': 'FACH', 'DR': 'Dr.', 'DR.': 'Dr.', 'II': 'II', 'III': 'III', 'IV': 'IV' };

  function clienteCorto(nombre) {
    let t = ' ' + String(nombre).toUpperCase().split(/\s+/).join(' ') + ' ';
    ABREV.forEach(([largo, ab]) => { t = t.split(' ' + largo + ' ').join(' ' + ab.toUpperCase() + ' '); });
    return t.trim().split(' ').map((w, k) => {
      if (SIGLAS[w]) return SIGLAS[w];
      if (/^(?:[A-ZÑ]\.)+[A-ZÑ]\.?$/.test(w)) return w;
      if (MINUSC.has(w) && k > 0) return w.toLowerCase();
      if (w.endsWith('.') && w.length <= 8) return w[0] + w.slice(1).toLowerCase();
      return w.split('-').map(p => p.charAt(0) + p.slice(1).toLowerCase()).join('-');
    }).join(' ');
  }
  /** Recorta por palabras completas a máx. n caracteres (nunca a mitad de palabra). */
  function sinCortar(t, n) {
    const pal = String(t).split(/\s+/);
    let res = [pal[0]];
    for (let i = 1; i < pal.length; i++) {
      if ((res.join(' ') + ' ' + pal[i]).length > n) break;
      res.push(pal[i]);
    }
    if (res.length < pal.length) while (res.length > 1 && /^(de|del|la|las|los|y|e|en|el|para|-|–|\/)$/i.test(res[res.length - 1])) res.pop();
    return res.join(' ').replace(/[\s,–\-/]+$/, '');
  }
  /** Nombre para leyendas y ejes: SKU = código; cliente = abreviado (≤ 35); familia y marca = nombre (≤ 35). */
  const nombreCorto = (it, dim) => (dim === 'sku' ? String(it.nombre) : sinCortar(dim === 'cliente' ? clienteCorto(it.nombre) : it.nombre || '(sin nombre)', 35));
  const nombreLargo = (it, dim) => (dim === 'sku' && it.desc ? it.nombre + ' – ' + it.desc : String(it.nombre || '(sin nombre)'));

  const oscuro = hex => {
    const h = String(hex).replace('#', '');
    if (h.length !== 6) return false;
    const c = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 0.45;
  };

  // ── Datos (filtros globales, salvo línea y año) ─────────────────────
  function filasAnalisis(est) {
    const T = est.terminos;
    return M.filas.filter(r => {
      if (r.g && !est.glosas) return false;
      if (est.familia !== null && r.f !== est.familia) return false;
      if (est.marca !== null && (r.g || r.k !== est.marca)) return false;
      if (est.origen !== null && r.o !== est.origen) return false;
      if (est.cliente !== null && r.c !== est.cliente) return false;
      for (let i = 0; i < T.length; i++) if (r.x.indexOf(T[i]) === -1) return false;
      return true;
    });
  }

  function filtrosActivos(est) {
    const D = M.dic, f = [];
    if (est.familia !== null) f.push('familia «' + D.familia[est.familia] + '»');
    if (est.marca !== null) f.push('marca «' + D.marca[est.marca] + '»');
    if (est.origen !== null) f.push('origen «' + D.origen[est.origen] + '»');
    if (est.cliente !== null) f.push('cliente «' + D.cliente[est.cliente] + '»');
    if (est.terminos.length) f.push('búsqueda «' + est.q + '»');
    if (!est.glosas) f.push('sin glosas sin detalle');
    return f;
  }

  // ── Clic en un ítem ────────────────────────────────────────────────
  function abrir(dim, id, linea) {
    if (id === undefined || id === null) return;
    if (dim === 'sku') { VS.detalle.ir(M.dic.sku[id]); return; }
    if (dim === 'cliente') { VS.fijarFiltros({ cliente: id }, 'cliente'); return; }
    const cambios = {};
    cambios[dim] = id;                       // familia o marca → Explorador filtrado
    if (linea !== undefined && linea !== null) cambios.linea = linea;
    VS.fijarFiltros(cambios, 'explorador');
  }

  // ── Chart.js (carga diferida, versión fija) ─────────────────────────
  function cargarChart() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (!promesa) {
      promesa = new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = CHART_URL;
        s.integrity = CHART_SRI;
        s.crossOrigin = 'anonymous';
        s.onload = () => {
          const C = window.Chart;
          C.defaults.font.family = getComputedStyle(document.body).fontFamily;
          C.defaults.font.size = 11;
          C.defaults.color = MUT;
          C.defaults.animation = false;
          C.defaults.maintainAspectRatio = false;
          C.defaults.plugins.tooltip.backgroundColor = '#fff';
          C.defaults.plugins.tooltip.titleColor = TXT;
          C.defaults.plugins.tooltip.bodyColor = TXT;
          C.defaults.plugins.tooltip.borderColor = '#e2e4e8';
          C.defaults.plugins.tooltip.borderWidth = 1;
          C.defaults.plugins.tooltip.padding = 8;
          C.defaults.plugins.legend.labels.boxWidth = 10;
          C.defaults.plugins.legend.labels.boxHeight = 10;
          ok(C);
        };
        s.onerror = () => { promesa = null; mal(new Error('No se pudo cargar la librería de gráficos.')); };
        document.head.appendChild(s);
      });
    }
    return promesa;
  }

  /** Etiquetas % dentro de los segmentos (oculta < mín. y las que se montarían). */
  const pluginEtiquetas = {
    id: 'anEtiquetas',
    afterDatasetsDraw(chart, args, op) {
      if (!op || op.off) return;
      const ctx = chart.ctx, horiz = chart.options.indexAxis === 'y', min = op.min === undefined ? 0.02 : op.min;
      const ult = {};
      ctx.save();
      ctx.font = '600 10px ' + window.Chart.defaults.font.family;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden) return;
        meta.data.forEach((el, j) => {
          const v = ds.data[j];
          if (v === null || v === undefined || Math.abs(v) < min) return;
          const p = el.getProps(['x', 'y', 'base'], true);
          const txt = pct0(v);
          const largo = horiz ? Math.abs(p.x - p.base) : Math.abs(p.base - p.y);
          const necesita = horiz ? ctx.measureText(txt).width + 6 : 12;
          if (largo < necesita) return;
          const cx = horiz ? (p.x + p.base) / 2 : p.x, cy = horiz ? p.y : (p.y + p.base) / 2;
          const pos = horiz ? cx : cy;
          if (ult[j] !== undefined && Math.abs(pos - ult[j]) < necesita) return;
          ult[j] = pos;
          const bg = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[j] : ds.backgroundColor;
          ctx.fillStyle = oscuro(bg) ? '#fff' : '#333';
          ctx.fillText(txt, cx, cy);
        });
      });
      ctx.restore();
    },
  };

  /** Valor en MM$ al final de cada barra horizontal (variación). */
  const pluginValores = {
    id: 'anValores',
    afterDatasetsDraw(chart, args, op) {
      if (!op || !op.on) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 10.5px ' + window.Chart.defaults.font.family;
      ctx.fillStyle = TXT;
      ctx.textBaseline = 'middle';
      const ds = chart.data.datasets[0], meta = chart.getDatasetMeta(0);
      meta.data.forEach((el, j) => {
        const v = ds.data[j];
        const p = el.getProps(['x', 'y'], true);
        ctx.textAlign = v >= 0 ? 'left' : 'right';
        ctx.fillText(VS.conSigno(v, VS.num(v, 1)), p.x + (v >= 0 ? 4 : -4), p.y);
      });
      ctx.restore();
    },
  };

  function nuevoChart(canvas, cfg) {
    const ch = new window.Chart(canvas, cfg);
    charts.push(ch);
    return ch;
  }
  function destruir() { charts.forEach(c => c.destroy()); charts = []; }

  const ejePct = (max) => ({
    stacked: true, min: 0, max: max || 1, grid: { color: GRILLA }, border: { display: false },
    ticks: { stepSize: 0.1, callback: v => pct0(v) },
  });

  /** Columna apilada al 100% de un año: un segmento por ítem del top + «Resto de la línea». */
  function cfgColumna(titulo, items, d, paleta, dim, linea, leyenda) {
    const ds = items.map((it, i) => ({
      label: nombreCorto(it, dim), data: [it.pct], backgroundColor: paleta[i], borderColor: '#fff', borderWidth: 1,
      _it: it, _dim: dim, _linea: linea,
    }));
    const suma = items.reduce((s, it) => s + it.m, 0);
    const resto = d.den ? (d.den - suma) / d.den : 0;
    ds.push({ label: 'Resto de la línea', data: [Math.max(0, resto)], backgroundColor: GRIS, borderColor: '#fff', borderWidth: 1,
              _resto: { m: d.den - suma, pct: resto } });
    return {
      type: 'bar',
      data: { labels: [titulo], datasets: ds },
      plugins: [pluginEtiquetas],
      options: {
        datasets: { bar: { categoryPercentage: 0.62, barPercentage: 1 } },
        plugins: {
          legend: { display: leyenda, position: 'top', align: 'start', onClick: null, labels: { color: TXT, padding: 6 } },
          title: { display: true, text: titulo, color: TXT, font: { size: 14, weight: 'normal' }, padding: { bottom: 4 } },
          anEtiquetas: { min: 0.02 },
          tooltip: {
            callbacks: {
              title: c => (c[0].dataset._it ? nombreLargo(c[0].dataset._it, dim) : 'Resto de la línea'),
              label: c => {
                const x = c.dataset._it || c.dataset._resto;
                return pct1(x.pct) + ' · MM$ ' + mm1(x.m);
              },
            },
          },
        },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { display: false } }, y: ejePct() },
        onClick: (e, el, ch) => { if (el.length) { const s = ch.data.datasets[el[0].datasetIndex]; if (s._it) abrir(s._dim, s._it.id, s._linea); } },
        onHover: (e, el) => { e.native.target.style.cursor = el.length && e.chart.data.datasets[el[0].datasetIndex]._it ? 'pointer' : 'default'; },
      },
    };
  }

  // ── Tarjetas ────────────────────────────────────────────────────────
  function tarjeta(id, titulo, sub, png, csv) {
    return '<section class="an-card" id="an-' + id + '"><header class="an-cab"><div><h2>' + titulo + '</h2>' +
      (sub ? '<p class="an-sub">' + sub + '</p>' : '') + '</div><div class="an-acc">' +
      (png ? '<button type="button" class="btn-sec" data-png="' + id + '" title="Descargar el gráfico como imagen">PNG</button>' : '') +
      (csv ? '<button type="button" class="btn-sec" data-csv="' + id + '" title="Descargar los datos (se abren en Excel)">CSV</button>' : '') +
      '</div></header><div class="an-cuerpo"></div></section>';
  }
  const cuerpo = id => document.querySelector('#an-' + id + ' .an-cuerpo');

  function tablaTop(a, items, d, paleta, dim) {
    const unid = dim !== 'cliente';
    const suma = items.reduce((s, it) => s + it.m, 0);
    let h = '<div class="an-tabla"><h3>' + a + '</h3><table class="an-t"><thead><tr><th class="num">#</th><th>' +
      (dim === 'sku' ? 'SKU' : dim === 'cliente' ? 'Cliente' : dim === 'familia' ? 'Familia' : 'Marca') +
      '</th><th class="num">MM$</th><th class="num">%</th><th class="num">' + (unid ? 'Unidades' : 'N° SKU') + '</th></tr></thead><tbody>';
    items.forEach((it, i) => {
      h += '<tr data-id="' + it.id + '"><td class="num">' + it.rank + '</td><td class="an-nom" title="' + esc(nombreLargo(it, dim)) + '">' +
        '<i style="background:' + paleta[i] + '"></i>' + esc(nombreLargo(it, dim)) + '</td><td class="num">' + mm1(it.m) +
        '</td><td class="num">' + pct1(it.pct) + '</td><td class="num">' + (unid ? VS.unid(it.u) : VS.num(it.nsku, 0)) + '</td></tr>';
    });
    if (!items.length) h += '<tr class="vacia"><td colspan="5">Sin ítems con venta positiva.</td></tr>';
    const resto = d.den - suma;
    h += '<tr class="an-resto"><td></td><td><i style="background:' + GRIS + '"></i>Resto de la línea</td><td class="num">' + mm1(resto) +
      '</td><td class="num">' + pct1(d.den ? resto / d.den : 0) + '</td><td></td></tr>';
    h += '<tr class="total"><td></td><td>Total (' + (esTangible(dim) ? 'productos tangibles' : 'facturado') + ')</td><td class="num">' + mm1(d.den) +
      '</td><td class="num">100,0%</td><td></td></tr></tbody></table></div>';
    return h;
  }

  /** 1 · Descomposición del top (una línea). */
  function pintarDescomposicion(filas, linea, av) {
    const dim = st.dim, n = st.top;
    const res = R.calcular(M, filas, dim, [linea]);
    const nombreL = M.dic.linea[linea];
    $('an-desc').querySelector('h2').textContent = '1 · Descomposición del top ' + n + ' — ' + dimTxt[dim] + ' · ' + nombreL;
    $('an-desc').querySelector('.an-sub').textContent = '% sobre ' + baseTxt(dim) + ' en cada año. Clic en un segmento para ver el detalle.';
    const alto = n === 10 ? 'top10' : '';
    let h = '<div class="an-dos">' + av.map(a => '<div class="an-lienzo ' + alto + '"><canvas data-anio="' + a + '"></canvas></div>').join('') + '</div>';
    h += '<div class="an-dos an-tablas">' + av.map(a => tablaTop(a, res.anios[a].lista.slice(0, n), res.anios[a], PALETA[n][a], dim)).join('') + '</div>';
    const c = cuerpo('desc');
    c.innerHTML = h;
    av.forEach(a => {
      const d = res.anios[a];
      nuevoChart(c.querySelector('canvas[data-anio="' + a + '"]'), cfgColumna(String(a), d.lista.slice(0, n), d, PALETA[n][a], dim, linea, true));
    });
    c.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => abrir(dim, Number(tr.dataset.id), linea)));
    datos.desc = { titulo: 'Top ' + n + ' ' + dimTxt[dim] + ' ' + nombreL, csv: () => filasCsvTop([{ linea: nombreL, res: res }], av, n, dim) };
  }

  function filasCsvTop(grupos, av, n, dim) {
    const out = [];
    grupos.forEach(g => av.forEach(a => {
      const d = g.res.anios[a], items = d.lista.slice(0, n);
      items.forEach(it => out.push({ linea: g.linea, anio: a, rank: it.rank, nombre: nombreLargo(it, dim), m: it.m, pct: it.pct,
                                     u: dim === 'cliente' ? null : it.u, nsku: dim === 'cliente' ? it.nsku : null }));
      const suma = items.reduce((s, it) => s + it.m, 0);
      out.push({ linea: g.linea, anio: a, rank: null, nombre: 'Resto de la línea', m: d.den - suma, pct: d.den ? (d.den - suma) / d.den : 0 });
      out.push({ linea: g.linea, anio: a, rank: null, nombre: 'Total', m: d.den, pct: 1 });
    }));
    return {
      cols: [{ t: 'Línea', v: f => f.linea }, { t: 'Año', v: f => f.anio }, { t: 'Ranking', v: f => f.rank },
             { t: dimTxt[dim], v: f => f.nombre }, { t: 'Monto (CLP)', v: f => f.m }, { t: '% de la línea', v: f => f.pct * 100 },
             { t: dim === 'cliente' ? 'N° SKU' : 'Unidades', v: f => (dim === 'cliente' ? f.nsku : f.u) }],
      filas: out,
    };
  }

  /** 2 · Todas las líneas: la descomposición para las 8 líneas a la vez. */
  function pintarGrilla(filas, av) {
    const dim = st.dim, n = st.top;
    $('an-desc').querySelector('h2').textContent = '2 · Todas las líneas — top ' + n + ' ' + dimTxt[dim];
    $('an-desc').querySelector('.an-sub').textContent = 'Cuánto concentra el top en cada línea (% sobre ' + baseTxt(dim) +
      '). Pasa el cursor para ver cada ítem; clic en el nombre de la línea para verla en detalle.';
    const grupos = info.lineas.map(l => ({ l: l, linea: M.dic.linea[l], res: R.calcular(M, filas, dim, [l]) }));
    let h = '<div class="an-grilla">';
    grupos.forEach(g => {
      const conc = av.map(a => pct0(R.concentracion(g.res, a, n))).join(' → ');
      h += '<div class="an-mini"><button type="button" class="an-mini-cab" data-linea="' + g.l + '"><b>' + esc(g.linea) + '</b><span>Top ' + n + ': ' + conc + '</span></button>' +
        '<div class="an-lienzo mini" data-rotulo="' + esc(g.linea + ' · top ' + n + ': ' + conc) + '"><canvas data-linea="' + g.l + '"></canvas></div></div>';
    });
    h += '</div><div class="an-leyenda-anios">' + av.map(a => '<span><i style="background:' + PALETA[n][a][0] + '"></i>' + a +
      ' (tonos ' + (a === av[0] && av.length > 1 ? 'intensos' : 'claros') + ')</span>').join('') + '<span><i style="background:' + GRIS + '"></i>Resto de la línea</span></div>';
    const c = cuerpo('desc');
    c.innerHTML = h;
    grupos.forEach(g => {
      const ds = [];
      for (let i = 0; i < n; i++) {
        const its = av.map(a => g.res.anios[a].lista[i] || null);
        ds.push({ label: '#' + (i + 1), data: its.map(it => (it ? it.pct : null)), backgroundColor: av.map(a => PALETA[n][a][i]),
                  borderColor: '#fff', borderWidth: 1, _its: its, _dim: dim, _linea: g.l });
      }
      const restos = av.map(a => {
        const d = g.res.anios[a], s = d.lista.slice(0, n).reduce((x, it) => x + it.m, 0);
        return { m: d.den - s, pct: d.den ? (d.den - s) / d.den : 0 };
      });
      ds.push({ label: 'Resto de la línea', data: restos.map(r => Math.max(0, r.pct)), backgroundColor: GRIS, borderColor: '#fff', borderWidth: 1, _restos: restos });
      nuevoChart(c.querySelector('canvas[data-linea="' + g.l + '"]'), {
        type: 'bar',
        data: { labels: av.map(String), datasets: ds },
        plugins: [pluginEtiquetas],
        options: {
          datasets: { bar: { categoryPercentage: 0.7, barPercentage: 1 } },
          plugins: {
            legend: { display: false },
            anEtiquetas: { min: 0.04 },
            tooltip: {
              callbacks: {
                title: c2 => { const it = c2[0].dataset._its ? c2[0].dataset._its[c2[0].dataIndex] : null; return it ? '#' + it.rank + ' ' + nombreLargo(it, dim) : 'Resto de la línea'; },
                label: c2 => {
                  const x = c2.dataset._its ? c2.dataset._its[c2.dataIndex] : c2.dataset._restos[c2.dataIndex];
                  return c2.label + ': ' + pct1(x.pct) + ' · MM$ ' + mm1(x.m);
                },
              },
            },
          },
          scales: { x: { stacked: true, grid: { display: false }, ticks: { color: TXT } }, y: ejePct() },
          onClick: (e, el, ch) => {
            if (!el.length) return;
            const s = ch.data.datasets[el[0].datasetIndex];
            const it = s._its && s._its[el[0].index];
            if (it) abrir(dim, it.id, s._linea);
          },
          onHover: (e, el) => { e.native.target.style.cursor = el.length && e.chart.data.datasets[el[0].datasetIndex]._its ? 'pointer' : 'default'; },
        },
      });
    });
    c.querySelectorAll('.an-mini-cab').forEach(b => b.addEventListener('click', () => VS.fijarFiltros({ linea: Number(b.dataset.linea) })));
    datos.desc = { titulo: 'Todas las líneas — top ' + n + ' ' + dimTxt[dim], csv: () => filasCsvTop(grupos, av, n, dim) };
  }

  /** 3 · Concentración (curva de Pareto). */
  function pintarPareto(filas, lineas, nombreL, av) {
    const dim = st.dim;
    const res = R.calcular(M, filas, dim, lineas);
    $('an-pareto').querySelector('h2').textContent = '3 · Concentración (Pareto) — ' + dimTxt[dim] + ' · ' + nombreL;
    $('an-pareto').querySelector('.an-sub').textContent = '% acumulado de ' + baseTxt(dim) +
      (lineas.length > 1 ? ' (las 8 líneas juntas)' : '') + ' vs. n.º de ítems ordenados de mayor a menor venta.';
    const curvas = {};
    av.forEach(a => { curvas[a] = R.pareto(res, a); });
    let ind = '<div class="an-ind">';
    av.forEach(a => {
      const p = curvas[a];
      ind += '<div class="an-ind-a"><b style="border-color:' + COL_ANIO[a] + '">' + a + '</b>' +
        '<span>Top 5 = <strong>' + pct0(R.concentracion(res, a, 5)) + '</strong></span>' +
        '<span>Top 10 = <strong>' + pct0(R.concentracion(res, a, 10)) + '</strong></span>' +
        '<span>80% de la venta: <strong>' + (p.n80 === null ? 'no se alcanza' : VS.num(p.n80, 0) + (p.n80 === 1 ? ' ítem' : ' ítems')) +
        '</strong> de ' + VS.num(p.n, 0) + '</span></div>';
    });
    ind += '</div>';
    const c = cuerpo('pareto');
    c.innerHTML = ind + '<div class="an-lienzo pareto"><canvas></canvas></div>';
    const maxN = Math.max(1, ...av.map(a => curvas[a].n));
    const maxY = Math.max(1, ...av.map(a => Math.max(...curvas[a].puntos.map(p => p.y))));
    const ds = av.map(a => ({ label: String(a), data: curvas[a].puntos, borderColor: COL_ANIO[a], backgroundColor: COL_ANIO[a],
                              borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 }));
    ds.push({ label: '80%', data: [{ x: 0, y: 0.8 }, { x: maxN, y: 0.8 }], borderColor: '#9aa1ab', borderDash: [4, 4], borderWidth: 1,
              pointRadius: 0, pointHoverRadius: 0, _ref: true });
    nuevoChart(c.querySelector('canvas'), {
      type: 'line',
      data: { datasets: ds },
      options: {
        parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', onClick: null, labels: { color: TXT, filter: l => true } },
          tooltip: {
            filter: t => !t.dataset._ref,
            callbacks: {
              title: () => '',
              label: t => t.dataset.label + ': top ' + VS.num(t.parsed.x, 0) + ' = ' + pct1(t.parsed.y),
            },
          },
        },
        scales: {
          x: { type: 'linear', min: 0, max: maxN, grid: { color: GRILLA }, border: { display: false },
               title: { display: true, text: 'N.º de ítems (de mayor a menor venta)', color: MUT },
               ticks: { precision: 0, callback: v => VS.num(v, 0) } },
          y: { min: 0, max: Math.min(1.2, Math.ceil(maxY * 10) / 10), grid: { color: GRILLA }, border: { display: false },
               ticks: { stepSize: 0.1, callback: v => pct0(v) } },
        },
      },
    });
    datos.pareto = {
      titulo: 'Concentración ' + dimTxt[dim] + ' ' + nombreL,
      csv: () => {
        const out = [];
        av.forEach(a => res.anios[a].lista.forEach((it, i) => out.push({ a: a, k: i + 1, nombre: nombreLargo(it, dim), m: it.m, pct: it.pct, acum: curvas[a].puntos[i + 1].y })));
        return { cols: [{ t: 'Año', v: f => f.a }, { t: 'Posición', v: f => f.k }, { t: dimTxt[dim], v: f => f.nombre },
                        { t: 'Monto (CLP)', v: f => f.m }, { t: '%', v: f => f.pct * 100 }, { t: '% acumulado', v: f => f.acum * 100 }], filas: out };
      },
    };
  }

  /** 4 · Variación 2025 → 2026 (mayores alzas y bajas en MM$). */
  function pintarVariacion(filas, lineas, nombreL, av) {
    const dim = st.dim;
    $('an-var').querySelector('h2').textContent = '4 · Variación ' + M.anios[0] + ' → ' + M.anios[M.anios.length - 1] + ' — ' + dimTxt[dim] + ' · ' + nombreL;
    const c = cuerpo('var');
    if (M.anios.length < 2 || av.length < 2) {
      c.innerHTML = '<p class="an-vacio">Para ver la variación elige «Todos» en el filtro de año.</p>';
      datos.var = null;
      return;
    }
    const a0 = M.anios[0], a1 = M.anios[M.anios.length - 1];
    const res = R.calcular(M, filas, dim, lineas);
    const v = R.variacion(res, a0, a1, 10);
    const barras = v.alzas.concat(v.bajas.slice().reverse());
    $('an-var').querySelector('.an-sub').textContent = 'Los ' + v.alzas.length + ' ítems con mayor alza y los ' + v.bajas.length +
      ' con mayor baja, en MM$ (' + (esTangible(dim) ? 'productos tangibles' : 'total facturado') + '). ' + a1 + ' es parcial: se compara contra ' + a0 + ' completo.';
    if (!barras.length) { c.innerHTML = '<p class="an-vacio">No hay variaciones con los filtros actuales.</p>'; datos.var = null; return; }
    c.innerHTML = '<div class="an-lienzo" style="height:' + (barras.length * 24 + 50) + 'px"><canvas></canvas></div>';
    nuevoChart(c.querySelector('canvas'), {
      type: 'bar',
      data: {
        labels: barras.map(b => nombreCorto(b, dim)),
        datasets: [{ data: barras.map(b => b.d / 1e6), backgroundColor: barras.map(b => (b.d > 0 ? ALZA : BAJA)), borderRadius: 3, _b: barras }],
      },
      plugins: [pluginValores],
      options: {
        indexAxis: 'y',
        datasets: { bar: { categoryPercentage: 0.8, barPercentage: 0.9 } },
        plugins: {
          legend: { display: false },
          anValores: { on: true },
          tooltip: {
            callbacks: {
              title: t => nombreLargo(t[0].dataset._b[t[0].dataIndex], dim),
              label: t => {
                const b = t.dataset._b[t.dataIndex];
                return [a0 + ': MM$ ' + mm1(b.m0), a1 + ' (parcial): MM$ ' + mm1(b.m1), 'Variación: ' + VS.conSigno(b.d, mm1(b.d)) + ' MM$'];
              },
            },
          },
        },
        scales: {
          x: { grace: '18%', grid: { color: GRILLA }, border: { display: false }, title: { display: true, text: 'Variación (MM$)', color: MUT },
               ticks: { callback: x => VS.num(x, 0) } },
          y: { grid: { display: false }, ticks: { color: TXT, autoSkip: false } },
        },
        onClick: (e, el, ch) => { if (el.length) { const b = ch.data.datasets[0]._b[el[0].index]; abrir(dim, b.id, lineas.length === 1 ? lineas[0] : null); } },
        onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
      },
    });
    datos.var = {
      titulo: 'Variación ' + dimTxt[dim] + ' ' + nombreL,
      csv: () => ({
        cols: [{ t: dimTxt[dim], v: b => nombreLargo(b, dim) }, { t: 'Monto ' + a0 + ' (CLP)', v: b => b.m0 },
               { t: 'Monto ' + a1 + ' parcial (CLP)', v: b => b.m1 }, { t: 'Variación (CLP)', v: b => b.d }],
        filas: barras,
      }),
    };
  }

  /** 5 · Mix por línea: peso de cada línea y split producto / servicios / arriendos / glosas. */
  function pintarMix(filas, av) {
    const mx = R.mix(M, filas);
    const c = cuerpo('mix');
    const alto2 = mx.grupos.length * av.length * 22 + 90;
    c.innerHTML = '<div class="an-dos an-mix"><div class="an-lienzo" style="height:' + Math.max(260, 70 * av.length + 170) + 'px" data-rotulo="Peso de cada línea en el total facturado"><canvas data-g="peso"></canvas></div>' +
      '<div class="an-lienzo" style="height:' + alto2 + 'px" data-rotulo="Composición de la venta de cada línea"><canvas data-g="split"></canvas></div></div>';
    const col = (g, i) => (g.id === 'otras' ? GRIS_OTRAS : CATEG[i % CATEG.length]);
    // (a) peso de cada línea
    nuevoChart(c.querySelector('canvas[data-g="peso"]'), {
      type: 'bar',
      data: {
        labels: av.map(String),
        datasets: mx.grupos.map((g, i) => ({ label: g.nombre, data: av.map(a => (mx.total[a] ? g.total[a] / mx.total[a] : 0)), backgroundColor: col(g, i),
                                              borderColor: '#fff', borderWidth: 1, _g: g })),
      },
      plugins: [pluginEtiquetas],
      options: {
        indexAxis: 'y',
        datasets: { bar: { categoryPercentage: 0.75, barPercentage: 1 } },
        plugins: {
          title: { display: true, text: 'Peso de cada línea en el total facturado', color: TXT, font: { size: 13, weight: 'normal' } },
          legend: { position: 'top', align: 'start', onClick: null, labels: { color: TXT, padding: 6 } },
          anEtiquetas: { min: 0.04 },
          tooltip: { callbacks: { label: t => t.dataset.label + (t.dataset._g.detalle ? ' (' + t.dataset._g.detalle + ')' : '') + ': ' + pct1(t.raw) + ' · MM$ ' + mm1(t.dataset._g.total[av[t.dataIndex]]) } },
        },
        scales: { x: Object.assign(ejePct(), { stacked: true }), y: { stacked: true, grid: { display: false }, ticks: { color: TXT } } },
        onClick: (e, el, ch) => { if (el.length) { const g = ch.data.datasets[el[0].datasetIndex]._g; if (g.id !== 'otras') VS.fijarFiltros({ linea: g.id }); } },
        onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
      },
    });
    // (b) composición de cada línea
    const filasB = [];
    mx.grupos.forEach(g => av.forEach(a => filasB.push({ g: g, a: a })));
    let minX = 0, maxX = 1;
    filasB.forEach(f => {
      const t = f.g.total[f.a];
      if (!t) return;
      let pos = 0, neg = 0;
      mx.categorias.forEach(k => { const p = f.g.cat[f.a][k] / t; if (p > 0) pos += p; else neg += p; });
      maxX = Math.max(maxX, pos); minX = Math.min(minX, neg);
    });
    nuevoChart(c.querySelector('canvas[data-g="split"]'), {
      type: 'bar',
      data: {
        labels: filasB.map(f => f.g.nombre + ' · ' + f.a),
        datasets: mx.categorias.map((k, i) => ({
          label: CATS[k], data: filasB.map(f => (f.g.total[f.a] ? f.g.cat[f.a][k] / f.g.total[f.a] : 0)),
          backgroundColor: CATEG[i], borderColor: '#fff', borderWidth: 1, _k: k,
        })),
      },
      plugins: [pluginEtiquetas],
      options: {
        indexAxis: 'y',
        datasets: { bar: { categoryPercentage: 0.85, barPercentage: 1 } },
        plugins: {
          title: { display: true, text: 'Composición de la venta de cada línea', color: TXT, font: { size: 13, weight: 'normal' } },
          legend: { position: 'top', align: 'start', onClick: null, labels: { color: TXT, padding: 6 } },
          anEtiquetas: { min: 0.06 },
          tooltip: { callbacks: { label: t => { const f = filasB[t.dataIndex]; return t.dataset.label + ': ' + pct1(t.raw) + ' · MM$ ' + mm1(f.g.cat[f.a][t.dataset._k]); } } },
        },
        scales: {
          x: { stacked: true, min: Math.floor(minX * 10) / 10, max: Math.ceil(maxX * 10) / 10, grid: { color: GRILLA }, border: { display: false },
               ticks: { stepSize: 0.1, callback: v => pct0(v) } },
          y: { stacked: true, grid: { display: false }, ticks: { color: TXT, autoSkip: false, font: { size: 10.5 } } },
        },
      },
    });
    datos.mix = {
      titulo: 'Mix por línea',
      csv: () => ({
        cols: [{ t: 'Línea', v: f => f.g.nombre + (f.g.detalle ? ' (' + f.g.detalle + ')' : '') }, { t: 'Año', v: f => f.a },
               { t: 'Total facturado (CLP)', v: f => f.g.total[f.a] }, { t: '% del total', v: f => (mx.total[f.a] ? f.g.total[f.a] / mx.total[f.a] * 100 : 0) }]
          .concat(mx.categorias.map(k => ({ t: CATS[k] + ' (CLP)', v: f => f.g.cat[f.a][k] })))
          .concat(mx.categorias.map(k => ({ t: CATS[k] + ' (% de la línea)', v: f => (f.g.total[f.a] ? f.g.cat[f.a][k] / f.g.total[f.a] * 100 : 0) }))),
        filas: filasB,
      }),
    };
  }

  /** 6 · Resumen de concentración por línea (tabla). */
  function pintarConcentracion(filas, av) {
    const rc = R.resumenConcentracion(M, filas);
    const dims = [['sku', 'SKU'], ['familia', 'Familias'], ['cliente', 'Clientes']];
    let h = '<div class="an-tabla-wrap"><table class="an-t an-conc"><thead><tr><th rowspan="2">Línea</th>' +
      dims.map(d => '<th colspan="' + (2 * av.length) + '" class="grp">' + d[1] + '</th>').join('') + '</tr><tr>' +
      dims.map(() => [5, 10].map(n => av.map(a => '<th class="num">Top ' + n + ' ' + a + '</th>').join('')).join('')).join('') + '</tr></thead><tbody>';
    rc.forEach(f => {
      h += '<tr><td><button type="button" class="enlace" data-linea="' + f.linea + '">' + esc(f.nombre) + '</button></td>' +
        dims.map(d => [5, 10].map(n => av.map(a => '<td class="num">' + pct1(f[d[0]][a][n]) + '</td>').join('')).join('')).join('') + '</tr>';
    });
    h += '</tbody></table></div>';
    const c = cuerpo('conc');
    c.innerHTML = h;
    c.querySelectorAll('button[data-linea]').forEach(b => b.addEventListener('click', () => VS.fijarFiltros({ linea: Number(b.dataset.linea) })));
    datos.conc = {
      titulo: 'Resumen de concentración',
      csv: () => {
        const cols = [{ t: 'Línea', v: f => f.nombre }];
        dims.forEach(d => [5, 10].forEach(n => av.forEach(a => cols.push({ t: d[1] + ' top ' + n + ' ' + a + ' (%)', v: f => f[d[0]][a][n] * 100 }))));
        return { cols: cols, filas: rc };
      },
    };
  }

  // ── PNG y CSV ───────────────────────────────────────────────────────
  function descargarPng(id) {
    const card = $('an-' + id);
    const cvs = Array.from(card.querySelectorAll('.an-cuerpo canvas'));
    if (!cvs.length) return;
    const ratio = cvs[0].width / cvs[0].getBoundingClientRect().width || 1;
    const rot = 18, cabH = 30;
    const cajas = cvs.map(cv => {
      const r = cv.getBoundingClientRect(), cont = cv.parentElement;
      return { cv: cv, r: r, rotulo: cont.dataset.rotulo && !cont.dataset.rotulo.startsWith('Peso') && !cont.dataset.rotulo.startsWith('Compos') ? cont.dataset.rotulo : '' };
    });
    const x0 = Math.min(...cajas.map(c => c.r.left)), y0 = Math.min(...cajas.map(c => c.r.top));
    const x1 = Math.max(...cajas.map(c => c.r.right)), y1 = Math.max(...cajas.map(c => c.r.bottom));
    const conRot = cajas.some(c => c.rotulo);
    const out = document.createElement('canvas');
    out.width = Math.round((x1 - x0 + 24) * ratio);
    out.height = Math.round((y1 - y0 + cabH + (conRot ? rot : 0) + 16) * ratio);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.scale(ratio, ratio);
    const fam = getComputedStyle(document.body).fontFamily;
    ctx.fillStyle = TXT;
    ctx.font = '600 14px ' + fam;
    ctx.fillText(card.querySelector('h2').textContent, 12, 20);
    cajas.forEach(c => {
      const x = c.r.left - x0 + 12, y = c.r.top - y0 + cabH + (conRot ? rot : 0);
      if (c.rotulo) { ctx.font = '600 11px ' + fam; ctx.fillStyle = TXT; ctx.fillText(c.rotulo, x + 4, y - 6); }
      ctx.drawImage(c.cv, x, y, c.r.width, c.r.height);
    });
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = nombreArchivo(datos[id] ? datos[id].titulo : id) + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  const nombreArchivo = t => ('analisis_' + t + '_' + (M.meta.corte || '')).replace(/[^\p{L}\p{N}.-]+/gu, '_');

  function descargarCsv(id) {
    if (!datos[id]) return;
    const d = datos[id].csv();
    VS.descargarCsv(nombreArchivo(datos[id].titulo) + '.csv', d.cols, d.filas);
  }

  // ── Controles ───────────────────────────────────────────────────────
  function guardar() {
    try { sessionStorage.setItem('vsku_an', JSON.stringify({ dim: st.dim, top: st.top })); } catch (e) { /* sin almacenamiento */ }
  }

  function pintarControles(est, lineaSel) {
    $('an-linea').value = lineaSel === null ? '' : String(lineaSel);
    document.querySelectorAll('#an-dim button').forEach(b => b.classList.toggle('on', b.dataset.dim === st.dim));
    document.querySelectorAll('#an-top button').forEach(b => b.classList.toggle('on', Number(b.dataset.top) === st.top));
  }

  function iniciar(modelo) {
    M = modelo;
    info = R.anotar(M);
    try {
      const g = JSON.parse(sessionStorage.getItem('vsku_an') || '{}');
      if (R.DIMS[g.dim]) st.dim = g.dim;
      if (g.top === 5 || g.top === 10) st.top = g.top;
    } catch (e) { /* sin almacenamiento */ }
    const v = $('vista-analisis');
    v.innerHTML =
      '<div class="an-controles">' +
      '<label class="an-ctl">Línea <select id="an-linea"><option value="">Todas (8 líneas)</option>' +
      info.lineas.map(l => '<option value="' + l + '">' + esc(M.dic.linea[l]) + '</option>').join('') + '</select></label>' +
      '<div class="an-ctl">Dimensión <div class="seg" id="an-dim" role="group" aria-label="Dimensión">' +
      ['sku', 'familia', 'cliente', 'marca'].map(d => '<button type="button" data-dim="' + d + '">' + R.DIMS[d].nombre + '</button>').join('') + '</div></div>' +
      '<div class="an-ctl">Top <div class="seg" id="an-top" role="group" aria-label="Top"><button type="button" data-top="5">5</button><button type="button" data-top="10">10</button></div></div>' +
      '</div><div class="an-aviso" id="an-aviso" hidden></div><div class="an-aviso" id="an-error" hidden></div>' +
      tarjeta('desc', '1 · Descomposición del top', ' ', true, true) +
      tarjeta('pareto', '3 · Concentración (Pareto)', ' ', true, true) +
      tarjeta('var', '4 · Variación', ' ', true, true) +
      tarjeta('mix', '5 · Mix por línea', 'Peso de cada línea en el total facturado (todas las líneas; «Otras líneas» = ' + R.LINEAS_FUERA.join(', ') +
              ') y, por línea, el split producto tangible / servicios y convenios / arriendos / glosas sin detalle. Clic en una línea para verla.', true, true) +
      tarjeta('conc', '6 · Resumen de concentración por línea', '% que concentra el top 5 y el top 10. SKU y familias: sobre la venta de productos tangibles de la línea; clientes: sobre el total facturado de la línea.', false, true) +
      '<div class="nota an-notas" id="an-notas"></div>';

    $('an-linea').addEventListener('change', e => VS.fijarFiltros({ linea: e.target.value === '' ? null : Number(e.target.value) }));
    $('an-dim').addEventListener('click', e => {
      const b = e.target.closest('button[data-dim]');
      if (!b || b.dataset.dim === st.dim) return;
      st.dim = b.dataset.dim; guardar(); render(null, VS.estado);
    });
    $('an-top').addEventListener('click', e => {
      const b = e.target.closest('button[data-top]');
      if (!b || Number(b.dataset.top) === st.top) return;
      st.top = Number(b.dataset.top); guardar(); render(null, VS.estado);
    });
    v.addEventListener('click', e => {
      const p = e.target.closest('button[data-png]');
      if (p) { descargarPng(p.dataset.png); return; }
      const c = e.target.closest('button[data-csv]');
      if (c) descargarCsv(c.dataset.csv);
    });
  }

  async function render(_filas, est) {
    const mio = ++turno;
    const lineaSel = info.lineas.indexOf(est.linea) !== -1 ? est.linea : null;
    const av = est.anio ? [est.anio] : M.anios;
    pintarControles(est, lineaSel);
    const filas = filasAnalisis(est);
    const avisos = [];
    const f = filtrosActivos(est);
    if (f.length) avisos.push('Filtros globales activos (' + f.join(', ') + '): las cifras se calculan sobre lo filtrado y no corresponden a las láminas.');
    if (est.linea !== null && lineaSel === null) avisos.push('La línea «' + M.dic.linea[est.linea] + '» no está en el análisis (quedan fuera ' + R.LINEAS_FUERA.join(', ') + '); se muestran las 8 líneas.');
    $('an-aviso').hidden = !avisos.length;
    $('an-aviso').innerHTML = avisos.map(esc).join('<br>');
    const ult = M.anios[M.anios.length - 1];
    $('an-notas').innerHTML =
      '<b>Criterios (iguales a las láminas Top por línea v2/v3):</b> ' +
      '<b>SKU, familias y marcas</b>: solo productos tangibles (excluye glosas sin detalle, servicios, convenios, arriendos, SKU de servicio y «0», y familias «Servicio…», «Convenio…», «Glosa…»); % sobre la venta de productos tangibles de la línea y año. ' +
      '<b>Clientes</b>: total facturado neto en la línea (productos, servicios, convenios, arriendos y glosas), ISM incluido; % sobre el total facturado de la línea y año; los clientes con neto negativo no entran al top. ' +
      'Cada año tiene su propio ranking. «Todas» = las 8 líneas (sin ' + R.LINEAS_FUERA.join(', ') + '). ' +
      'Valores netos de notas de crédito. <b>' + ult + ' es parcial</b>: datos al ' + VS.fecha(M.meta.corte) + '. Montos en MM$ (millones de pesos).';

    try {
      await cargarChart();
      $('an-error').hidden = true;
    } catch (e) {
      $('an-error').hidden = false;
      $('an-error').textContent = e.message + ' Revisa la conexión a internet y vuelve a abrir la pestaña.';
      return;
    }
    if (mio !== turno) return;            // llegó otro render mientras cargaba la librería
    destruir();
    const lineas = lineaSel === null ? info.lineas : [lineaSel];
    const nombreL = lineaSel === null ? 'Todas las líneas' : M.dic.linea[lineaSel];
    if (lineaSel === null) pintarGrilla(filas, av); else pintarDescomposicion(filas, lineaSel, av);
    pintarPareto(filas, lineas, nombreL, av);
    pintarVariacion(filas, lineas, nombreL, av);
    pintarMix(filas, av);
    pintarConcentracion(filas, av);
  }

  return { iniciar: iniciar, render: render };
})(window.VS);
