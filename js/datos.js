/* Datos: sesión, carga de ventas.json y preparación del modelo en memoria. */
window.VS = window.VS || {};
(function (VS) {
  'use strict';

  VS.GLOSA = '__glosa__';     // clave del grupo "Glosa (sin detalle)"
  VS.SIN_SKU = '__sinsku__';  // clave del grupo "Sin SKU"
  VS.ROTULO_GLOSA = 'Glosa (sin detalle)';

  VS.sesionValida = () => sessionStorage.getItem('vsku_auth') === 'true';
  VS.cerrarSesion = function () {
    sessionStorage.removeItem('vsku_auth');
    sessionStorage.removeItem('vsku_auth_email');
    window.location.href = 'index.html';
  };

  /**
   * ÚNICO punto de carga de datos del panel. Nadie más hace fetch de ventas.json.
   * Para endurecer la seguridad (cifrado, backend, etc.) se reemplaza solo esta
   * función: debe devolver el mismo objeto que genera scripts/exportar.py.
   */
  VS.cargarDatos = async function () {
    if (!VS.sesionValida()) throw new Error('Sesión no válida.');
    const r = await fetch('data/ventas.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('No se pudo cargar data/ventas.json (HTTP ' + r.status + ').');
    return r.json();
  };

  /**
   * Convierte el JSON columnar en filas livianas y aplica las reglas de negocio
   * que no dependen de los filtros:
   *  - Glosa sin detalle: Tipo = Glosa → un solo grupo aparte (se ignoran su SKU y descripción).
   *  - Sin SKU: los SKU placeholder (hoy solo "0") → un solo grupo.
   *  - Filas con monto 0 y unidades 0: no se muestran (no cambian ningún total).
   * Campos de fila: a año · s sku · d descripción · t tipo · c cliente · u unidades · m monto
   *                 o origen · f familia · l línea · k marca · g es glosa · key grupo · x texto de búsqueda
   */
  VS.preparar = function (json) {
    const F = json.filas, D = json.dic, n = json.meta.filas;
    const tipoGlosa = D.tipo.indexOf(json.meta.tipoGlosa || 'Glosa');
    const sinSku = new Set(json.sinSku || []);
    const anios = Object.keys(json.meta.totales).map(Number).sort();
    const idxAnio = {};
    anios.forEach((a, i) => { idxAnio[a] = i; });

    const textos = new Map();
    const filas = [];
    let ocultas = 0;
    for (let i = 0; i < n; i++) {
      const u = F.unidades[i], m = F.monto[i];
      if (u === 0 && m === 0) { ocultas++; continue; }
      const g = F.tipo[i] === tipoGlosa;
      const s = F.sku[i], l = F.linea[i];
      const key = g ? VS.GLOSA : (sinSku.has(s) ? VS.SIN_SKU : s);
      const kx = key + '|' + l;
      let x = textos.get(kx);
      if (x === undefined) {
        x = g ? VS.norm(VS.ROTULO_GLOSA + ' ' + D.linea[l])
          : VS.norm([key === VS.SIN_SKU ? 'Sin SKU' : D.sku[s], D.descripcion[F.descripcion[i]],
                     D.familia[F.familia[i]], D.linea[l], D.marca[F.marca[i]]].join(' '));
        textos.set(kx, x);
      }
      filas.push({ a: F.anio[i], s: s, d: F.descripcion[i], t: F.tipo[i], c: F.cliente[i], u: u, m: m,
                   o: F.origen[i], f: F.familia[i], l: l, k: F.marca[i], g: g, key: key, x: x });
    }

    const skuIdx = new Map();
    D.sku.forEach((cod, i) => skuIdx.set(cod, i));

    return {
      meta: json.meta, dic: D, anios: anios, idxAnio: idxAnio,
      filas: filas, ocultas: ocultas, skuIdx: skuIdx,
      origenArriendo: D.origen.indexOf('Arriendo'),
    };
  };

  /**
   * Agrupa filas por SKU. Devuelve Map clave → grupo con u[] y m[] por año (netos)
   * y los textos de familia, línea y marca ("Varias" si el SKU trae más de una).
   * La glosa sin detalle queda como un solo grupo (clave VS.GLOSA), sin unidades ni marca.
   */
  VS.agruparPorSku = function (M, lista) {
    const D = M.dic, mapa = new Map();
    for (const r of lista) {
      let g = mapa.get(r.key);
      if (!g) {
        g = { key: r.key, u: M.anios.map(() => 0), m: M.anios.map(() => 0), f: r.f, l: r.l, k: r.k, fVar: false, lVar: false, kVar: false };
        if (r.key === VS.GLOSA) { g.cod = VS.GLOSA; g.sku = VS.ROTULO_GLOSA; g.desc = 'Facturación por glosa, sin detalle de SKU'; g.sinUnid = true; }
        else if (r.key === VS.SIN_SKU) { g.cod = VS.SIN_SKU; g.sku = 'Sin SKU'; g.desc = 'Ventas sin código de SKU'; }
        else { g.cod = D.sku[r.s]; g.sku = D.sku[r.s]; g.desc = D.descripcion[r.d]; }
        mapa.set(r.key, g);
      }
      const i = M.idxAnio[r.a];
      g.u[i] += r.u; g.m[i] += r.m;
      if (r.f !== g.f) g.fVar = true;
      if (r.l !== g.l) g.lVar = true;
      if (r.k !== g.k) g.kVar = true;
    }
    mapa.forEach(g => {
      const esGlosa = g.key === VS.GLOSA;
      g.fam = esGlosa ? VS.ROTULO_GLOSA : (g.fVar ? 'Varias' : D.familia[g.f]);
      g.lin = g.lVar ? 'Varias' : D.linea[g.l];
      g.mar = esGlosa ? '—' : (g.kVar ? 'Varias' : D.marca[g.k]);
    });
    return mapa;
  };

  /** Desglose por un campo de la fila (c cliente, o origen, l línea): [{ id, nombre, u[], m[] }]. */
  VS.desglose = function (M, lista, campo, dic) {
    const mapa = new Map();
    for (const r of lista) {
      let it = mapa.get(r[campo]);
      if (!it) { it = { id: r[campo], nombre: dic[r[campo]], u: M.anios.map(() => 0), m: M.anios.map(() => 0) }; mapa.set(r[campo], it); }
      const i = M.idxAnio[r.a];
      it.u[i] += r.u; it.m[i] += r.m;
    }
    return Array.from(mapa.values());
  };
})(window.VS);
