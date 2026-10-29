# Cotizador de pintura y cotizaciones

La IA (o el formulario) solo reúne parámetros. El cálculo es determinista en `quotations/paint-calculator.ts` y
`quotations.service.ts`, con aritmética decimal (`decimal.js`).

## Fórmulas

- Paredes de un espacio: `2 × (largo + ancho) × alto × cantidad`. Techo: `largo × ancho × cantidad`.
- **Área neta** = paredes incluidas − puertas y ventanas + techos incluidos (las aberturas solo se descuentan de las paredes).
- **Litros** = área neta × manos × (1 + desperdicio / 100) ÷ rendimiento (m²/L), redondeado hacia arriba a 4 decimales.
- **Presentaciones**: combinación de menor costo de las presentaciones de una misma línea (galón, cuñete…) que cubra los
  litros; desempate por menos sobrante y menos unidades. Ej.: 22 L → 1 cuñete + 1 galón ($447.700) en vez de 6 galones ($502.200).
- **Auxiliares** con rendimiento `m2_por_unidad`: `ceil(área neta ÷ rendimiento)`.
- **Subtotal** = cantidad comercial × precio vigente × factor de conversión. **Total disponible** = parte cubierta por la existencia disponible.

El área construida **no** se usa como área de muros. Si es el único dato, se devuelve `faltan_datos` con preguntas; solo
con `permitir_estimacion: true` se estima muros ≈ 2,5 × área construida, registrado como supuesto «ESTIMACIÓN».

## Reglas documentadas (`paint-rules.ts`, DP-23)

| Estado de superficie | Auxiliares | Sellador |
|---|---|---|
| nueva | rodillo, brocha, bandeja, cinta, plástico | sí |
| buena | rodillo, brocha, bandeja, cinta, plástico | no |
| regular | + lija | no |
| deteriorada | + lija, masilla | sí |

Desperdicio por defecto 10 %; manos por defecto las de la ficha técnica o 2. El usuario puede fijar cantidades
(`auxiliares: [{ tipo, cantidad }]`, `cantidad: 0` excluye), elegir producto (`producto_pintura_id`) o indicar el
rendimiento (`rendimiento_m2_por_litro`).

**Nunca se inventan rendimientos**: un producto sin ficha (o sin `contenido_litros`) no se usa para calcular pintura; un
auxiliar sin rendimiento queda en `pendientes` (no suma). Las fichas del seed son de demostración y se advierte en cada cálculo.

## Selección de productos

Entre las líneas compatibles con la superficie y con precio vigente se prefiere la que tiene **existencia suficiente** y,
entre ellas, la más económica. Las demás aparecen en `alternativas`. Productos agotados o insuficientes se marcan y se
separa el total del proyecto del total disponible para compra inmediata. No se incluyen impuestos, descuentos ni transporte.

## Cotizaciones guardadas

- `POST /api/quotations` revalida precios y existencias **dentro de la transacción**. Si el cliente envía
  `precio_unitario_esperado` y difiere del vigente, responde 409 con los cambios; se guarda solo tras confirmar (`aceptar_cambios_precio`).
- Se guarda una instantánea (código, nombre, marca, presentación, unidad, precio, disponibilidad al cotizar); el detalle es inmutable.
- No reserva ni descuenta inventario.
- Estados: `emitida` → `aceptada` | `anulada` (con motivo). `vencida` se calcula cuando `vence_en < now()` (vigencia `COTIZACION_VIGENCIA_DIAS`, 15 por defecto). Una vencida no se puede aceptar.
