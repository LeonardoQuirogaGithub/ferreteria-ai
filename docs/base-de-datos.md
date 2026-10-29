# Base de datos

## Migraciones (`backend/migrations`)

| Archivo | Contenido |
|---|---|
| `001_esquema_base.sql` | Copia literal de `04_modelo_datos_ferreteria.sql` sin `BEGIN/COMMIT` (el runner abre una transacción por archivo). |
| `002_correcciones_documentos_y_seguridad.sql` | Correcciones y reglas faltantes (ver abajo). |
| `003_fichas_cotizaciones_ia_importacion.sql` | Ficha técnica, cotizaciones, conversaciones del asistente, importación y saldos iniciales. |

El runner (`src/db/runner.ts`) registra cada archivo en `schema_migrations` / `schema_seeds` y es repetible desde una base vacía.

## Correcciones al SQL original

| Hallazgo | Corrección |
|---|---|
| **Error de ejecución** en `fn_validar_periodo_abierto`: el `CASE` evaluaba `NEW.fecha_hora` y `NEW.fecha` a la vez; cualquier `INSERT` en `compra` o `venta` fallaba con «el registro new no tiene un campo fecha_hora». | Reescrita con `IF/ELSE`. |
| H-01/H-02 auditoría incompleta | Se añaden triggers a marca, categoría, unidad, ficha técnica y cotizaciones; `fn_auditar` deja de copiar `hash_password`; `TRUNCATE` de auditoría y cierres queda bloqueado. |
| RN-06 documentos editables | `fn_proteger_documento`: una compra o venta confirmada solo admite el paso a `anulado` (con motivo, usuario y fecha). Detalles y movimientos son de solo inserción. |
| RN-18 usuarios borrables | Trigger que impide `DELETE` de usuario, tercero, producto y lote. |
| Numeración | Secuencias y `fn_siguiente_numero` (`ING-`, `FAC-`, `COT-`). |
| Entrada por saldo inicial | `fn_aplicar_entrada_compra` acepta `p_documento_tipo`; `fn_aplicar_saldo_inicial` (DP-15). |
| Venta offline multilínea | El UUID offline se guarda en `venta.uuid_offline`; no se repite en cada movimiento (violaría `UNIQUE`). |
| Verificación | `fn_verificar_kardex()` y `fn_verificar_lotes()` (`npm run db:verify`). |

## Estrategia de saldos (sin contradicción con el kardex)

`existencia` es un saldo materializado que **solo** modifican las funciones de negocio, y cada modificación inserta
el movimiento correspondiente en la misma transacción. `fn_verificar_kardex()` reconstruye el saldo por producto y
estado desde `movimiento_inventario` y lista diferencias; las pruebas exigen cero diferencias.

Invariante de lotes: `Σ lote.cantidad_disponible = Σ existencia (disponible + reservada + dañada)`, porque los cambios de
estado no mueven lotes (diseño original). Las ventas consumen lotes FIFO por `fecha_ingreso, id`.

## Concurrencia

`fn_aplicar_salida_venta` bloquea la fila `existencia(producto, 'disponible')` con `FOR UPDATE`. El servicio ordena las
líneas por producto para que dos ventas multilínea bloqueen en el mismo orden (sin deadlocks). Prueba: dos ventas
simultáneas del total disponible → una 201 y otra 422, saldo final 0.

## Datos de demostración

`seeds/002_demo.sql` conserva los IDs y resultados del seed original (martillo 232 + 3 dañadas a 33.750, cable 92 m, etc.)
y agrega pinturas y accesorios con fichas técnicas **de demostración** y casos de prueba: agotado por venta (vinilo T2,
tubo PVC), agotado con existencia dañada (brocha 3"), agotado con existencia reservada (cinta), bajo mínimo (pintura de
techos), sin precio (rodillo antigota), sin ficha técnica (esmalte) e inactivo (vinilo crema).
