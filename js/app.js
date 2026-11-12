/* Arranque del panel: pestañas, filtros globales e indicadores (los comparten todas las vistas). */
(function (VS) {
  'use strict';

  const $ = id => document.getElementById(id);

  // Filtros por dimensión: id del <select>, campo de la fila y diccionario.
  const DIMS = [
    { id: 'linea', campo: 'l', dic: 'linea', todas: 'Todas las líneas' },
    { id: 'familia', campo: 'f', dic: 'familia', todas: 'Todas las familias' },
    { id: 'marca', campo: 'k', dic: 'marca', todas: 'Todas las marcas' },
    { id: 'origen', campo: 'o', dic: 'origen', todas: 'Todos los orígenes' },
  ];
  const VISTAS = { explorador: VS.explorador, cliente: VS.cliente, resumen: VS.resumen };

  // Los filtros guardan índices de diccionario (null = sin filtro).
  const est = VS.estado = { q: '', terminos: [], anio: 0, linea: null, familia: null, marca: null,
                            origen: null, cliente: null, glosas: true };
  let M = null;
  let cliIdx = null;  // nombre normalizado → índice de cliente
  let vista = 'explorador';

  VS.hayFiltros = () => est.terminos.length > 0 || est.anio !== 0 || est.cliente !== null || !est.glosas ||
                        DIMS.some(d => est[d.id] !== null);

  /**
   * Una sola pasada: junta las filas que pasan todos los filtros y, para cada
   * dimensión, los valores disponibles dados los demás filtros (para las listas).
   * Las glosas sin detalle no tienen marca: un filtro de marca las deja fuera.
   */
  function filtrar() {
    const disp = { linea: new Set(), familia: new Set(), marca: new Set(), origen: new Set(), cliente: new Set() };
    const sumar = (dim, r) => {
      if (dim === 'cliente') disp.cliente.add(r.c);
      else if (dim === 'marca') { if (!r.g) disp.marca.add(r.k); }
      else if (dim === 'linea') disp.linea.add(r.l);
      else if (dim === 'familia') disp.familia.add(r.f);
      else disp.origen.add(r.o);
    };
    const dims = Object.keys(disp);
    const out = [];
    const T = est.terminos;
    filas: for (const r of M.filas) {
      if (est.anio && r.a !== est.anio) continue;
      if (r.g && !est.glosas) continue;
      for (let i = 0; i < T.length; i++) if (r.x.indexOf(T[i]) === -1) continue filas;
      let falla = null, n = 0;
      if (est.linea !== null && r.l !== est.linea) { falla = 'linea'; n++; }
      if (est.familia !== null && r.f !== est.familia) { falla = 'familia'; n++; }
      if (est.marca !== null && (r.g || r.k !== est.marca)) { falla = 'marca'; n++; }
      if (est.origen !== null && r.o !== est.origen) { falla = 'origen'; n++; }
      if (est.cliente !== null && r.c !== est.cliente) { falla = 'cliente'; n++; }
      if (n > 1) continue;
      if (n === 1) { sumar(falla, r); continue; }
      out.push(r);
      for (let i = 0; i < dims.length; i++) sumar(dims[i], r);
    }
    return { filas: out, disp: disp };
  }

  function opciones(set, dic) {
    return Array.from(set).map(i => ({ i: i, n: dic[i] })).sort((a, b) => VS.cmpTxt(a.n, b.n));
  }

  function pintarFiltros(disp, origenCambio) {
    DIMS.forEach(d => {
      if (est[d.id] !== null) disp[d.id].add(est[d.id]);
      const sel = $('f-' + d.id);
      sel.innerHTML = '<option value="">' + d.todas + '</option>' +
        opciones(disp[d.id], M.dic[d.dic]).map(o => '<option value="' + o.i + '">' + VS.esc(o.n || '(vacío)') + '</option>').join('');
      sel.value = est[d.id] === null ? '' : String(est[d.id]);
      sel.classList.toggle('activo', est[d.id] !== null);
    });
    // Mientras se escribe en el cliente no se toca su lista (se cerraría el desplegable).
    if (origenCambio !== 'cliente') {
      $('lista-clientes').innerHTML = opciones(disp.cliente, M.dic.cliente).map(o => '<option value="' + VS.esc(o.n) + '">').join('');
    }
    const inCli = $('f-cliente');
    const escrito = inCli.value.trim() !== '';
    inCli.classList.toggle('activo', est.cliente !== null);
    inCli.classList.toggle('pendiente', escrito && est.cliente === null);
    $('cli-ayuda').hidden = !(escrito && est.cliente === null);
    $('cli-x').hidden = !escrito;

    document.querySelectorAll('#f-anio button').forEach(b => b.classList.toggle('on', Number(b.dataset.anio) === est.anio));
    $('f-glosas').checked = est.glosas;
    $('btn-limpiar').disabled = !VS.hayFiltros();
    const n = DIMS.filter(d => est[d.id] !== null).length + (est.cliente !== null ? 1 : 0) + (est.anio ? 1 : 0) + (est.glosas ? 0 : 1);
    $('btn-filtros').textContent = 'Filtros' + (n ? ' (' + n + ')' : '');
  }

  /** Indicadores de lo filtrado. Sin filtros deben coincidir con los totales de control. */
  function pintarKpis(filas, av) {
    const tot = av.map(() => ({ m: new VS.Suma(), u: new VS.Suma(), g: new VS.Suma() }));
    const clientes = new Set(), skus = new Set();
    let hayGlosa = false;
    for (const r of filas) {
      const t = tot[av.indexOf(r.a)];
      t.m.mas(r.m); t.u.mas(r.u);
      clientes.add(r.c);
      if (r.g) { t.g.mas(r.m); hayGlosa = true; } else skus.add(r.key);
    }
    const tile = (rot, val, sub) =>
      '<div class="kpi"><div class="kpi-rot">' + rot + '</div><div class="kpi-val">' + val + '</div>' +
      '<div class="kpi-sub">' + (sub || '&nbsp;') + '</div></div>';
    let h = '';
    av.forEach((a, n) => {
      let sub = '';
      if (!est.glosas) sub = 'No incluye glosas sin detalle';
      else if (hayGlosa) sub = 'Incluye glosas sin detalle: ' + VS.monto(tot[n].g.valor());
      h += tile('Monto ' + a + ' (' + VS.rotuloMonto() + ')', VS.monto(tot[n].m.valor()), sub);
    });
    av.forEach((a, n) => { h += tile('Unidades ' + a, VS.unid(tot[n].u.valor()), ''); });
    h += tile('SKU con movimiento', VS.num(skus.size, 0), '');
    h += tile('Clientes', VS.num(clientes.size, 0), '');
    $('kpis').innerHTML = h;
  }

  /** Vuelve a filtrar y repinta filtros, indicadores, la vista activa y el detalle abierto. */
  function aplicar(origenCambio) {
    const r = filtrar();
    const av = est.anio ? [est.anio] : M.anios;
    pintarFiltros(r.disp, origenCambio);
    pintarKpis(r.filas, av);
    VISTAS[vista].render(r.filas, est, av, origenCambio === 'vista');
    VS.detalle.actualizar(r.filas, av);
  }

  function mostrarVista(v) {
    vista = v;
    try { sessionStorage.setItem('vsku_vista', v); } catch (e) { /* sin almacenamiento */ }
    document.querySelectorAll('.tabs button').forEach(b => {
      const act = b.dataset.vista === v;
      b.classList.toggle('on', act);
      if (act) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    Object.keys(VISTAS).forEach(k => { $('vista-' + k).hidden = k !== v; });
  }

  /**
   * Cambia filtros desde una vista (p. ej. elegir un cliente o "ver SKU" en el resumen)
   * y, opcionalmente, salta a otra vista. `cambios` usa las claves de VS.estado.
   */
  VS.fijarFiltros = function (cambios, vistaDestino) {
    Object.keys(cambios).forEach(k => { est[k] = cambios[k]; });
    if ('cliente' in cambios) $('f-cliente').value = cambios.cliente === null ? '' : M.dic.cliente[cambios.cliente];
    if (vistaDestino) mostrarVista(vistaDestino);
    aplicar();
    window.scrollTo(0, 0);
  };

  function limpiar() {
    est.q = ''; est.terminos = []; est.anio = 0; est.cliente = null; est.glosas = true;
    DIMS.forEach(d => { est[d.id] = null; });
    $('f-q').value = ''; $('f-cliente').value = '';
    aplicar();
  }

  function conectar() {
    let espera = null;
    $('f-q').addEventListener('input', e => {
      clearTimeout(espera);
      const v = e.target.value;
      espera = setTimeout(() => {
        est.q = v;
        est.terminos = VS.norm(v).split(/\s+/).filter(Boolean);
        aplicar();
      }, 140);
    });
    $('f-anio').addEventListener('click', e => {
      const b = e.target.closest('button[data-anio]');
      if (!b) return;
      est.anio = Number(b.dataset.anio);
      aplicar();
    });
    DIMS.forEach(d => {
      $('f-' + d.id).addEventListener('change', e => {
        est[d.id] = e.target.value === '' ? null : Number(e.target.value);
        aplicar();
      });
    });
    $('f-cliente').addEventListener('input', e => {
      const i = cliIdx.get(VS.norm(e.target.value.trim()));
      est.cliente = i === undefined ? null : i;
      aplicar('cliente');
    });
    $('cli-x').addEventListener('click', () => {
      $('f-cliente').value = ''; est.cliente = null;
      aplicar();
      $('f-cliente').focus();
    });
    $('f-glosas').addEventListener('change', e => { est.glosas = e.target.checked; aplicar(); });
    $('btn-limpiar').addEventListener('click', limpiar);
    $('btn-filtros').addEventListener('click', () => {
      const ab = $('filtros').classList.toggle('abierto');
      $('btn-filtros').setAttribute('aria-expanded', ab ? 'true' : 'false');
    });
    $('seg-monto').addEventListener('click', e => {
      const b = e.target.closest('button[data-mm]');
      if (!b) return;
      VS.enMM = b.dataset.mm === '1';
      document.querySelectorAll('#seg-monto button').forEach(x => x.classList.toggle('on', x === b));
      aplicar('vista');
    });
    document.querySelector('.tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-vista]');
      if (!b || b.dataset.vista === vista) return;
      mostrarVista(b.dataset.vista);
      aplicar('vista');
    });
  }

  async function iniciar() {
    // Sin código validado no se pide ningún dato.
    if (!VS.sesionValida()) { window.location.replace('index.html'); return; }
    $('usuario').textContent = sessionStorage.getItem('vsku_auth_email') || '';
    $('btn-salir').addEventListener('click', VS.cerrarSesion);
    try {
      M = VS.modelo = VS.preparar(await VS.cargarDatos());
    } catch (e) {
      $('estado').textContent = 'No se pudieron cargar los datos. ' + (e && e.message ? e.message : '');
      $('estado').classList.add('error');
      return;
    }

    cliIdx = new Map();
    M.dic.cliente.forEach((n, i) => cliIdx.set(VS.norm(n), i));

    const ult = M.anios[M.anios.length - 1];
    $('corte').textContent = 'Datos al ' + VS.fecha(M.meta.corte) + ' · ' + ult + ' es año parcial';
    $('f-anio').innerHTML = '<button type="button" data-anio="0">Todos</button>' +
      M.anios.map(a => '<button type="button" data-anio="' + a + '">' + a + '</button>').join('');
    $('nota-pie').textContent = 'Valores netos: incluyen notas de crédito (negativos). ' +
      'No se muestran ' + VS.num(M.ocultas, 0) + ' filas de la base con monto 0 y unidades 0; no cambian ningún total. ' +
      'La variación compara ' + ult + ' (parcial, al corte) con el año anterior completo.';

    conectar();
    VS.detalle.iniciar(M);
    Object.keys(VISTAS).forEach(k => VISTAS[k].iniciar(M));
    const guardada = sessionStorage.getItem('vsku_vista');
    mostrarVista(VISTAS[guardada] ? guardada : 'explorador');
    $('estado').hidden = true;
    $('filtros').hidden = false;
    $('contenido').hidden = false;
    aplicar();
    VS.detalle.leerHash();
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})(window.VS);
