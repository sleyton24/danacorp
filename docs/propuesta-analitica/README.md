# Propuesta visual — Resumen y Performance

Estado: propuesta aprobada en dirección, sin implementar.
Prototipo navegable: [`prototipo.html`](./prototipo.html) (datos sintéticos, no toca la API).

Contexto: la Fase 1 analítica (`5668f4d`) unificó las definiciones y corrigió los cálculos,
pero no cambió la presentación. Este documento cubre lo visual y lo interactivo.

---

## 1. Dirección elegida

**Jerarquía fuerte que desemboca en detalle denso.** Dos niveles en la misma pantalla:

- **Nivel 1 — el titular.** Una cifra grande que responde la pregunta principal de la sección
  (Resumen: avance de venta; Performance: UF colocadas), con la barra segmentada del inventario
  completo debajo. Reemplaza las 10 tarjetas del mismo peso visual que hay hoy, donde ninguna manda.
- **Nivel 2 — la consola.** Tablas densas, monoespaciadas, con barra de progreso en línea:
  piso, tipología, financiamiento, matriz de vendedores. Es a donde se baja cuando el titular
  genera una pregunta.
- **Nivel 3 — la unidad.** Tabla de unidades de la selección y ficha en panel lateral.

Las dos secciones siguen separadas en el sidebar. La navegación no cambia.

## 2. Filtrado cruzado

Un solo objeto de estado gobierna la vista:

```ts
interface CruceAnalitico {
  estado: EstadoUnidad | null;
  piso: number | null;
  tipologia: string | null;
  banco: string | null;
}
```

Cada bloque es a la vez lectura y control: clic en un tramo de la barra, en una fila de piso,
de tipología o de banco fija ese valor; clic de nuevo lo suelta. Los filtros activos se muestran
como chips removibles sobre el contenido.

### La regla que importa

**El numerador se filtra, el denominador no.** Si el cruce se aplicara a los dos, filtrar por
Escriturado daría 100% en todos los pisos — un dato vacío. Con el denominador fijo en el
inventario, la misma acción responde "¿dónde están concentrados los escriturados?": piso 12 al
72%, piso 3 al 22%.

Sin cruce activo, el numerador es la colocación (reservado + promesado + escriturado) y las
tablas se titulan "Colocación por…". Con cruce activo, el numerador es la selección y pasan a
titularse "Selección por…". El rótulo de la columna cambia de `col/tot` a `sel/tot`.

## 3. Comparación de períodos

### La distinción que hay que respetar

Hay dos clases de métrica y el selector de período **no** aplica a las dos:

| Clase | Métricas | Efecto del período |
|---|---|---|
| Stock (acumulado) | avance, UF escriturada, pipeline, recaudado, UF/m², inventario | Ninguno. Siempre acumulado. |
| Flujo | unidades colocadas, UF colocadas, clientes registrados, cierres | Se acota a la ventana. |

Filtrar el stock por período produce basura: en el prototipo, antes de corregirlo, "este trimestre"
mostraba "avance 50,0%" sobre un denominador de 4 departamentos. El avance de un proyecto no es
lo que pasó en 90 días.

La solución es un bloque de flujo aparte — "Colocado en el período" — que es el único que responde
al selector y el único que lleva comparación. El titular declara "acumulado · no depende del período"
para que la ausencia de reacción sea legible y no parezca un bug.

En Performance la distinción casi no aplica: clientes registrados y cierres son flujo por naturaleza,
así que la sección entera responde al período.

### Ventanas

- `Período anterior`: mes/trimestre/año inmediatamente anterior.
- `Mismo período, año anterior`: la misma ventana desplazada 12 meses.
- Sin período no hay comparación: el selector se deshabilita.

El delta se muestra al lado de la cifra, verde o rojo, con el porcentaje. Si el período de
comparación es 0 y el actual no, dice "nuevo" en vez de dividir por cero.

## 4. Qué se reutiliza y qué falta

Ya existe en `src/utils/analytics.ts` y no hay que tocarlo:

- `esEscriturado` / `esComprometido` / `estaTomado` — los alcances con nombre
- `sumarUF`, `contarPorEstado`, `sumarPagado`
- `crearIndiceVinculos`, `estadoEfectivoUnidad`, `departamentoPadre` — herencia de estado de
  bodegas y estacionamientos
- `fechaHitoUnidad` — es la base de todo el eje temporal
- `parseFechaFlexible`, `bucketMes`, `enPeriodo`

Hay que agregar:

- `ventanaPeriodo(periodo, offset, ahora)` — devuelve `[desde, hasta)`. Hoy `enPeriodo` solo
  resuelve el período actual; la comparación necesita el desplazamiento.
- `aplicarCruce(units, cruce, excepto?)` — el filtro cruzado, con el parámetro `excepto` para que
  cada bloque pueda excluirse a sí mismo del filtro que él mismo controla.
- El estado del cruce sube a `App.tsx` o a un contexto propio si se quiere que sobreviva al
  cambio de vista. Si no, `useState` local en cada sección alcanza.

### Riesgo a verificar antes de prometer la comparación

`fechaHitoUnidad` depende de que las fechas de hito estén completas en los datos reales.
En SV155 hay que contar cuántas unidades en estado Reservado, Promesado o Escriturado tienen
la fecha nula: cada una de ellas queda fuera de todo período y hace que el bloque de flujo
subdeclare. Si la cobertura es baja, la comparación de períodos no es viable todavía y conviene
declararlo en pantalla como se hace hoy con los clientes de fecha ilegible.

## 4.bis El estado vacío es un requisito, no un caso borde

Una auditoría de la base local (2026-07-29) devolvió: 780 unidades, **ninguna** en Reservado,
Promesado ni Escriturado. Ninguna con banco. 100 clientes, todos Prospecto, todos registrados
en el mismo mes. Cero fechas de hito.

La lectura útil de eso no es "faltan datos de prueba". Es que **todo proyecto nace en cero y se
queda ahí durante semanas**, así que el cero es un estado de producción normal y hay que diseñarlo.
Un titular que dice `0,0%` sobre una barra gris se lee como "el rediseño rompió algo".

Reglas del estado vacío, ya implementadas en el prototipo (proyecto `SV999` en el selector):

- **Titular**: en vez de `0,0%`, el texto "Sin colocaciones" más el inventario cargado
  (`180 departamentos disponibles`) y una línea que explica cuándo aparecerá el número.
  Nada sugiere error.
- **Leyenda de estados**: los tramos con cero unidades se muestran en gris y no son clickeables.
  Un filtro que no puede devolver nada no se ofrece.
- **Tablas densas**: si no hay filas, texto explicativo en vez de tabla vacía. Financiamiento dice
  "aparece cuando haya unidades promesadas o escrituradas con banco asignado".
- **Bloque de flujo**: declara que no hay hitos registrados y que la comparación no tiene con qué
  contrastar. Igual que hoy se declaran los clientes con fecha ilegible.
- Las tablas de piso y tipología sí se muestran con 0%: el denominador es inventario real y
  comunica que la carga masiva funcionó. Es información, no ruido.

## 5. Fases sugeridas

0. **Datos con los que validar.** Antes de construir: averiguar si el VPS tiene colocaciones
   reales. Si las tiene, un dump anonimizado vale más que cualquier semilla. Si no, sembrar la base
   local respetando las invariantes del dominio — una unidad no sale de Disponible sin cliente
   asignado, Escriturado es terminal, `plan_pagos` coherente con el estado — porque validar contra
   datos imposibles no valida nada.
1. **Jerarquía, consola y estado vacío.** Titular, barra segmentada, tablas densas, tabla de
   unidades, y las reglas del punto 4.bis. Es puramente presentacional: no cambia ningún cálculo.
   No depende de la fase 0 — es la única fase que se puede entregar y verificar hoy, porque el
   estado que muestra es justamente el que tiene la base.
2. **Filtrado cruzado.** Sube el estado, agrega `aplicarCruce`, cablea los bloques como controles.
   Es el cambio estructural. Verificable solo con datos colocados: sobre un inventario 100%
   disponible no hay nada que cruzar.
3. **Bloque de flujo y comparación.** Agrega `ventanaPeriodo` y separa stock de flujo. Bloqueada
   por la fase 0: sin un solo hito no hay ventana que acotar ni forma de probar la lógica.
4. **Drill-down a la ficha.** Reutiliza el panel de unidad existente en vez del stub del prototipo.

## 6. Diferencias del prototipo con la aplicación real

- Los datos son sintéticos y deterministas, generados con una semilla fija. Dos proyectos,
  380 y 166 unidades.
- La ficha de unidad es un stub que solo muestra los campos que alimentan la analítica.
- "Exportar selección" solo muestra un aviso. En la aplicación real debería descargar el Excel
  de la selección activa, no del proyecto completo — hoy `DownloadsView` siempre baja todo.
- El prototipo usa Tailwind desde CDN y no importa nada del proyecto.
