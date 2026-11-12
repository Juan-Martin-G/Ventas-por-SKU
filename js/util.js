/* Utilidades compartidas: formatos (es-CL), comparadores, sumas y exportación CSV. */
window.VS = window.VS || {};
(function (VS) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  VS.esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

  /** Minúsculas y sin tildes, para buscar y comparar. */
  VS.norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Número con punto de miles y coma decimal; `dec` decimales fijos. */
  VS.num = function (x, dec) {
    const s = Math.abs(x).toFixed(dec || 0);
    const p = s.split('.');
    const cuerpo = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (p[1] ? ',' + p[1] : '');
    return (x < 0 && /[1-9]/.test(s) ? '-' : '') + cuerpo;
  };

  /** Vista de montos: false = CLP sin decimales; true = MM (millones, 1 decimal). */
  VS.enMM = false;
  VS.monto = x => (VS.enMM ? VS.num(x / 1e6, 1) : VS.num(x, 0));
  VS.rotuloMonto = () => (VS.enMM ? 'MM$' : '$');

  /** Unidades: enteras salvo que la base traiga fracciones (hasta 2 decimales). */
  VS.unid = function (x) {
    const r = Math.round(x * 100) / 100;
    if (Number.isInteger(r)) return VS.num(r, 0);
    return VS.num(r, Number.isInteger(Math.round(r * 100) / 10) ? 1 : 2);
  };

  /** Antepone "+" a un texto numérico positivo distinto de cero. */
  VS.conSigno = (x, txt) => (x > 0 && /[1-9]/.test(txt) ? '+' : '') + txt;

  /** Variación porcentual; null cuando la base no es positiva (no tiene sentido). */
  VS.varPct = (ant, act) => (ant > 0 ? (act - ant) / ant : null);
  VS.pctTxt = function (p) {
    if (p === null) return '—';
    if (p > 9.995) return '>+999%';
    return VS.conSigno(p, VS.num(p * 100, 1)) + '%';
  };

  /** Clase CSS para valores negativos (según lo que se ve ya redondeado). */
  VS.clsNeg = txt => (txt.charAt(0) === '-' ? ' neg' : '');

  /** Suma compensada (Neumaier): los totales no dependen del orden de las filas. */
  VS.Suma = function () { this.s = 0; this.c = 0; };
  VS.Suma.prototype.mas = function (x) {
    const t = this.s + x;
    this.c += Math.abs(this.s) >= Math.abs(x) ? (this.s - t) + x : (x - t) + this.s;
    this.s = t;
  };
  VS.Suma.prototype.valor = function () { return this.s + this.c; };

  const cmpTxt = new Intl.Collator('es', { numeric: true, sensitivity: 'base' }).compare;
  /** Ordena una copia. `fn(item)` devuelve número o texto; null/undefined van siempre al final. */
  VS.ordenar = function (lista, fn, dir) {
    return lista
      .map(it => ({ it, v: fn(it) }))
      .sort((a, b) => {
        const na = a.v === null || a.v === undefined, nb = b.v === null || b.v === undefined;
        if (na || nb) return na === nb ? 0 : (na ? 1 : -1);
        const c = typeof a.v === 'number' ? a.v - b.v : cmpTxt(a.v, b.v);
        return c * dir;
      })
      .map(o => o.it);
  };
  VS.cmpTxt = cmpTxt;

  /**
   * Descarga un CSV que Excel (configuración regional de Chile) abre directo:
   * UTF-8 con BOM, separador ";", coma decimal.
   * columnas: [{ t: 'Título', v: fila => valor }]
   */
  VS.descargarCsv = function (nombre, columnas, filas) {
    const celda = function (v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('.', ',');
      const s = String(v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lineas = [columnas.map(c => celda(c.t)).join(';')];
    filas.forEach(f => lineas.push(columnas.map(c => celda(c.v(f))).join(';')));
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  /** dd-mm-aaaa a partir de 'aaaa-mm-dd'. */
  VS.fecha = iso => (iso ? iso.split('-').reverse().join('-') : 'sin fecha');
})(window.VS);
