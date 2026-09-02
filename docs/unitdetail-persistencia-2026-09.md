# Unit Detail — persistencia, prelación de % y totales (septiembre 2026)

Estado al **2026-09-02**. Repo local: `danacorp-project - Prod v1`.
Commit **`59c2fb7`** — "Fix: guardado completo de Unit Detail, prelación de % y totales".
1.227 inserciones / 118 borrados en fuente; 1.880 / 771 contando `dist/`. Sin push.

## Qué estaba roto

Tres síntomas reportados por Nicholas, con una causa distinta cada uno.

**1. Los Gastos Operacionales (y el precio de venta final) no se guardaban.** El
`PATCH /api/units/:id` filtra el body contra un `fieldMap` y ese mapa no incluía
`gastosOperacionales`, `gastosNotariales` ni `gastosConservador`. Lo que no está en el mapa
se descarta en silencio: el frontend actualizaba su estado en memoria (por eso "parecía"
guardado hasta recargar), el PATCH respondía 200 y el dato nunca llegaba a la BD. Las
columnas, el INSERT y el GET ya existían — solo faltaba la escritura.

Lo que amplificaba el bug: `persistUnit()` en `App.tsx` hacía `fetch(...).catch(() => {})`
y nadie miraba el status, así que un 400/403/409 terminaba igual con el toast "Cambios
guardados". El error era estructuralmente invisible.

Otras pérdidas encontradas en la misma auditoría:

- `precioVenta`: el "Total Precio de Venta" del cuadro financiero es `totalPrecioVentaNuevo`,
  un valor derivado que solo se escribía en `formData` desde `applyUnitDiscount` y desde el
  efecto que actúa cuando `precioVenta === 0`. Se guardaba un precio viejo cada vez que
  cambiaba el bono, un descuento o una unidad vinculada.
- Descuento y bono de **bodegas y estacionamientos** vinculados: `linkedDiscounts` /
  `linkedBono` no se persistían en ninguna parte (`performSave` mandaba solo el depto).
- Los % de la forma de pago y sus interruptores: estado local puro.
- `reservaVendedorId` / `reservaExpira`: se ponían en `undefined` al pasar a Disponible,
  pero `undefined` no viaja en JSON y no había columna en el mapa. Consecuencia real: una
  `reserva_expira` vieja hacía que al volver a reservar el backend no calculara vencimiento
  nuevo (`!existing.reserva_expira`).
- `diaPago` faltaba en el INSERT del `POST /api/units` (estaba en PATCH y GET).

**2. Los % de la Forma de Pago no tenían jerarquía.** Al editar cualquier componente, las
otras dos activas absorbían en proporción.

**3. El pie del cronograma** mostraba "Total Planificado" sin distinguir lo efectivamente
pagado.

## Columnas nuevas en `units`

Siete, con migración idempotente en el `init()` de `server.ts`, **sin DEFAULT**, siguiendo
el patrón de `dia_pago`:

`promesa_pct`, `cuotas_pct`, `escritura_pct`, `credito_pct` (DOUBLE PRECISION)
`promesa_on`, `cuotas_on`, `escritura_on` (BOOLEAN)

Sin DEFAULT es deliberado: `null` = "esta unidad nunca declaró forma de pago" y ahí precarga
la cotización; cualquier valor no nulo manda sobre la cotización y sobre el default del
proyecto. **`false` y `0` son valores declarados, no ausencia** — el guard
`hayFormaPagoPersistida` mira los siete campos con `!= null`, no solo los cuatro `*Pct`:
una unidad "declarada" únicamente por un interruptor apagado, si se mira solo los `*Pct`,
deja que la cotización vuelva a pisar lo que el usuario apagó a mano.

El `fieldMap` salió del handler a `UNIT_PATCH_FIELD_MAP` exportado, para que un test lo
recorra. Quedó en 55 campos.

## Regla del plug (forma de pago)

Orden de prelación: **Crédito Banco > Promesa ("el pie") > Cuotas > Escritura**. Al editar
una componente, las anteriores no se mueven y las posteriores absorben en proporción.
Cambiar el Crédito recalcula las tres activas proporcionalmente; los interruptores on/off
también reparten proporcionalmente (no hay componente "fijada").

La última componente activa del orden es el **plug**: se lleva el espacio libre entero y se
dibuja **derivada, de solo lectura**, con la caja gris de Compra Segura. No es un detalle
estético — un input que acepta lo tipeado y lo reemplaza en silencio es la misma clase de
bug que el punto 1, y se reporta como "no me guarda lo que escribo". `componentePlugForma()`
en `pricingUtils.ts` decide cuál es:

| Cuotas | Escritura | Derivada | Editable |
|---|---|---|---|
| on | on | Escritura | Cuotas |
| on | off | Cuotas (toma el rol) | — |
| off | on | Escritura | — |
| off | off | ninguna | ninguna (la UI ya muestra su error) |

**Con bono pie activo devuelve `null` y los tres campos vuelven a ser editables**: ahí los
campos son pesos, no porcentajes reales, `reajustarPctReales` hace short-circuit y dejar la
Escritura de solo lectura rompería ese flujo. El piso de 3% de la Promesa se mantiene con el
patrón rechazar + error inline. `redistribuirPctReales` sigue pura e idempotente — el
`useEffect` de red de seguridad la vuelve a llamar en cada render y si no es idempotente
cicla.

## Un solo criterio de "pagado"

`sumarPagado()` y su par nuevo `sumarComprometido()`, ambos en `analytics.ts`, con el parser
tolerante que descarta montos que no parsean en vez de propagar NaN.

El bug que apareció al unificar: en el pie del cronograma, `totalPagado` ya usaba
`sumarPagado()` pero `totalPlanificado` sumaba con `Number(amount || 0)` — las dos mitades
del mismo saldo con criterios distintos. Un monto pegado desde Excel ("1.234,5") daba
1234,5 en el pagado y NaN en el comprometido, envenenando el total.

`DownloadsView` (Sábana de Datos) **dejó de leer** `unit.totalPagado` / `unit.saldoPorPagar`
y deriva de `planPagos`. Era el único consumidor de esas columnas y exportaba números viejos
para toda unidad que nadie hubiera vuelto a abrir y guardar — que en un proyecto cargado son
casi todas. Arreglarlo solo en el guardado no habría alcanzado. Se agregó además la columna
Total Comprometido (UF), que faltaba para poder auditar el Saldo en la misma planilla.
`performSave()` igual recalcula y manda `totalPagado` / `saldoPorPagar`, para el endpoint de
sync y consumidores futuros.

## Tests

353 (eran 318 antes de esta tanda). Corren contra **Postgres real** con schema aislado
(`test-db.ts`), no contra SQLite — por eso el caso de los tres estados del BOOLEAN
(`true` / `false` / `null`) verifica de verdad que `false` vuelve del GET con
`typeof === 'boolean'` y no como `0`, `"f"` o string.

- `tests/unitFieldMap.test.ts` — barrido PATCH→GET de los 55 campos del mapa, más un test
  que escanea `UnitDetail.tsx` por regex buscando `handleChange('X')` y falla si alguno no
  está en el mapa. Es protección automática, no una lista que haya que acordarse de
  actualizar.
- `tests/formaPagoPrelacion.test.ts` — 21 casos: la secuencia de prelación, los cuatro
  estados del plug (3 de ellos sobre `componentePlugForma`), crédito al 0% y al 100%,
  idempotencia (`f(f(x)) === f(x)`) y que `promesa + cuotas + escritura + crédito === 100`
  al centésimo.

Entre los dos archivos nuevos, 32 casos.

## Al desplegar

La cadena es: **commit en esta carpeta local → push de Sebastián (Sleyton) desde su clon →
`deploy/traspaso/desplegar-vps.sh` en el VPS.** Nicholas no puede pushear: su Git Credential
Manager exige un diálogo interactivo. El tramo del servidor no hace falta describirlo a mano
—el script es ejecutable y no puede quedar desfasado—: `git fetch` + actualizar master **sin
build**, `npm ci`, restart del servicio, y espera hasta 90 s a que `/api/health` devuelva 200.

**Un commit local sin ese push no está desplegado.** Verificarlo requiere `fetch`:
`git log origin/master` a secas muestra el último estado traído, no el del remoto.

El `CLAUDE.md` afirmaba lo contrario ("el despliegue NO sale de GitHub", "el working tree ES
producción", "el push es solo respaldo"); quedó corregido junto con esta bitácora.

Dos reglas operativas que valen siempre:

- `dist/` está versionado y el servidor **no compila**: hay que correr `npm run build` antes
  de commitear, y el `dist/` que viaja tiene que ser posterior a la última edición de
  fuente. Un `dist/` desfasado no falla el build — deja el frontend viejo en producción con
  el código nuevo commiteado, que es un debug ciego. (En `59c2fb7` se verificó: `dist/`
  11:19:13 contra fuente 11:17:15.)
- Las 7 columnas se crean en el `init()` del arranque, así que **el restart del servicio es
  obligatorio**. Sin restart, el frontend nuevo le pega a una tabla sin `promesa_pct` y
  compañía.

## `bonoPct` — resuelto: solo lectura

El "% Bono" del bloque Bono Pie quedó de **solo lectura** en Unit Detail. Sale de
`discountConfig.bonoPiePct`, que es política comercial **del proyecto**: editarlo desde la
ficha de una unidad habría movido el bono —y con él el precio publicado— de TODAS las
unidades del proyecto, sin que la pantalla lo advirtiera. Un campo que aparenta ser del
negocio puntual pero es global es peor que uno que no se puede editar ahí.

Se cambia en Administración de Perfiles (`ProfileAdministration.tsx`, "% Bono Pie", por
proyecto, vista solo-Admin). `bonoPct` sigue siendo estado local alimentado por
`/api/projects/:id/config`; lo único que se eliminó es la posibilidad de escribirlo desde
Unit Detail, junto con la constante `canEditBono`, que no gobernaba nada más.

Con esto queda cerrada la lista de campos del Unit Detail que se perdían al guardar.

## Pendientes menores

`GET /api/sync/app_state` (`buildAppStateFromTables`) no mapea `diaPago`,
`formaFinanciamiento`, `plazoCreditoAnios`, las fechas CBR, `terraza` ni las columnas nuevas
— está marcado como "el frontend no lo usa, se mantiene para administración/depuración".
Y `percentPaid` en `UnitDetail.tsx` es código muerto.

## Pendiente de decisión

**Permisos del bono para Supervisor.** Antes de `3f37923` el input de `% Bono` en Unit
Detail lo podían tocar Admin y Supervisor (`canEditBono`); ahora el `bonoPiePct` solo lo
cambia un Admin, desde Administración de Perfiles. Supervisor perdió una capacidad
aparente — que nunca funcionó, porque el valor no se persistía, pero estaba en pantalla.
Si debe recuperarla, el cambio va en los permisos de `ProfileAdministration`, no
devolviendo el input editable a Unit Detail. Sin decidir.
