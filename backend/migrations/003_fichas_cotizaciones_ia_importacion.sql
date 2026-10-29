-- Migración 003: ficha técnica de productos, cotizaciones, conversaciones del asistente,
-- importación desde Excel (RF-MIG-001) y resultado de eventos de integración (RF-INT-001).

-- ---------------------------------------------------------------------------
-- Ficha técnica: datos verificables para el cálculo de materiales de pintura.
-- Un rendimiento solo existe si su unidad está declarada; nunca se infiere.
-- ---------------------------------------------------------------------------
CREATE TABLE producto_ficha_tecnica (
    producto_id BIGINT PRIMARY KEY REFERENCES producto(id),
    tipo_producto VARCHAR(30) NOT NULL CHECK (tipo_producto IN
        ('pintura', 'sellador', 'masilla', 'lija', 'rodillo', 'brocha', 'bandeja', 'cinta', 'plastico', 'otro')),
    linea VARCHAR(100),
    superficies VARCHAR(20)[] NOT NULL DEFAULT '{}',
    acabado VARCHAR(50),
    contenido_litros NUMERIC(10,4) CHECK (contenido_litros > 0),
    rendimiento NUMERIC(10,4) CHECK (rendimiento > 0),
    unidad_rendimiento VARCHAR(20) CHECK (unidad_rendimiento IN ('m2_por_litro', 'm2_por_unidad')),
    manos_recomendadas SMALLINT CHECK (manos_recomendadas BETWEEN 1 AND 5),
    compatibilidad TEXT,
    observaciones_fabricante TEXT,
    fuente VARCHAR(200),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_rendimiento_con_unidad CHECK ((rendimiento IS NULL) = (unidad_rendimiento IS NULL)),
    CONSTRAINT chk_rendimiento_litros CHECK (unidad_rendimiento IS DISTINCT FROM 'm2_por_litro' OR contenido_litros IS NOT NULL)
);
CREATE INDEX idx_ficha_tipo ON producto_ficha_tecnica(tipo_producto);

CREATE TRIGGER trg_auditar_ficha AFTER INSERT OR UPDATE OR DELETE ON producto_ficha_tecnica
FOR EACH ROW EXECUTE FUNCTION fn_auditar();

-- ---------------------------------------------------------------------------
-- Cotizaciones. No reservan ni descuentan inventario. Guardan una instantánea
-- de nombre, marca, presentación, unidad y precio para conservar el documento.
-- ---------------------------------------------------------------------------
CREATE TYPE estado_cotizacion AS ENUM ('emitida', 'aceptada', 'anulada');

CREATE TABLE cotizacion (
    id BIGSERIAL PRIMARY KEY,
    numero VARCHAR(30) NOT NULL UNIQUE,
    cliente_id BIGINT REFERENCES tercero(id),
    usuario_id BIGINT NOT NULL REFERENCES usuario(id),
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    vence_en TIMESTAMPTZ NOT NULL,
    estado estado_cotizacion NOT NULL DEFAULT 'emitida',
    tipo VARCHAR(20) NOT NULL DEFAULT 'general' CHECK (tipo IN ('general', 'pintura')),
    origen VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'asistente')),
    descripcion_proyecto TEXT,
    area_m2 NUMERIC(12,2) CHECK (area_m2 >= 0),
    manos SMALLINT CHECK (manos BETWEEN 1 AND 5),
    parametros JSONB NOT NULL DEFAULT '{}'::JSONB,
    supuestos JSONB NOT NULL DEFAULT '[]'::JSONB,
    advertencias JSONB NOT NULL DEFAULT '[]'::JSONB,
    observaciones TEXT,
    total NUMERIC(14,2) NOT NULL CHECK (total >= 0),
    total_disponible NUMERIC(14,2) NOT NULL CHECK (total_disponible >= 0),
    motivo_estado VARCHAR(200),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_vigencia_cotizacion CHECK (vence_en > creada_en),
    CONSTRAINT chk_total_disponible CHECK (total_disponible <= total)
);
CREATE INDEX idx_cotizacion_usuario_fecha ON cotizacion(usuario_id, creada_en DESC);
CREATE INDEX idx_cotizacion_cliente ON cotizacion(cliente_id);

CREATE TABLE cotizacion_detalle (
    id BIGSERIAL PRIMARY KEY,
    cotizacion_id BIGINT NOT NULL REFERENCES cotizacion(id),
    linea SMALLINT NOT NULL CHECK (linea > 0),
    producto_id BIGINT NOT NULL REFERENCES producto(id),
    rol VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (rol IN ('pintura', 'auxiliar', 'manual')),
    codigo_barras VARCHAR(50) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    marca VARCHAR(100) NOT NULL,
    presentacion VARCHAR(100) NOT NULL,
    unidad_codigo VARCHAR(10) NOT NULL,
    cantidad_necesaria NUMERIC(14,4) CHECK (cantidad_necesaria >= 0),
    unidad_necesaria VARCHAR(20),
    cantidad NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
    cantidad_base NUMERIC(14,4) NOT NULL CHECK (cantidad_base > 0),
    precio_unitario NUMERIC(14,2) NOT NULL CHECK (precio_unitario >= 0),
    subtotal NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    disponible_al_cotizar NUMERIC(14,4) NOT NULL CHECK (disponible_al_cotizar >= 0),
    disponibilidad VARCHAR(20) NOT NULL CHECK (disponibilidad IN ('disponible', 'insuficiente', 'agotado')),
    UNIQUE (cotizacion_id, linea)
);
CREATE INDEX idx_cotizacion_detalle_cotizacion ON cotizacion_detalle(cotizacion_id);

CREATE TRIGGER trg_proteger_cotizacion_detalle BEFORE UPDATE OR DELETE ON cotizacion_detalle
FOR EACH ROW EXECUTE FUNCTION fn_proteger_inmutable();

-- Una cotización emitida solo admite cambio de estado y observaciones.
CREATE OR REPLACE FUNCTION fn_proteger_cotizacion()
RETURNS TRIGGER AS $$
DECLARE
    v_permitidas TEXT[] := ARRAY['estado', 'motivo_estado', 'observaciones', 'actualizado_en'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Las cotizaciones no se eliminan; se anulan' USING ERRCODE = 'P0001';
    END IF;
    IF (to_jsonb(OLD) - v_permitidas) <> (to_jsonb(NEW) - v_permitidas) THEN
        RAISE EXCEPTION 'Una cotización guardada no se modifica; cree una nueva' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.estado <> 'emitida' AND NEW.estado <> OLD.estado THEN
        RAISE EXCEPTION 'La cotización % ya está %', OLD.numero, OLD.estado USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proteger_cotizacion BEFORE UPDATE OR DELETE ON cotizacion
FOR EACH ROW EXECUTE FUNCTION fn_proteger_cotizacion();
CREATE TRIGGER trg_auditar_cotizacion AFTER INSERT OR UPDATE ON cotizacion
FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_cotizacion_detalle AFTER INSERT ON cotizacion_detalle
FOR EACH ROW EXECUTE FUNCTION fn_auditar();

-- ---------------------------------------------------------------------------
-- Conversaciones del asistente. El usuario se toma de la sesión, nunca del cliente.
-- ---------------------------------------------------------------------------
CREATE TABLE ia_conversacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id BIGINT NOT NULL REFERENCES usuario(id),
    titulo VARCHAR(120),
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ia_conversacion_usuario ON ia_conversacion(usuario_id, actualizada_en DESC);

CREATE TABLE ia_mensaje (
    id BIGSERIAL PRIMARY KEY,
    conversacion_id UUID NOT NULL REFERENCES ia_conversacion(id) ON DELETE CASCADE,
    rol VARCHAR(10) NOT NULL CHECK (rol IN ('user', 'assistant', 'tool')),
    contenido TEXT NOT NULL,
    tool_name VARCHAR(60),
    tool_calls JSONB,
    metadata JSONB,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ia_mensaje_conversacion ON ia_mensaje(conversacion_id, id);

-- ---------------------------------------------------------------------------
-- Importación desde Excel: lote de importación + columnas de control en staging.
-- ---------------------------------------------------------------------------
CREATE TABLE importacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('productos', 'terceros', 'saldos')),
    nombre_archivo VARCHAR(200),
    fecha_corte DATE,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id),
    estado VARCHAR(20) NOT NULL DEFAULT 'validada' CHECK (estado IN ('validada', 'cargada')),
    filas_validas INTEGER NOT NULL DEFAULT 0,
    filas_invalidas INTEGER NOT NULL DEFAULT 0,
    filas_cargadas INTEGER NOT NULL DEFAULT 0,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    cargada_en TIMESTAMPTZ
);

ALTER TABLE staging_producto
    ADD COLUMN importacion_id UUID REFERENCES importacion(id),
    ADD COLUMN descripcion TEXT,
    ADD COLUMN categoria VARCHAR(100),
    ADD COLUMN decimales_permitidos SMALLINT,
    ADD COLUMN controla_vencimiento BOOLEAN,
    ADD COLUMN controla_garantia BOOLEAN;
ALTER TABLE staging_tercero ADD COLUMN importacion_id UUID REFERENCES importacion(id);
ALTER TABLE staging_saldo_inicial
    ADD COLUMN importacion_id UUID REFERENCES importacion(id),
    ADD COLUMN referencia_garantia VARCHAR(100);

CREATE INDEX idx_staging_producto_imp ON staging_producto(importacion_id);
CREATE INDEX idx_staging_tercero_imp ON staging_tercero(importacion_id);
CREATE INDEX idx_staging_saldo_imp ON staging_saldo_inicial(importacion_id);

-- Saldo inicial (DP-15): entra como disponible con documento 'saldo_inicial' y,
-- si el estado de origen es reservada o dañada, se redistribuye con un cambio de estado.
CREATE OR REPLACE FUNCTION fn_aplicar_saldo_inicial(
    p_producto_id BIGINT,
    p_cantidad_base NUMERIC,
    p_costo_base NUMERIC,
    p_estado estado_existencia,
    p_fecha_vencimiento DATE,
    p_referencia_garantia VARCHAR(100),
    p_usuario_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_unidad_base BIGINT;
    v_lote_id BIGINT;
    v_vence BOOLEAN;
    v_garantia BOOLEAN;
BEGIN
    SELECT unidad_base_id, controla_vencimiento, controla_garantia
      INTO v_unidad_base, v_vence, v_garantia
      FROM producto WHERE id = p_producto_id;
    IF v_unidad_base IS NULL THEN
        RAISE EXCEPTION 'Producto % no existe', p_producto_id USING ERRCODE = 'P0001';
    END IF;
    IF v_vence AND p_fecha_vencimiento IS NULL THEN
        RAISE EXCEPTION 'El producto % requiere fecha de vencimiento', p_producto_id USING ERRCODE = 'P0001';
    END IF;
    IF v_garantia AND NULLIF(trim(p_referencia_garantia), '') IS NULL THEN
        RAISE EXCEPTION 'El producto % requiere referencia de garantía', p_producto_id USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO lote(producto_id, cantidad_recibida, cantidad_disponible, costo_unitario, fecha_vencimiento, referencia_garantia)
    VALUES (p_producto_id, p_cantidad_base, 0, p_costo_base, p_fecha_vencimiento, p_referencia_garantia)
    RETURNING id INTO v_lote_id;

    PERFORM fn_aplicar_entrada_compra(p_producto_id, p_cantidad_base, v_unidad_base, p_costo_base,
                                      v_lote_id, p_usuario_id, NULL, 'online', NULL, 'saldo_inicial');

    IF p_estado <> 'disponible' THEN
        PERFORM fn_cambiar_estado_existencia(p_producto_id, 'disponible', p_estado, p_cantidad_base,
                                             p_usuario_id, 'Saldo inicial importado en estado ' || p_estado);
    END IF;
    RETURN v_lote_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Integración y sincronización offline: resultado y error del evento.
-- ---------------------------------------------------------------------------
-- Motivo opcional del precio manual (RF-PRE-002; obligatoriedad por definir).
ALTER TABLE precio_historial ADD COLUMN motivo VARCHAR(200);

ALTER TABLE integracion_evento
    ADD COLUMN resultado JSONB,
    ADD COLUMN mensaje_error TEXT,
    ADD COLUMN intentos INTEGER NOT NULL DEFAULT 1;
