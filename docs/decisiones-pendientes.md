# Decisiones pendientes, supuestos y limitaciones

Este documento lista lo que los documentos fuente (`01_Requisitos_ERS.md`, `02_Analisis_y_Diseño.md`,
`03_Plan_Validacion_Verificacion.md`) dejan **por definir**. Para que el sistema sea ejecutable se tomó un
**supuesto provisional** en cada caso; ninguno debe considerarse política definitiva hasta que el interesado
lo confirme. Cada supuesto está centralizado (configuración o una función concreta) para poder cambiarlo.

| ID | Tema | Fuente | Supuesto provisional implementado | Dónde se cambia |
|---|---|---|---|---|
| DP-01 | Duración de sesión, 2FA y bloqueo por intentos | RF-SEG-001 | Token de acceso JWT de 15 min y token de renovación de 7 días (rotado y revocable). Sin 2FA. Sin bloqueo por intentos; solo rate limiting en `/api/auth/login`. | `.env` (`JWT_EXPIRES_IN`, `JWT_REFRESH_DAYS`, `RATE_LIMIT_*`) |
| DP-02 | Matriz definitiva de permisos | RF-SEG-002 | Los 13 permisos del seed original más `inventario.consultar`, `costo.consultar`, `kardex.consultar`, `cotizacion.gestionar`, `ia.usar`. Asignación en `seeds/001_seguridad.sql`. | Tablas `rol_permiso` (configuración, RNF-MAN-001) |
| DP-03 | Visibilidad del costo | RF-PRO-003, RF-REP-001 | Solo quien tiene `costo.consultar` (Administrador, Inventario, Compras, Gerencia) ve costos y valorización. Ventas no. | `rol_permiso` |
| DP-04 | Base del precio: costo promedio o último costo | S-06, Riesgo "costo promedio" | Costo promedio ponderado tal como lo implementa `fn_aplicar_entrada_compra` del SQL original. **El promedio solo pondera la existencia _disponible_**, no la reservada ni la dañada (comportamiento heredado; validar). | `fn_aplicar_entrada_compra` |
| DP-05 | Precio manual frente a una compra posterior | S-07, RF-PRE-002 | Una compra crea un historial nuevo con precio calculado y **sin** precio manual: el precio manual deja de aplicarse tras la siguiente compra (comportamiento heredado del SQL). | `fn_aplicar_entrada_compra` |
| DP-06 | Cambio de porcentaje con precio manual vigente | RF-PRE-001 | Cambiar el porcentaje crea un historial con el nuevo precio calculado y elimina el precio manual. | `fn_actualizar_porcentaje` (migración 002) |
| DP-07 | Vender por debajo del costo | RF-PRE-002 | Permitido; no hay validación. | `precios.service.ts` |
| DP-08 | Costo unitario en la línea de compra | RF-COM-001 | La API recibe el costo **por unidad de compra** y el servidor lo divide por el factor de conversión para obtener el costo por unidad base. El seed original registra el costo por unidad base (p. ej., cable: 1 rollo a 1.800, subtotal 180.000); se conserva tal cual. | `purchases.service.ts` |
| DP-09 | Impuestos, descuentos, medios de pago, facturación electrónica | RF-COM-001, RF-VEN-001 | No se calculan impuestos ni descuentos (`impuesto = 0`). Medio de pago es texto libre opcional. Sin facturación electrónica. | `sales.service.ts` |
| DP-10 | Efecto de la anulación sobre existencias | RF-DOC-001, Riesgo "anulación" | La anulación solo cambia el estado del documento, guarda motivo, usuario y fecha. **No revierte existencias** hasta definir la política. | `fn_anular_documento` |
| DP-11 | Venta de productos vencidos | RF-VEN-001, RF-LOT-001 | No se bloquea. El consumo FIFO usa el orden de ingreso del lote. | `fn_consumir_lotes_fifo` |
| DP-12 | Reglas de redondeo de conversiones | RF-PRO-002 | Se rechaza cualquier cantidad que, convertida a la unidad base, exceda los decimales permitidos del producto (comportamiento de `fn_convertir_a_base`). | `fn_convertir_a_base` |
| DP-13 | Reservas que vencen | S-03 | Las reservas no vencen automáticamente. | — |
| DP-14 | Fecha, reapertura y responsables del cierre | RF-CIE-001 | Cierre manual por administrador (`cierre.ejecutar`). La tarea programada no se activa por defecto (variable `CIERRE_AUTOMATICO=false`). No hay reapertura. | `closures.service.ts`, `.env` |
| DP-15 | Saldo inicial importado y tipo de movimiento | RF-MIG-001 | El ERS define tres tipos de movimiento. El saldo inicial se registra como `entrada_compra` con `documento_tipo = 'saldo_inicial'`. | `fn_aplicar_saldo_inicial` (migración 003) |
| DP-16 | Hojas y columnas del Excel de migración | RF-MIG-001 | Plantilla propia documentada en `docs/api.md` (una hoja por tipo, encabezados en la fila 1). | `imports.service.ts` |
| DP-17 | Operaciones offline permitidas y numeración de facturas offline | RF-OFF-001 | Solo se sincronizan ventas. La factura recibe numeración central al aplicarse. El UUID offline garantiza idempotencia; un conflicto queda en `pendiente_conflicto`. No existe todavía un cliente offline (PWA/almacenamiento local). | `integration.service.ts` |
| DP-18 | Sistemas externos, formato y reintentos | RF-INT-001 | Endpoint genérico `POST /api/integration/events` con `identificador_externo` único. Eventos soportados: `venta`. | `integration.service.ts` |
| DP-19 | Obligatoriedad de dirección, teléfono y correo del tercero | RF-TER-001 | Opcionales. | `thirdparties.schemas.ts` |
| DP-20 | Plazo de conservación de auditoría | RF-AUD-001 | Indefinido. | — |
| DP-21 | Cifras de rendimiento, capacidad, RTO/RPO, lectores | RNF-REN-*, RNF-FIA-003, RNF-COM-002 | No se fijan. El lector se trata como teclado (entrada de texto + Enter). | — |
| DP-22 | Vigencia de las cotizaciones | Prompt §4 | 15 días (`COTIZACION_VIGENCIA_DIAS`). Estados: `emitida`, `aceptada`, `anulada`; `vencida` se calcula al consultar cuando `vence_en < now()` y el estado es `emitida`. | `.env`, `quotations.repository.ts` |
| DP-23 | Reglas de materiales auxiliares de pintura | Prompt §7 | Ver `docs/cotizaciones.md`. Las cantidades salen de la ficha técnica (`rendimiento m2_por_unidad`) o de la cantidad indicada por el usuario. Sin ficha ni dato: el artículo queda **pendiente de cantidad** y no suma al total. | `paint-rules.ts` |
| DP-24 | Rendimientos de pintura del seed | Prompt §7 | Las fichas técnicas del seed de demostración tienen `fuente = 'Dato de demostración — validar con la ficha del fabricante'`. No son datos reales de fabricante. | `seeds/002_demo.sql` |

## Inconsistencias detectadas en los documentos fuente

0. **Error en `04_modelo_datos_ferreteria.sql`**: `fn_validar_periodo_abierto` evaluaba `NEW.fecha_hora` y `NEW.fecha` en el mismo `CASE`, por lo que el seed original no podía ejecutarse (fallaba el primer `INSERT INTO compra`). Corregido en la migración 002; los resultados esperados de `05_Plan_Pruebas` nunca pudieron obtenerse con el SQL entregado.
1. **Seed original, venta FAC-000003**: vende cable a 1.800/m, pero el precio vigente calculado es 2.520 (1.800 × 1,40). El seed inserta la venta directamente, sin pasar por el servicio de ventas. Se conserva el dato histórico.
2. **Seed original, compra ING-000003**: la línea dice `cantidad = 1 ROLLO`, `costo_unitario = 1.800`, `subtotal = 180.000`. El costo está por metro (unidad base), no por rollo (ver DP-08).
3. **`05_Plan_Pruebas` PD-01** habla de 22 requisitos funcionales; el ERS contiene 21 (RF-SEG-001 … RF-INT-001).
4. **Invariante de lotes**: el SQL original no mueve lotes en los cambios de estado, por lo que `Σ lote.cantidad_disponible = Σ existencia (los tres estados)`. Es la invariante que verifican las pruebas, no `= disponible`.

## Limitaciones conocidas

- Ollama no estaba instalado en el equipo de desarrollo: las pruebas del agente usan un cliente LLM simulado que reproduce el protocolo de `tool_calls` de `/api/chat`. Ver `docs/agente-ia.md` para validarlo con un modelo real.
- No se incluye cliente offline (almacenamiento local en el navegador); solo el endpoint de sincronización idempotente.
- La tarea programada de cierre existe pero está desactivada por defecto (DP-14).
- No hay Docker en el equipo de desarrollo: `docker-compose.yml` se entrega sin haberse ejecutado allí.
