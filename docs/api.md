# API REST

La especificación completa está en **OpenAPI 3** en `GET /api/openapi.json` y la interfaz Swagger en `/api/docs`
(generada desde los esquemas Zod reales, `backend/src/docs/openapi.ts`).

## Convenciones

- Base: `/api`. Todo salvo `/auth/login|refresh|logout` exige `Authorization: Bearer <accessToken>`.
- El backend recarga usuario y permisos en cada petición: desactivar un usuario corta su acceso de inmediato.
- Listas: `?page=1&pageSize=25` → `{ data: [...], meta: { page, pageSize, total, totalPages } }`.
- Errores: `{ "error": { "code": "...", "message": "...", "details": ... } }`, sin trazas internas.

| HTTP | Código | Cuándo |
|---|---|---|
| 400 | `VALIDACION`, `SOLICITUD_INVALIDA` | Zod rechaza la entrada (con `details` por campo) |
| 401 | `NO_AUTENTICADO` | Sin token, expirado o usuario inactivo |
| 403 | `SIN_PERMISO` | Falta el permiso requerido |
| 404 | `NO_ENCONTRADO` | Recurso inexistente o ajeno |
| 409 | `CONFLICTO` | Duplicado (código de barras, documento, correo) o precios cambiados al guardar una cotización |
| 422 | `REGLA_DE_NEGOCIO` | La base rechaza la operación (stock insuficiente, período cerrado, no es proveedor…) |
| 429 | `DEMASIADAS_SOLICITUDES` | Rate limiting |
| 502/503/504 | `IA_*`, `MODELO_NO_INSTALADO`, `BD_NO_DISPONIBLE` | Fallos de Ollama o PostgreSQL |

## Endpoints principales

Los del prompt (`/auth`, `/products`, `/brands`, `/categories`, `/units`, `/inventory`, `/purchases`, `/sales`,
`/quotations`, `/ai`) más: `/third-parties`, `/prices`, `/reports`, `/users`, `/roles`, `/permissions`, `/audit`,
`/closures`, `/imports`, `/integration`. Ver la tabla completa con permisos en Swagger.

Ejemplos:

```http
POST /api/sales
{ "cliente_id": 3, "lineas": [{ "producto_id": 4, "cantidad": 12.5, "unidad_id": 3 }] }
→ 201 { "numero": "FAC-000006", "lineas": [{ "precio_unitario": "2520.0000", "subtotal": "31500.00" }] }
```

El cliente nunca envía precios de venta: el servidor usa el precio vigente × factor de conversión.

```http
POST /api/quotations/paint/calculate
{ "espacios": [{ "largo": 4, "ancho": 3, "alto": 2.5 }], "aberturas": [{ "ancho": 0.9, "alto": 2 }], "manos": 2 }
```

```http
POST /api/integration/offline/sales
{ "dispositivo": "caja-01", "uuid_offline": "…", "fecha_hora_local": "2026-10-28T10:00:00-05:00",
  "venta": { "cliente_id": 3, "lineas": [{ "producto_id": 8, "cantidad": 2 }] } }
→ 201 la primera vez · 200 { "duplicado": true } al reenviar
```

## Plantillas de importación (DP-16)

Primera hoja del libro, encabezados en la fila 1 (descargables en `GET /api/imports/template/:tipo`):

| Tipo | Columnas |
|---|---|
| productos | codigo_barras, nombre, descripcion, marca, presentacion, categoria, unidad_base, decimales_permitidos, controla_vencimiento, controla_garantia, porcentaje_incremento, stock_minimo |
| terceros | tipo_persona, tipo_documento, numero_documento, nombre, apellido, razon_social, direccion, telefono, correo, es_cliente, es_proveedor |
| saldos | codigo_barras, cantidad (en unidad base), estado, costo_unitario, fecha_vencimiento, referencia_garantia |

La marca y la unidad deben existir (misma regla que el registro manual). Booleanos: `si/no`, `true/false`, `1/0`.
