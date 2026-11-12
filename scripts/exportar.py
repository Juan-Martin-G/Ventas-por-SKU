#!/usr/bin/env python
"""Exporta la hoja 'Base dinamica' del Excel de Ventas por SKU a data/ventas.json.

Uso:
    python scripts/exportar.py [ruta_excel]

Pasos:
  1. Lee los valores guardados (data_only) de 'Base dinamica', columnas A:L.
  2. Valida: encabezados, filas vacías, errores '#', tipos y montos por año.
     - Montos: deben cuadrar al peso con el reporte que trae el propio Excel
       (hoja 'Ventas por SKU', rótulos "Monto AAAA del reporte" / "Monto AAAA").
       Si no cuadran, se detiene.
     - Unidades: no tienen control fijo. Se muestran junto a la diferencia contra
       la exportación anterior; si cambian, avisa pero no se detiene.
  3. Si todo cuadra, escribe data/ventas.json (el archivo que carga el panel) y
     guarda los totales en scripts/ultima_exportacion.json (local, no se publica).

No corrige ni redondea montos: si algo no cuadra, se detiene y avisa.
"""
import argparse
import datetime as dt
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl

BASE = Path(__file__).resolve().parent.parent
PATRON_EXCEL = "*Ventas*por*SKU*.xlsx"
HOJA_BASE = "Base dinamica"
HOJA_CONTROL = "Ventas por SKU"  # hoja con la fecha de corte y los montos del reporte
ROTULO_CORTE = "Fecha última revisión"  # la fecha está en la celda a su derecha
# Control de montos: el total del reporte está a la derecha de uno de estos rótulos
# (se prueban en orden). Se buscan por el rótulo, nunca por celda fija.
ROTULOS_MONTO = ("Monto {anio} del reporte", "Monto {anio}")
TOLERANCIA_MONTO = 0.5  # pesos: la base y el reporte deben cuadrar al peso
ESTADO = BASE / "scripts" / "ultima_exportacion.json"  # totales de la última exportación (local)
TIPO_GLOSA = "Glosa"  # glosas sin detalle: se identifican solo por el Tipo
TIPO_DETALLE = "Detalle glosa"
PREFIJOS_SKU_GLOSA = ("SERV-GLOSA", "SERV_GLOSA")  # un detalle de glosa no debería traer estos SKU

COLUMNAS = ["Año", "SKU", "Catálogo", "Tipo", "Cliente", "Unidades", "Monto",
            "Origen", "Familia", "Línea", "Descripción", "Marca"]
# nombre de columna -> clave en el JSON (solo columnas de texto, van con diccionario)
TEXTO = {"SKU": "sku", "Catálogo": "catalogo", "Tipo": "tipo", "Cliente": "cliente",
         "Origen": "origen", "Familia": "familia", "Línea": "linea",
         "Descripción": "descripcion", "Marca": "marca"}

ERRORES_EXCEL = {"#N/A", "#N/D", "#VALUE!", "#¡VALOR!", "#REF!", "#¡REF!", "#DIV/0!",
                 "#¡DIV/0!", "#NUM!", "#¡NUM!", "#NAME?", "#¿NOMBRE?", "#NULL!",
                 "#¡NULO!", "#SPILL!", "#¡DESBORDAMIENTO!", "#CALC!", "#¡CALC!",
                 "#FIELD!", "#GETTING_DATA", "#BUSY!", "#BLOCKED!", "#CONNECT!",
                 "#UNKNOWN!"}
SIN_SKU = ("", "0")  # SKU placeholder: se agrupan como 'Sin SKU'


def miles(n, dec=0):
    """Formato chileno: punto de miles, coma decimal."""
    s = f"{n:,.{dec}f}"
    return s.replace(",", "_").replace(".", ",").replace("_", ".")


def vacio(v):
    return v is None or (isinstance(v, str) and v.strip() == "")


def es_numero(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def compacto(x):
    """Entero si no tiene decimales; si no, el valor tal cual (sin redondear)."""
    return int(x) if float(x).is_integer() else x


def texto(v):
    if vacio(v):
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def es_sin_sku(sku):
    return sku in SIN_SKU


def buscar_excel(arg):
    if arg:
        p = Path(arg)
        if not p.is_file():
            sys.exit(f"ERROR: no existe el archivo {p}")
        return p
    cand = sorted(p for p in BASE.glob(PATRON_EXCEL) if not p.name.startswith("~$"))
    if not cand:
        sys.exit(f"ERROR: no hay ningún Excel '{PATRON_EXCEL}' en {BASE}")
    return cand[-1]  # el de prefijo de fecha más reciente


def norm_rotulo(s):
    return " ".join(str(s).split()).lower()


def leer_hoja_control(wb, errores):
    """Bloque superior de la hoja de control, como lista de filas (valores guardados)."""
    if HOJA_CONTROL not in wb.sheetnames:
        errores.append(f"No existe la hoja '{HOJA_CONTROL}' (fecha de corte y control de montos).")
        return []
    return [list(f) for f in wb[HOJA_CONTROL].iter_rows(min_row=1, max_row=200, max_col=40, values_only=True)]


def buscar_rotulo(hoja, rotulo, tipos):
    """Busca celdas con ese rótulo exacto cuya primera celda no vacía a la derecha es del
    tipo pedido. Devuelve [(celda, valor)]; así un encabezado de tabla con el mismo texto no cuenta."""
    objetivo, res = norm_rotulo(rotulo), []
    for i, fila in enumerate(hoja, 1):
        for j, c in enumerate(fila):
            if not (isinstance(c, str) and norm_rotulo(c) == objetivo):
                continue
            for k in range(j + 1, len(fila)):
                w = fila[k]
                if vacio(w):
                    continue
                if isinstance(w, tipos) and not isinstance(w, bool):
                    res.append((f"{openpyxl.utils.get_column_letter(k + 1)}{i}", w))
                break
    return res


def leer_corte(hoja, avisos):
    """Fecha de corte: la fecha a la derecha del rótulo 'Fecha última revisión'."""
    res = buscar_rotulo(hoja, ROTULO_CORTE, (dt.date,))
    if not res:
        avisos.append(f"No se encontró el rótulo '{ROTULO_CORTE}' con una fecha a su derecha en '{HOJA_CONTROL}'.")
        return None
    v = res[0][1]
    return v.date() if isinstance(v, dt.datetime) else v


def leer_control_montos(hoja, anios, errores):
    """Monto del reporte del Excel por año: {año: (monto, celda, rótulo)}. Sin control → error."""
    control = {}
    for a in anios:
        for plantilla in ROTULOS_MONTO:
            rot = plantilla.format(anio=a)
            res = buscar_rotulo(hoja, rot, (int, float))
            if not res:
                continue
            if len({round(v, 2) for _, v in res}) > 1:
                errores.append(f"El rótulo '{rot}' aparece con valores distintos en '{HOJA_CONTROL}': "
                               + ", ".join(f"{c} = {miles(v, 2)}" for c, v in res))
            control[a] = (res[0][1], res[0][0], rot)
            break
        else:
            errores.append(f"No se encontró el control de monto {a} en '{HOJA_CONTROL}' (rótulos probados: "
                           + ", ".join(f"'{p.format(anio=a)}'" for p in ROTULOS_MONTO) + ").")
    return control


def leer_anterior(avisos):
    """Totales de la exportación anterior: el archivo de estado local o, si aún no existe,
    los del data/ventas.json vigente. None si no hay ninguna."""
    try:
        if ESTADO.is_file():
            d = json.loads(ESTADO.read_text(encoding="utf-8"))
            d["fuente"] = ESTADO.name
            return d
        vj = BASE / "data" / "ventas.json"
        if vj.is_file():
            d = json.loads(vj.read_text(encoding="utf-8"))["meta"]
            d["fuente"] = "data/ventas.json"
            return d
    except (OSError, ValueError, KeyError) as e:
        avisos.append(f"No se pudieron leer los totales de la exportación anterior ({e}).")
    return None


def fecha_hora(iso):
    try:
        return f"{dt.datetime.fromisoformat(iso):%d-%m-%Y %H:%M}"
    except (TypeError, ValueError):
        return "fecha desconocida"


def fecha(iso):
    try:
        return f"{dt.date.fromisoformat(iso):%d-%m-%Y}"
    except (TypeError, ValueError):
        return "sin fecha"

def leer_base(wb, errores, avisos):
    if HOJA_BASE not in wb.sheetnames:
        errores.append(f"No existe la hoja '{HOJA_BASE}'.")
        return []
    it = wb[HOJA_BASE].iter_rows(min_row=1, max_col=len(COLUMNAS), values_only=True)
    enc = next(it, None)
    enc = [texto(x) for x in (enc or [])]
    if enc != COLUMNAS:
        errores.append(f"Encabezados distintos a los esperados.\n    Esperado: {COLUMNAS}\n    Leído:    {enc}")
        return []
    crudas = [(n, list(f) + [None] * (len(COLUMNAS) - len(f))) for n, f in enumerate(it, 2)]
    while crudas and all(vacio(x) for x in crudas[-1][1]):
        crudas.pop()  # filas vacías al final del rango: no son parte de la base
    return crudas


def validar(crudas, errores, avisos):
    """Devuelve las filas limpias (dict por fila). Agrega a errores/avisos."""
    filas = []
    vacias, err_hash, raros = [], [], []
    mal_anio, mal_num = [], []
    sin_dato = defaultdict(int)
    for n, f in crudas:
        if all(vacio(x) for x in f):
            vacias.append(n)
            continue
        fila_mala = False
        for nombre, v in zip(COLUMNAS, f):
            if isinstance(v, str) and v.strip().startswith("#"):
                if v.strip().upper() in ERRORES_EXCEL:
                    err_hash.append((n, nombre, v))
                    fila_mala = True
                else:
                    raros.append((n, nombre, v))
        anio, unid, monto = f[0], f[5], f[6]
        if not (es_numero(anio) and float(anio).is_integer() and 2000 <= anio <= 2100):
            mal_anio.append((n, anio))
            fila_mala = True
        for nombre, v in (("Unidades", unid), ("Monto", monto)):
            if not es_numero(v):
                mal_num.append((n, nombre, v))
                fila_mala = True
        if fila_mala:
            continue
        d = {"fila": n, "Año": int(anio), "Unidades": unid, "Monto": monto}
        for nombre in TEXTO:
            v = f[COLUMNAS.index(nombre)]
            if vacio(v) or v == 0:
                sin_dato[nombre] += 1
            d[nombre] = texto(v)
        filas.append(d)

    def muestra(lst):
        return ", ".join(str(x) for x in lst[:8]) + (" …" if len(lst) > 8 else "")

    if vacias:
        errores.append(f"{len(vacias)} fila(s) vacía(s) dentro de la base (filas Excel: {muestra(vacias)}).")
    if err_hash:
        errores.append(f"{len(err_hash)} celda(s) con error de Excel: {muestra(err_hash)}")
    if mal_anio:
        errores.append(f"{len(mal_anio)} fila(s) con Año inválido: {muestra(mal_anio)}")
    if mal_num:
        errores.append(f"{len(mal_num)} celda(s) no numéricas en Unidades/Monto: {muestra(mal_num)}")
    if raros:
        avisos.append(f"{len(raros)} texto(s) que parten con '#' pero no son errores conocidos: {muestra(raros)}")
    for nombre, k in sin_dato.items():
        avisos.append(f"Columna '{nombre}': {k} fila(s) sin dato (vacío o 0).")
    return filas


def agrupar(filas, clave):
    """{valor: {año: [monto, unidades, n_filas]}} con sumas exactas (fsum)."""
    acum = defaultdict(lambda: defaultdict(lambda: ([], [])))
    for d in filas:
        m, u = acum[clave(d)][d["Año"]]
        m.append(d["Monto"])
        u.append(d["Unidades"])
    return {k: {a: (math.fsum(m), math.fsum(u), len(m)) for a, (m, u) in por.items()}
            for k, por in acum.items()}


def tabla(titulo, grupos, anios):
    nombres = sorted(grupos, key=lambda k: -sum(v[0] for v in grupos[k].values()))
    ancho = max([len(titulo), 5] + [len(k or "(vacío)") for k in nombres])
    cab = f"  {titulo:<{ancho}}"
    for a in anios:
        cab += f" {'Monto ' + str(a):>16} {'Unid ' + str(a):>10} {'Filas':>6}"
    print(cab)
    print("  " + "-" * (len(cab) - 2))
    tot = {a: [0.0, 0.0, 0] for a in anios}
    for k in nombres:
        lin = f"  {(k or '(vacío)'):<{ancho}}"
        for a in anios:
            m, u, n = grupos[k].get(a, (0, 0, 0))
            tot[a][0] += m; tot[a][1] += u; tot[a][2] += n
            lin += f" {miles(m):>16} {miles(u, 0 if float(u).is_integer() else 2):>10} {miles(n):>6}"
        print(lin)
    print("  " + "-" * (len(cab) - 2))
    lin = f"  {'TOTAL':<{ancho}}"
    for a in anios:
        m, u, n = tot[a]
        lin += f" {miles(m):>16} {miles(u, 0 if float(u).is_integer() else 2):>10} {miles(n):>6}"
    print(lin)
    print()


def construir_json(filas, corte, excel, totales):
    dic = {k: {} for k in TEXTO.values()}
    cols = {"anio": [], "unidades": [], "monto": []}
    cols.update({k: [] for k in TEXTO.values()})
    for d in filas:
        cols["anio"].append(d["Año"])
        cols["unidades"].append(compacto(d["Unidades"]))
        cols["monto"].append(compacto(d["Monto"]))
        for nombre, k in TEXTO.items():
            cols[k].append(dic[k].setdefault(d[nombre], len(dic[k])))
    listas = {k: list(v) for k, v in dic.items()}
    return {
        "meta": {
            "corte": corte.isoformat() if corte else None,
            "generado": dt.datetime.now().isoformat(timespec="seconds"),
            "archivo": excel.name,
            "filas": len(filas),
            "tipoGlosa": TIPO_GLOSA,
            "totales": {str(a): {"monto": m, "unidades": compacto(u), "filas": n}
                        for a, (m, u, n) in sorted(totales.items())},
        },
        "dic": listas,
        "sinSku": [i for i, s in enumerate(listas["sku"]) if es_sin_sku(s)],
        "filas": cols,
    }


def main():
    for flujo in (sys.stdout, sys.stderr):
        flujo.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("excel", nargs="?", help="ruta del Excel (por defecto, el más reciente de la carpeta)")
    args = ap.parse_args()

    excel = buscar_excel(args.excel)
    errores, avisos = [], []
    wb = openpyxl.load_workbook(excel, data_only=True, read_only=True)
    hoja = leer_hoja_control(wb, errores)
    corte = leer_corte(hoja, avisos) if hoja else None
    crudas = leer_base(wb, errores, avisos)
    wb.close()
    filas = validar(crudas, errores, avisos) if crudas else []
    if not crudas and not errores:
        errores.append("La base no tiene filas (¿se guardó el Excel después de recalcular?).")

    print("=" * 78)
    print("RESUMEN DE VALIDACIÓN – Ventas por SKU")
    print("=" * 78)
    print(f"  Archivo        : {excel.name}")
    print(f"  Modificado     : {dt.datetime.fromtimestamp(excel.stat().st_mtime):%d-%m-%Y %H:%M}")
    print(f"  Fecha de corte : {corte:%d-%m-%Y}" if corte else "  Fecha de corte : (no encontrada)")
    print(f"  Filas leídas   : {miles(len(crudas))}   |   Filas válidas: {miles(len(filas))}")
    print()

    totales = agrupar(filas, lambda d: "total").get("total", {})
    anios = sorted(totales)

    # --- Montos: deben cuadrar al peso con el reporte del propio Excel ----------
    control = leer_control_montos(hoja, anios, errores) if hoja else {}
    print(f"  MONTOS POR AÑO  (control: reporte del Excel, hoja '{HOJA_CONTROL}'; deben cuadrar al peso)")
    print(f"  {'Año':<6} {'Base dinámica':>18} {'Reporte Excel':>18} {'Dif.':>12}   Estado")
    for a in anios:
        m = totales[a][0]
        if a not in control:
            print(f"  {a:<6} {miles(m):>18} {'—':>18} {'—':>12}   SIN CONTROL")
            continue
        cm, celda, rot = control[a]
        dif = m - cm
        ok = abs(dif) < TOLERANCIA_MONTO
        if not ok:
            errores.append(f"Monto {a}: base {miles(m, 2)} vs reporte {miles(cm, 2)} "
                           f"('{rot}', {celda}); diferencia {miles(dif, 2)}.")
        print(f"  {a:<6} {miles(m):>18} {miles(cm):>18} {miles(0 if abs(dif) < 0.005 else dif, 2):>12}   "
              f"{'OK' if ok else 'NO CUADRA'}  ('{rot}', {celda})")
    print()

    # --- Unidades: sin control fijo; se comparan con la exportación anterior -----
    ant = leer_anterior(avisos)
    tot_ant = (ant or {}).get("totales", {})
    print("  UNIDADES POR AÑO  (sin control fijo; se comparan con la exportación anterior)")
    if ant:
        otro_corte = ant.get("corte") != (corte.isoformat() if corte else None)
        print(f"  Exportación anterior: {fecha_hora(ant.get('generado'))} · corte {fecha(ant.get('corte'))}"
              f"{' (corte distinto al actual)' if otro_corte else ''} · {ant.get('archivo', '')} [{ant['fuente']}]")
    else:
        print("  No hay una exportación anterior con la que comparar.")
    print(f"  {'Año':<6} {'Unidades':>12} {'Anterior':>12} {'Dif.':>10} {'Filas':>8} {'Filas ant.':>11}")

    def unid(x):
        return miles(x, 0 if float(x).is_integer() else 2)

    for a in anios:
        _, u, n = totales[a]
        pa = tot_ant.get(str(a))
        if not pa:
            print(f"  {a:<6} {unid(u):>12} {'—':>12} {'—':>10} {miles(n):>8} {'—':>11}")
            continue
        du = u - pa["unidades"]
        cambio = abs(du) > 1e-9
        if cambio:
            avisos.append(f"Unidades {a}: cambiaron de {unid(pa['unidades'])} a {unid(u)} "
                          f"({'+' if du > 0 else ''}{unid(du)}) respecto de la exportación anterior.")
        print(f"  {a:<6} {unid(u):>12} {unid(pa['unidades']):>12} "
              f"{(('+' if du > 0 else '') + unid(du)) if cambio else '0':>10} {miles(n):>8} {miles(pa.get('filas', 0)):>11}")
    print()

    if filas:
        tabla("Línea", agrupar(filas, lambda d: d["Línea"]), anios)
        tabla("Tipo", agrupar(filas, lambda d: d["Tipo"]), anios)
        tabla("Origen", agrupar(filas, lambda d: d["Origen"]), anios)

        # --- Reglas de negocio (solo informar) ------------------------------
        print("  REGLAS DE NEGOCIO")
        glosas = [d for d in filas if d["Tipo"] == TIPO_GLOSA]
        con_unid = [d for d in glosas if d["Unidades"] != 0]
        print(f"  Glosas sin detalle : {miles(len(glosas))} filas, monto "
              + ", ".join(f"{a}: {miles(math.fsum(d['Monto'] for d in glosas if d['Año'] == a))}" for a in anios)
              + f"; con unidades ≠ 0: {len(con_unid)}")
        if con_unid:
            avisos.append(f"{len(con_unid)} glosa(s) sin detalle con unidades distintas de 0 "
                          f"(filas Excel: {', '.join(str(d['fila']) for d in con_unid[:8])}).")
        fam_glosa = sorted({d["Familia"] for d in glosas})
        print(f"    familias: {fam_glosa}")
        # Detalle de glosa que quedó con el SKU genérico de glosa: error del origen (TGlosas).
        det_mal = [d for d in filas if d["Tipo"] == TIPO_DETALLE and d["SKU"].upper().startswith(PREFIJOS_SKU_GLOSA)]
        if det_mal:
            avisos.append(
                f"{len(det_mal)} fila(s) con Tipo = '{TIPO_DETALLE}' cuyo SKU empieza con SERV-GLOSA / SERV_GLOSA "
                f"(SKU: {', '.join(sorted({d['SKU'] for d in det_mal}))}; monto "
                + ", ".join(f"{a}: {miles(math.fsum(d['Monto'] for d in det_mal if d['Año'] == a))}" for a in anios)
                + f"; filas Excel: {', '.join(str(d['fila']) for d in det_mal[:12])}{' …' if len(det_mal) > 12 else ''}). "
                "El panel las muestra como un SKU más: corregir en TGlosas.")
        sin = [d for d in filas if es_sin_sku(d["SKU"])]
        vals = defaultdict(int)
        for d in sin:
            vals[d["SKU"]] += 1
        print(f"  'Sin SKU'          : {miles(len(sin))} filas, monto "
              + ", ".join(f"{a}: {miles(math.fsum(d['Monto'] for d in sin if d['Año'] == a))}" for a in anios))
        for v, k in sorted(vals.items(), key=lambda x: -x[1]):
            print(f"    {v!r}: {k} filas")
        arr = [d for d in filas if d["Origen"].lower() == "arriendo"]
        print(f"  Arriendos          : {miles(len(arr))} filas, {sum(1 for d in arr if d['Unidades'] == 0)} con 0 unidades "
              "(plata en el año de la factura, unidades solo en el año de inicio)")
        neg = [d for d in filas if d["Monto"] < 0]
        print(f"  Montos negativos   : {len(neg)} filas, suma {miles(math.fsum(d['Monto'] for d in neg))}")
        dec = sum(1 for d in filas if not float(d["Monto"]).is_integer())
        decu = sum(1 for d in filas if not float(d["Unidades"]).is_integer())
        print(f"  Con decimales      : {miles(dec)} filas en Monto, {miles(decu)} en Unidades (se exportan tal cual)")
        ceros = sum(1 for d in filas if d["Monto"] == 0 and d["Unidades"] == 0)
        print(f"  Filas en cero      : {miles(ceros)} con monto 0 y unidades 0 (se exportan; el panel las oculta)")
        print(f"  Valores distintos  : " + ", ".join(
            f"{n} {len({d[n] for d in filas})}" for n in ("SKU", "Cliente", "Línea", "Familia", "Marca", "Descripción")))
        print()

    if avisos:
        print("  AVISOS")
        for a in avisos:
            print(f"  - {a}")
        print()
    if errores:
        print("  ERRORES (no se generó ventas.json)")
        for e in errores:
            print(f"  ✗ {e}")
        print("=" * 78)
        sys.exit(1)

    # --- Salida ----------------------------------------------------------------
    salida = construir_json(filas, corte, excel, totales)
    datos = json.dumps(salida, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    destino = BASE / "data"
    destino.mkdir(exist_ok=True)
    (destino / "ventas.json").write_bytes(datos)
    print(f"  RESULTADO: VALIDACIÓN OK")
    ESTADO.write_text(json.dumps(salida["meta"], ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  data/ventas.json : {miles(len(datos) / 1024)} KB (sin cifrar; es el archivo que publica el panel)")
    print(f"  {ESTADO.relative_to(BASE).as_posix()} : totales guardados para comparar en la próxima exportación")
    print("=" * 78)


if __name__ == "__main__":
    main()
