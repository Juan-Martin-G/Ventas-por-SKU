/* Vista 3: Resumen por línea → familia → marca (tabla expandible) con un gráfico de barras por línea. */
window.VS = window.VS || {};
VS.resumen = (function (VS) {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = VS.esc;

  // Un color fijo por año (sigue al año, no a su posición): paleta categórica validada
  // para daltonismo y contraste sobre fondo blanco.
  const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

  let M = null;
  let av = [];
  let lineas = [];                // nodos de nivel 0
  let nodos = new Map();          // id → nodo
  const abiertos = new Set();     // ids de nodos expandidos
  const orden = { col: null, dir: -1 };
  let cols = [];
  let datosGraf = [];

  const ceros = () => M.anios.map(() => 0);
  const color = a => SERIES[M.idxAnio[a] % SERIES.length];

  // ── Árbol ───────────────────────────────────────────────────────────
  function nodo(id, nivel, nombre, ref, extra) {
    const n = Object.assign({ id: id, nivel: nivel, nombre: nombre || '(vacío)', ref: ref, u: ceros(), m: ceros(), hijos: new Map() }, extra);
    nodos.set(id, n);
    return n;
  }

  /** Línea → familia → marca. La glosa sin detalle cuelga de su línea como un nodo aparte, sin marcas. */
  function construir(filas) {
    const D = M.dic, mapa = new Map();
    nodos = new Map();
    for (const r of filas) {
      const i = M.idxAnio[r.a];
      let L = mapa.get(r.l);
      if (!L) { L = nodo('l' + r.l, 0, D.linea[r.l], { linea: r.l }); mapa.set(r.l, L); }
      L.u[i] += r.u; L.m[i] += r.m;
      if (r.g) {
        let G = L.hijos.get('g');
        if (!G) { G = nodo(L.id + '|g', 1, VS.ROTULO_GLOSA, { linea: r.l }, { esGlosa: true, sinUnid: true }); L.hijos.set('g', G); }
        G.m[i] += r.m;
        continue;
      }
      let F = L.hijos.get(r.f);
      if (!F) { F = nodo(L.id + '|f' + r.f, 1, D.familia[r.f], { linea: r.l, familia: r.f }); L.hijos.set(r.f, F); }
      F.u[i] += r.u; F.m[i] += r.m;
      let K = F.hijos.get(r.k);
      if (!K) { K = nodo(F.id + '|k' + r.k, 2, D.marca[r.k], { linea: r.l, familia: r.f, marca: r.k }); F.hijos.set(r.k, K); }
      K.u[i] += r.u; K.m[i] += r.m;
    }
    return Array.from(mapa.values());
  }

  /** Ordena hermanos por la columna activa; la glosa sin detalle queda siempre al final. */
  function ordenar(lista) {
    const c = cols.find(x => x.id === orden.col);
    const fn = orden.col === 'nombre' || !c ? n => n.nombre : c.v;
    return VS.ordenar(lista.filter(n => !n.esGlosa), fn, orden.dir).concat(lista.filter(n => n.esGlosa));
  }

  function visibles(lista, out) {
    ordenar(lista).forEach(n => {
      out.push(n);
      if (n.hijos.size && abiertos.has(n.id)) visibles(Array.from(n.hijos.values()), out);
    });
    return out;
  }

  function filaHtml(n) {
    const hijos = n.hijos.size > 0, ab = abiertos.has(n.id);
    let h = '<tr class="niv' + n.nivel + (n.esGlosa ? ' fila-glosa' : '') + (hijos ? ' con-hijos' : '') + '" data-nodo="' + n.id + '">' +
      '<td class="c-arbol"><div class="arbol" style="padding-left:' + (n.nivel * 20) + 'px">' +
      (hijos ? '<button type="button" class="tog" aria-expanded="' + ab + '" aria-label="' + (ab ? 'Contraer ' : 'Expandir ') + esc(n.nombre) + '"></button>'
             : '<span class="tog"></span>') +
      (n.esGlosa ? '<span class="tag">Aparte</span>' : '') +
      '<span class="arbol-nom" title="' + esc(n.nombre) + '">' + esc(n.nombre) + '</span>' +
      '<button type="button" class="btn-link ver" data-ver="' + n.id + '">' + (n.esGlosa ? 'ver clientes' : 'ver SKU') + '</button></div></td>';
    cols.forEach(c => { h += VS.tdNum(c, n); });
    return h + '</tr>';
  }

  function pintarTabla() {
    const th = (id, t, num, tip) => {
      const act = orden.col === id;
      return '<th' + (num ? ' class="num"' : ' class="c-arbol"') + (act ? ' aria-sort="' + (orden.dir > 0 ? 'ascending' : 'descending') + '"' : '') +
             (tip ? ' title="' + esc(tip) + '"' : '') + '><button type="button" data-col="' + id + '">' + t +
             '<span class="flecha">' + (act ? (orden.dir > 0 ? '▲' : '▼') : '') + '</span></button></th>';
    };
    $('res-tabla').tHead.innerHTML = '<tr>' + th('nombre', 'Línea › Familia › Marca', false) + cols.map(c => th(c.id, esc(c.t), true, c.tip)).join('') + '</tr>';

    let h = visibles(lineas, []).map(filaHtml).join('');
    if (!lineas.length) {
      h = '<tr class="vacia"><td colspan="' + (cols.length + 1) + '">No hay ventas con los filtros actuales.</td></tr>';
    } else {
      const t = { u: ceros(), m: ceros() };
      lineas.forEach(n => M.anios.forEach((a, i) => { t.u[i] += n.u[i]; t.m[i] += n.m[i]; }));
      h += '<tr class="total"><td class="c-arbol">Total</td>' + cols.map(c => VS.tdNum(c, t)).join('') + '</tr>';
    }
    $('res-tabla').tBodies[0].innerHTML = h;
  }

  /** CSV plano al nivel más fino: una fila por línea–familia–marca (y una por glosa sin detalle de cada línea). */
  function exportar() {
    const hojas = [];
    ordenar(lineas).forEach(L => ordenar(Array.from(L.hijos.values())).forEach(F => {
      if (F.esGlosa) hojas.push({ l: L.nombre, f: F.nombre, k: '', n: F });
      else ordenar(Array.from(F.hijos.values())).forEach(K => hojas.push({ l: L.nombre, f: F.nombre, k: K.nombre, n: K }));
    }));
    const c = [{ t: 'Línea', v: h => h.l }, { t: 'Familia', v: h => h.f }, { t: 'Marca', v: h => h.k }];
    av.forEach(a => { const i = M.idxAnio[a]; c.push({ t: 'Unidades ' + a, v: h => (h.n.sinUnid ? null : h.n.u[i]) }); });
    av.forEach(a => { const i = M.idxAnio[a]; c.push({ t: 'Monto ' + a + ' (CLP)', v: h => h.n.m[i] }); });
    VS.descargarCsv('resumen_por_linea_' + (M.meta.corte || '') + '.csv', c, hojas);
  }

  // ── Gráfico: barras horizontales por línea, una barra por año ───────
  function pasoBonito(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  function pintarGrafico() {
    const cont = $('graf');
    const ult = M.idxAnio[av[av.length - 1]];
    datosGraf = VS.ordenar(lineas, n => n.m[ult], -1);
    const vals = [];
    datosGraf.forEach(n => av.forEach(a => vals.push(n.m[M.idxAnio[a]])));
    let lo = Math.min(0, Math.min.apply(null, vals.concat(0))), hi = Math.max(0, Math.max.apply(null, vals.concat(0)));
    if (!datosGraf.length || hi === lo) { cont.hidden = true; return; }
    cont.hidden = false;

    // El eje parte en una marca (para que la grilla calce) y termina justo después del máximo.
    const paso = pasoBonito((hi - lo) / (window.innerWidth < 760 ? 4 : 8));
    lo = Math.floor(lo / paso) * paso; hi = hi + (hi - lo) * 0.03;
    const pos = v => (v - lo) / (hi - lo) * 100, cero = pos(0);
    const dec = paso >= 1e6 ? 0 : (paso >= 1e5 ? 1 : 2);
    const grosor = 9, sep = 2, alto = av.length * grosor + (av.length - 1) * sep;

    let h = '<div class="graf-cab"><h3>' + (av.length === 1 ? 'Monto ' + av[0] + ' por línea' : 'Monto por línea') + ' <span>MM$</span></h3>';
    if (av.length > 1) {
      h += '<div class="leyenda">' + av.map(a => '<span><i style="background:' + color(a) + '"></i>' + a + '</span>').join('') + '</div>';
    }
    h += '</div><div class="graf-cuerpo" style="--paso:' + (paso / (hi - lo) * 100) + '%">';
    datosGraf.forEach((n, k) => {
      h += '<div class="g-fila" tabindex="0" data-g="' + k + '"><div class="g-rot" title="' + esc(n.nombre) + '">' + esc(n.nombre) + '</div>' +
           '<div class="g-pista" style="height:' + alto + 'px">';
      av.forEach((a, j) => {
        const v = n.m[M.idxAnio[a]], p = pos(v);
        if (Math.round(v) === 0) return;
        h += '<i class="g-barra' + (v < 0 ? ' neg' : '') + '" style="left:' + Math.min(p, cero) + '%;width:' + Math.abs(p - cero) + '%;top:' + (j * (grosor + sep)) +
             'px;height:' + grosor + 'px;background:' + color(a) + '"></i>';
      });
      h += '<i class="g-cero" style="left:' + cero + '%"></i></div></div>';
    });
    h += '<div class="g-eje"><div class="g-rot"></div><div class="g-pista">';
    for (let t = lo; t <= hi; t += paso) {
      const p = pos(t), cls = p < 1 ? ' class="ini"' : (p > 99 ? ' class="fin"' : '');
      h += '<span' + cls + ' style="left:' + p + '%">' + VS.num(t / 1e6, dec) + '</span>';
    }
    cont.innerHTML = h + '</div></div></div>';
  }

  function contenidoTip(n) {
    let h = '<b>' + esc(n.nombre) + '</b>';
    av.forEach(a => {
      h += '<div><i style="background:' + color(a) + '"></i>' + a + '<span>' + VS.rotuloMonto() + ' ' + VS.monto(n.m[M.idxAnio[a]]) + '</span></div>';
    });
    if (av.length >= 2) {
      const i = M.idxAnio[av[av.length - 2]], j = M.idxAnio[av[av.length - 1]];
      const p = VS.varPct(n.m[i], n.m[j]);
      h += '<div class="tip-var">Variación<span>' + (p === null ? '—' : VS.pctTxt(p)) + '</span></div>';
    }
    return h;
  }

  function mostrarTip(fila, x, y) {
    const tip = $('tip');
    tip.innerHTML = contenidoTip(datosGraf[Number(fila.dataset.g)]);
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    if (x === null) { const b = fila.getBoundingClientRect(); x = b.left + 160; y = b.bottom - 4; }
    tip.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - r.width - 8)) + 'px';
    tip.style.top = (y + 16 + r.height > window.innerHeight ? Math.max(8, y - r.height - 10) : y + 16) + 'px';
  }

  // ── API de la vista ─────────────────────────────────────────────────
  function iniciar(modelo) {
    M = modelo;

    $('res-tabla').tHead.addEventListener('click', e => {
      const b = e.target.closest('button[data-col]');
      if (!b) return;
      const id = b.dataset.col;
      if (orden.col === id) orden.dir = -orden.dir;
      else { orden.col = id; orden.dir = id === 'nombre' ? 1 : -1; }
      pintarTabla();
    });
    $('res-tabla').tBodies[0].addEventListener('click', e => {
      const ver = e.target.closest('button[data-ver]');
      if (ver) {
        const n = nodos.get(ver.dataset.ver);
        if (n.esGlosa) { VS.fijarFiltros({ linea: n.ref.linea }); VS.detalle.ir(VS.GLOSA); }
        else VS.fijarFiltros(n.ref, 'explorador');   // solo fija lo que define el nodo (línea, familia, marca)
        return;
      }
      const tr = e.target.closest('tr.con-hijos');
      if (!tr || String(window.getSelection())) return;
      const id = tr.dataset.nodo;
      if (abiertos.has(id)) abiertos.delete(id); else abiertos.add(id);
      pintarTabla();
    });
    $('res-expandir').addEventListener('click', () => { nodos.forEach(n => { if (n.hijos.size) abiertos.add(n.id); }); pintarTabla(); });
    $('res-contraer').addEventListener('click', () => { abiertos.clear(); pintarTabla(); });
    $('res-csv').addEventListener('click', exportar);

    const graf = $('graf');
    graf.addEventListener('mousemove', e => {
      const f = e.target.closest('.g-fila');
      if (f) mostrarTip(f, e.clientX, e.clientY); else $('tip').hidden = true;
    });
    graf.addEventListener('mouseleave', () => { $('tip').hidden = true; });
    graf.addEventListener('focusin', e => { const f = e.target.closest('.g-fila'); if (f) mostrarTip(f, null, null); });
    graf.addEventListener('focusout', () => { $('tip').hidden = true; });
    window.addEventListener('scroll', () => { $('tip').hidden = true; }, { passive: true });
  }

  function render(filas, est, aniosVisibles) {
    av = aniosVisibles;
    cols = VS.colsAnios(M, av);
    if (orden.col !== 'nombre' && !cols.some(c => c.id === orden.col)) { orden.col = 'm' + av[av.length - 1]; orden.dir = -1; }
    lineas = construir(filas);
    pintarGrafico();
    pintarTabla();
  }

  return { iniciar: iniciar, render: render };
})(window.VS);
