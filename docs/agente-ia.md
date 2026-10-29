# Agente de IA

## Ciclo

1. React envía `POST /api/ai/chat { mensaje, conversacion_id? }`. El cuerpo es estricto: un `usuario_id` enviado por el cliente se rechaza.
2. Express autentica, exige `ia.usar` y aplica rate limiting por usuario (`RATE_LIMIT_CHAT_MAX`) y tamaño máximo (`AI_MAX_MESSAGE_CHARS`).
3. El orquestador (`modules/ai/orchestrator.ts`) arma: instrucción de sistema + últimos `AI_HISTORY_MESSAGES` mensajes de la conversación propia + pregunta, y **solo las herramientas que el rol puede ejecutar**.
4. Ollama responde texto o `tool_calls`. Cada llamada se valida con Zod, se verifica el permiso y se ejecuta con consultas parametrizadas.
5. El resultado vuelve al modelo como JSON `{ ok, datos }` o `{ ok: false, error }`.
6. Se repite hasta una respuesta final o hasta `AI_MAX_ITERATIONS` / `AI_MAX_TOOL_CALLS`.
7. **Verificación determinista** (`grounding.ts`): cada cifra de la respuesta debe aparecer en los datos consultados o en la pregunta.
   - Si una herramienta falló y la respuesta trae cifras sin respaldo (o ninguna herramienta funcionó), la respuesta del modelo se **reemplaza** por «No fue posible verificar los datos…».
   - Si todas funcionaron pero hay cifras sin respaldo, se anexa una advertencia y la verificación queda `con_advertencias`.
8. React muestra la respuesta, el estado de verificación y **artefactos** construidos con los datos de las herramientas (tarjetas de productos, alertas, cálculo de pintura, borrador de cotización). Las tarjetas no dependen del texto del modelo.

## Herramientas

| Herramienta | Permiso | Qué hace |
|---|---|---|
| buscar_productos | inventario.consultar | Búsqueda por términos (sin tildes, singular, números como palabra completa) o código exacto; indica si la coincidencia es única. |
| consultar_existencias | inventario.consultar | Disponible, reservada, dañada, total físico, unidad base, conversiones de venta y fecha. Distingue `encontrado: false`. |
| consultar_productos_agotados | inventario.consultar | Activos con disponible = 0, mostrando reservada/dañada aparte. |
| consultar_stock_minimo | inventario.consultar | Disponible ≤ mínimo (o < umbral); clasifica agotado vs. bajo mínimo. |
| consultar_precio_vigente | inventario.consultar | Precio vigente y si es manual; costo solo con `costo.consultar`. |
| consultar_detalle_producto | inventario.consultar | Descripción, conversiones y ficha técnica. |
| consultar_materiales_pintura | cotizacion.gestionar | Cálculo determinista de áreas, litros, presentaciones y auxiliares (ver cotizaciones.md). |
| calcular_cotizacion | cotizacion.gestionar | Valora productos con precios y existencias del servidor (ignora importes del modelo). |
| guardar_cotizacion | cotizacion.gestionar | Revalida y devuelve un **borrador pendiente de confirmación**; el usuario lo confirma en pantalla y el servidor revalida otra vez al guardar. El modelo no puede persistir por sí solo. |
| consultar_estado_cotizacion | cotizacion.gestionar | Estado de una cotización propia (o de cualquiera con permisos de reportes/administración). |

No existe ninguna herramienta que modifique inventario, precios, usuarios o documentos.

## Errores controlados

| Situación | Respuesta |
|---|---|
| Ollama apagado | 503 `IA_NO_DISPONIBLE`; `/ai/status` → `ollama: no_disponible` |
| Modelo no instalado o descargándose | `/ai/status` → `modelo_disponible: false` con `ollama pull <modelo>`; en chat, 503 `MODELO_NO_INSTALADO` |
| Tiempo agotado (`OLLAMA_TIMEOUT_MS`) | 504 `IA_TIEMPO_AGOTADO` |
| Respuesta sin mensaje o vacía | 502 `IA_RESPUESTA_INVALIDA` |
| Usuario cancela | El backend aborta la llamada a Ollama (`AbortController` al cerrarse la petición) |
| Base de datos caída | La herramienta devuelve error → respuesta «No fue posible verificar…» |

## Validación con un modelo real

Las pruebas automáticas usan un LLM simulado. Con Ollama instalado:

```bash
ollama pull qwen2.5:7b
curl -s localhost:4000/api/ai/status -H "Authorization: Bearer <token>"
```

y en la pantalla del asistente pruebe las preguntas sugeridas. Modelos pequeños (<7B) suelen elegir peor las
herramientas; el backend sigue impidiendo que inventen datos, pero las respuestas pueden ser menos útiles.
