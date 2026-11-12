# Panel de Ventas por SKU – GEMCO

## Objetivo
Panel web interactivo para explorar la venta real de GEMCO 2025–2026 por SKU: qué se vendió, cuántas unidades, de qué línea, familia y marca, y a qué cliente. No es un panel de márgenes ni de KPIs: es un **explorador** de ventas.

## Fuente de datos
- Archivo: `AAAAMMDD Ventas por SKU.xlsx` (en esta carpeta; se reemplaza en cada corte de facturación). `exportar.py` toma el de fecha más reciente.
- Hoja **`Base dinamica`**, rango que parte en A1 (fórmula de matriz dinámica). 12 columnas:
  `Año, SKU, Catálogo, Tipo, Cliente, Unidades, Monto, Origen, Familia, Línea, Descripción, Marca`
  - `Tipo`: Producto, Servicio, Glosa (= glosa sin detalle), Arriendo, Detalle glosa.
  - `Origen`: Venta, Arriendo, Glosa detallada.
  - Las columnas a la derecha de L (M en adelante) NO son parte de la base: ignorarlas.
- Leer con Python (`openpyxl`, `data_only=True`) los **valores guardados**. El Excel debe haberse guardado después de recalcular.
- **Fecha de corte**: hoja `Ventas por SKU`, celda a la derecha del rótulo **“Fecha última revisión”** (hoy J15). Buscarla por el rótulo, nunca por celda fija. Se muestra en el panel como “Datos al dd-mm-aaaa”.

## Control de la exportación (lo aplica `exportar.py`)
- **Montos: el control real es el reporte que trae el propio Excel.** Hoja `Ventas por SKU`, valor a la derecha de los rótulos **“Monto 2025 del reporte”** y **“Monto 2026”** (hoy J5 y J6). Buscarlos por el rótulo, nunca por celda fija. La base debe cuadrar **al peso** con ellos; si no cuadra, la exportación se detiene y no genera nada.
- **Unidades: no se fijan en el código.** El resumen las muestra junto a la diferencia contra la exportación anterior (totales guardados en `scripts/ultima_exportacion.json`, archivo local que no se publica). Si cambian, avisa pero **no se detiene**.
- El panel toma sus totales de la propia base y, sin filtros, debe mostrar los mismos del resumen de validación.
- Referencia del corte 06-11-2026 (tras borrar en `TGlosas` las filas SERV-GLOSA de los folios 1654, 41136 y 41659): 2025 = 9.726.505.767 y 120.125 unidades; 2026 = 7.730.447.753 y 81.084 unidades.

## Pipeline
1. `scripts/exportar.py`: lee la Base dinamica → valida (sin filas vacías, sin errores `#`, montos por año contra el reporte del Excel) → genera `data/ventas.json` compacto (columnas con diccionarios para textos repetidos: SKU, cliente, familia, línea, marca, descripción, etc.). Si algo no cuadra, no genera nada.
2. El sitio es estático (HTML + JS, sin backend) y carga `data/ventas.json` directamente, **sin cifrado por ahora**.
3. Cada actualización: reemplazar el Excel, correr `python scripts/exportar.py`, revisar el resumen de validación, publicar.

## Estructura del sitio
- `index.html`: pantalla de acceso (código por correo). Ahí está la lista de correos autorizados.
- `panel.html` + `css/panel.css`: el panel (pestañas, filtros globales, indicadores y las tres vistas).
- `js/util.js`: formatos es-CL, orden, sumas, CSV. `js/datos.js`: sesión, carga y preparación de datos, agrupación por SKU.
- `js/tabla.js`: tabla genérica (orden, paginación, filas fijas, CSV) y columnas compartidas.
- `js/detalle.js`: panel lateral con el detalle de un SKU (se abre desde cualquier vista con `#sku=CÓDIGO`).
- `js/explorador.js`, `js/cliente.js`, `js/resumen.js`: una por vista. `js/app.js`: filtros globales, indicadores y arranque.
- `data/ventas.json`: lo genera `exportar.py`. `robots.txt`: bloquea todo.

## Vistas
1. **Explorador por SKU** (vista principal): tabla con SKU, descripción, familia, línea, marca, unidades y monto 2025 y 2026, variación. Búsqueda por texto, orden por columna, paginación. Clic en un SKU → detalle: clientes que lo compraron (unidades y monto por año) y origen (venta / arriendo / glosa detallada).
2. **Por cliente**: buscar un cliente → qué compró (SKU, unidades, monto por año).
3. **Resumen por línea → familia → marca**: tabla jerárquica expandible con unidades y montos por año.
- Filtros globales: año, línea, familia, marca, origen, cliente, y un interruptor “incluir glosas sin detalle”.
- Exportar lo que esté filtrado: CSV con separador ; y coma decimal (se abre directo en Excel). Por ahora no hay .xlsx.
- En las tres vistas la glosa sin detalle va aparte y rotulada: fila fija arriba en las tablas de SKU y nodo propio bajo cada línea en el resumen.
- **Variación**: compara el último año (parcial, al corte) con el año anterior completo, con una nota que lo dice. Pendiente, **no hacerlo todavía**: comparar 2026 contra 2025 al mismo corte; para eso la base necesitaría la fecha o el mes.

## Reglas de negocio (no cambiarlas)
- **Glosas sin detalle**: se identifican **solo por `Tipo` = Glosa**. Un filtro de marca las deja fuera (no tienen marca). Tienen monto pero 0 unidades. Mostrarlas aparte, rotuladas “Glosa (sin detalle)”; no repartirlas en SKU e **ignorar su SKU y su descripción** (vienen con códigos `SERV-GLOSA…` y una descripción que no corresponde).
- Un SKU con `Tipo` = Detalle glosa se muestra como un SKU más, aunque su código empiece con `SERV-GLOSA` o `SERV_GLOSA`; en ese caso `exportar.py` lo marca con un aviso en el resumen de validación (se corrige en el origen, hoja `TGlosas`).
- **Sin SKU**: solo el SKU placeholder `"0"` se agrupa como “Sin SKU”.
- **Filas en cero**: las filas con monto 0 y unidades 0 se ocultan en las tablas (siguen en `ventas.json`; no cambian ningún total).
- **Negativos**: las notas de crédito y los montos negativos se suman tal cual. Mostrar siempre valores **netos** por SKU y por cliente. Si un cliente queda con glosa neta negativa, se muestra, con una nota: corresponde a notas de crédito o NT sin referencia.
- **Arriendos**: la plata está en el año de cada factura; las unidades solo en el año en que partió el contrato.
- **Decimales**: los montos se mantienen con decimales en los datos; se redondea solo al mostrar (redondear fila a fila descuadra los totales).
- Montos en CLP sin decimales, separador de miles con punto; también vista en MM (millones con 1 decimal, coma decimal).
- Todo el texto de la interfaz en español de Chile.

## Seguridad y publicación
- **Sin cifrado por ahora.** `data/ventas.json` se publica en texto plano y el sitio lo carga directamente. Está pendiente endurecer la seguridad más adelante.
- **Limitación conocida**: mientras no haya cifrado, el login es solo una barrera de entrada en el navegador; quien conozca la URL de `data/ventas.json` puede descargarlo sin pasar por el login. Los datos incluyen nombres de clientes y montos.
- **La carga de datos vive en una sola función**: `VS.cargarDatos()` en `js/datos.js`. Nadie más hace `fetch` de los datos. Para endurecer (cifrado, backend, etc.) se reemplaza solo esa función.
- **Login**: mismo esquema del repo `Juan-Martin-G/EERR-GEMCO` (GitHub Pages, código de 6 dígitos por correo con EmailJS, lista de correos autorizados en `index.html`). El panel **no carga `ventas.json` hasta que el usuario valide el código**.
- **Publicación**: repo **`Ventas-por-SKU`** en la cuenta de GitHub **Juan-Martin-G** (la misma del panel EERR-GEMCO; decisión del 11-11-2026, reemplaza a Gemco-DN), con GitHub Pages desde `main`, carpeta raíz. Commits con el nombre y correo personal del usuario. **No publicar hasta que yo lo pida.**
- **No indexar**: todas las páginas llevan `<meta name="robots" content="noindex, nofollow">` y hay un `robots.txt` que bloquea todo.
- **El Excel nunca se sube**: `.gitignore` excluye `*.xlsx`. `data/ventas.json` sí se publica.

## Diseño
- Limpio y rápido; debe funcionar bien con ~16.000 filas. Sin frameworks pesados (JS puro o una librería de tablas liviana desde CDN con versión fija).
- Responsivo (que se pueda revisar en el celular).
- Gráficos solo donde aporten (p. ej. un barra simple 2025 vs 2026 en el resumen por línea).

## Cómo trabajar
- Antes de construir o cambiar la interfaz, correr `exportar.py` y mostrarme el resumen de validación (filas, montos contra el reporte, unidades contra la exportación anterior, totales por línea).
- Construir primero el Explorador por SKU y mostrármelo; después las otras vistas.
- No inventar datos ni “corregir” montos: si algo no cuadra, avisar.
