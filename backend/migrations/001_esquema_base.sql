-- Migración 001: esquema base tomado de 04_modelo_datos_ferreteria.sql (sin BEGIN/COMMIT; el runner abre la transacción).
-- ============================================================================
-- MODELO DE DATOS — Sistema de Inventario de Ferretería
-- Motor objetivo: PostgreSQL 14 o superior
-- Ejecutar primero este archivo y después seed_datos_prueba.sql.
-- ============================================================================


CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE tipo_persona AS ENUM ('natural', 'juridica');
CREATE TYPE tipo_documento AS ENUM ('cedula', 'nit');
CREATE TYPE estado_existencia AS ENUM ('disponible', 'reservada', 'danada');
CREATE TYPE tipo_movimiento AS ENUM ('entrada_compra', 'salida_venta', 'cambio_estado');
CREATE TYPE canal_operacion AS ENUM ('online', 'offline');
CREATE TYPE estado_documento AS ENUM ('confirmado', 'anulado');
CREATE TYPE estado_cierre AS ENUM ('cerrado', 'reabierto');
CREATE TYPE tipo_unidad_conv AS ENUM ('compra', 'venta');
CREATE TYPE estado_integracion AS ENUM ('pendiente', 'aplicado', 'error', 'pendiente_conflicto');

-- ============================================================================
-- CATÁLOGOS Y SEGURIDAD
-- ============================================================================

CREATE TABLE unidad_medida (
    id BIGSERIAL PRIMARY KEY,
    codigo VARCHAR(10) NOT NULL UNIQUE,
    nombre VARCHAR(50) NOT NULL,
    permite_decimal BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE marca (
    id BIGSERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE categoria (
    id BIGSERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    categoria_padre_id BIGINT REFERENCES categoria(id),
    UNIQUE (nombre, categoria_padre_id)
);

CREATE TABLE usuario (
    id BIGSERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    correo VARCHAR(120) NOT NULL UNIQUE,
    hash_password VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rol (
    id BIGSERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(200)
);

CREATE TABLE permiso (
    id BIGSERIAL PRIMARY KEY,
    codigo VARCHAR(60) NOT NULL UNIQUE,
    descripcion VARCHAR(200)
);

CREATE TABLE rol_permiso (
    rol_id BIGINT NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
    permiso_id BIGINT NOT NULL REFERENCES permiso(id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE usuario_rol (
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    rol_id BIGINT NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, rol_id)
);

-- ============================================================================
-- PRODUCTOS, CONVERSIONES, TERCEROS Y EXISTENCIAS
-- ============================================================================

CREATE TABLE producto (
    id BIGSERIAL PRIMARY KEY,
    codigo_barras VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    marca_id BIGINT NOT NULL REFERENCES marca(id),
    presentacion VARCHAR(100) NOT NULL,
    categoria_id BIGINT REFERENCES categoria(id),
    unidad_base_id BIGINT NOT NULL REFERENCES unidad_medida(id),
    decimales_permitidos SMALLINT NOT NULL DEFAULT 0 CHECK (decimales_permitidos BETWEEN 0 AND 4),
    controla_vencimiento BOOLEAN NOT NULL DEFAULT FALSE,
    controla_garantia BOOLEAN NOT NULL DEFAULT FALSE,
    porcentaje_incremento NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (porcentaje_incremento >= 0),
    stock_minimo NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_producto_marca ON producto(marca_id);
CREATE INDEX idx_producto_categoria ON producto(categoria_id);
CREATE INDEX idx_producto_activo ON producto(activo);

CREATE TABLE unidad_conversion (
    id BIGSERIAL PRIMARY KEY,
    producto_id BIGINT NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
    unidad_id BIGINT NOT NULL REFERENCES unidad_medida(id),
    tipo tipo_unidad_conv NOT NULL,
    factor_a_base NUMERIC(14,6) NOT NULL CHECK (factor_a_base > 0),
    UNIQUE (producto_id, unidad_id, tipo)
);

CREATE TABLE tercero (
    id BIGSERIAL PRIMARY KEY,
    tipo_persona tipo_persona NOT NULL,
    tipo_documento tipo_documento NOT NULL,
    numero_documento VARCHAR(30) NOT NULL,
    nombre VARCHAR(100),
    apellido VARCHAR(100),
    razon_social VARCHAR(200),
    direccion VARCHAR(200),
    telefono VARCHAR(30),
    correo VARCHAR(120),
    es_cliente BOOLEAN NOT NULL DEFAULT FALSE,
    es_proveedor BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tipo_documento, numero_documento),
    CONSTRAINT chk_persona_natural CHECK (
        tipo_persona <> 'natural' OR (nombre IS NOT NULL AND apellido IS NOT NULL)
    ),
    CONSTRAINT chk_persona_juridica CHECK (
        tipo_persona <> 'juridica' OR razon_social IS NOT NULL
    ),
    CONSTRAINT chk_al_menos_un_rol CHECK (es_cliente OR es_proveedor)
);

CREATE INDEX idx_tercero_documento ON tercero(numero_documento);

CREATE TABLE lote (
    id BIGSERIAL PRIMARY KEY,
    producto_id BIGINT NOT NULL REFERENCES producto(id),
    cantidad_recibida NUMERIC(14,4) NOT NULL CHECK (cantidad_recibida > 0),
    cantidad_disponible NUMERIC(14,4) NOT NULL CHECK (cantidad_disponible >= 0),
    costo_unitario NUMERIC(14,4) NOT NULL CHECK (costo_unitario >= 0),
    fecha_vencimiento DATE,
    referencia_garantia VARCHAR(100),
    fecha_ingreso TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_disponible_le_recibida CHECK (cantidad_disponible <= cantidad_recibida)
);

CREATE INDEX idx_lote_producto_fecha ON lote(producto_id, fecha_ingreso, id);
CREATE INDEX idx_lote_vencimiento ON lote(fecha_vencimiento) WHERE fecha_vencimiento IS NOT NULL;

CREATE TABLE existencia (
    producto_id BIGINT NOT NULL REFERENCES producto(id),
    estado estado_existencia NOT NULL,
    cantidad NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
    PRIMARY KEY (producto_id, estado)
);

CREATE TABLE precio_historial (
    id BIGSERIAL PRIMARY KEY,
    producto_id BIGINT NOT NULL REFERENCES producto(id),
    costo_promedio NUMERIC(14,4) NOT NULL CHECK (costo_promedio >= 0),
    porcentaje_incremento NUMERIC(6,3) NOT NULL CHECK (porcentaje_incremento >= 0),
    precio_calculado NUMERIC(14,2) NOT NULL CHECK (precio_calculado >= 0),
    precio_manual NUMERIC(14,2) CHECK (precio_manual >= 0),
    vigente_desde TIMESTAMPTZ NOT NULL DEFAULT now(),
    vigente_hasta TIMESTAMPTZ,
    usuario_id BIGINT REFERENCES usuario(id),
    CONSTRAINT chk_vigencia_precio CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE UNIQUE INDEX uq_precio_historial_vigente
    ON precio_historial(producto_id) WHERE vigente_hasta IS NULL;
CREATE INDEX idx_precio_producto_vigencia ON precio_historial(producto_id, vigente_desde DESC);

-- ============================================================================
-- DOCUMENTOS, MOVIMIENTOS, CIERRES, AUDITORÍA E INTEGRACIÓN
-- ============================================================================

CREATE TABLE compra (
    id BIGSERIAL PRIMARY KEY,
    numero VARCHAR(30) NOT NULL UNIQUE,
    proveedor_id BIGINT NOT NULL REFERENCES tercero(id),
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    usuario_id BIGINT NOT NULL REFERENCES usuario(id),
    estado estado_documento NOT NULL DEFAULT 'confirmado',
    total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0)
);

CREATE TABLE compra_detalle (
    id BIGSERIAL PRIMARY KEY,
    compra_id BIGINT NOT NULL REFERENCES compra(id) ON DELETE CASCADE,
    producto_id BIGINT NOT NULL REFERENCES producto(id),
    cantidad NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
    unidad_id BIGINT NOT NULL REFERENCES unidad_medida(id),
    costo_unitario NUMERIC(14,4) NOT NULL CHECK (costo_unitario >= 0),
    subtotal NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    lote_id BIGINT REFERENCES lote(id),
    fecha_vencimiento DATE,
    referencia_garantia VARCHAR(100)
);

CREATE INDEX idx_compra_detalle_compra ON compra_detalle(compra_id);
CREATE INDEX idx_compra_proveedor ON compra(proveedor_id);
CREATE INDEX idx_compra_fecha ON compra(fecha);

CREATE TABLE venta (
    id BIGSERIAL PRIMARY KEY,
    numero VARCHAR(30) NOT NULL UNIQUE,
    cliente_id BIGINT NOT NULL REFERENCES tercero(id),
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    usuario_id BIGINT NOT NULL REFERENCES usuario(id),
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    impuesto NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (impuesto >= 0),
    total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    medio_pago VARCHAR(30),
    estado estado_documento NOT NULL DEFAULT 'confirmado',
    canal canal_operacion NOT NULL DEFAULT 'online',
    uuid_offline UUID UNIQUE
);

CREATE TABLE venta_detalle (
    id BIGSERIAL PRIMARY KEY,
    venta_id BIGINT NOT NULL REFERENCES venta(id) ON DELETE CASCADE,
    producto_id BIGINT NOT NULL REFERENCES producto(id),
    cantidad NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
    unidad_id BIGINT NOT NULL REFERENCES unidad_medida(id),
    precio_unitario NUMERIC(14,4) NOT NULL CHECK (precio_unitario >= 0),
    subtotal NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    lote_id BIGINT REFERENCES lote(id)
);

CREATE INDEX idx_venta_detalle_venta ON venta_detalle(venta_id);
CREATE INDEX idx_venta_cliente ON venta(cliente_id);
CREATE INDEX idx_venta_fecha ON venta(fecha);

CREATE TABLE movimiento_inventario (
    id BIGSERIAL PRIMARY KEY,
    producto_id BIGINT NOT NULL REFERENCES producto(id),
    tipo tipo_movimiento NOT NULL,
    cantidad NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
    estado_origen estado_existencia,
    estado_destino estado_existencia,
    lote_id BIGINT REFERENCES lote(id),
    documento_tipo VARCHAR(30),
    documento_id BIGINT,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id),
    fecha_hora TIMESTAMPTZ NOT NULL DEFAULT now(),
    canal canal_operacion NOT NULL DEFAULT 'online',
    uuid_offline UUID UNIQUE,
    motivo VARCHAR(200),
    CONSTRAINT chk_movimiento_estados CHECK (
        (tipo = 'entrada_compra' AND estado_origen IS NULL AND estado_destino = 'disponible') OR
        (tipo = 'salida_venta' AND estado_origen = 'disponible' AND estado_destino IS NULL) OR
        (tipo = 'cambio_estado' AND estado_origen IS NOT NULL AND estado_destino IS NOT NULL AND estado_origen <> estado_destino)
    )
);

CREATE INDEX idx_movimiento_producto_fecha ON movimiento_inventario(producto_id, fecha_hora);
CREATE INDEX idx_movimiento_tipo ON movimiento_inventario(tipo);

CREATE TABLE cierre_mensual (
    id BIGSERIAL PRIMARY KEY,
    periodo CHAR(7) NOT NULL UNIQUE CHECK (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
    fecha_ejecucion TIMESTAMPTZ NOT NULL DEFAULT now(),
    usuario_id BIGINT NOT NULL REFERENCES usuario(id),
    valor_total_inventario NUMERIC(16,2) NOT NULL CHECK (valor_total_inventario >= 0),
    estado estado_cierre NOT NULL DEFAULT 'cerrado',
    observaciones TEXT
);

CREATE TABLE cierre_mensual_detalle (
    id BIGSERIAL PRIMARY KEY,
    cierre_id BIGINT NOT NULL REFERENCES cierre_mensual(id) ON DELETE CASCADE,
    producto_id BIGINT NOT NULL REFERENCES producto(id),
    estado estado_existencia NOT NULL,
    cantidad NUMERIC(14,4) NOT NULL CHECK (cantidad >= 0),
    costo_promedio NUMERIC(14,4) NOT NULL CHECK (costo_promedio >= 0),
    valor_total NUMERIC(16,2) NOT NULL CHECK (valor_total >= 0),
    UNIQUE (cierre_id, producto_id, estado)
);

CREATE TABLE auditoria (
    id BIGSERIAL PRIMARY KEY,
    tabla_afectada VARCHAR(60) NOT NULL,
    registro_id VARCHAR(100) NOT NULL,
    accion VARCHAR(20) NOT NULL CHECK (accion IN ('insert', 'update', 'delete')),
    valores_antes JSONB,
    valores_despues JSONB,
    usuario_id BIGINT REFERENCES usuario(id),
    fecha_hora TIMESTAMPTZ NOT NULL DEFAULT now(),
    origen canal_operacion NOT NULL DEFAULT 'online'
);

CREATE INDEX idx_auditoria_tabla_fecha ON auditoria(tabla_afectada, fecha_hora);
CREATE INDEX idx_auditoria_usuario_fecha ON auditoria(usuario_id, fecha_hora);

CREATE TABLE integracion_evento (
    id BIGSERIAL PRIMARY KEY,
    sistema_origen VARCHAR(60) NOT NULL,
    tipo_evento VARCHAR(60) NOT NULL,
    identificador_externo VARCHAR(100) NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    estado estado_integracion NOT NULL DEFAULT 'pendiente',
    fecha_recibido TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_aplicado TIMESTAMPTZ
);

CREATE TABLE staging_producto (
    fila_origen INTEGER,
    codigo_barras VARCHAR(50),
    nombre VARCHAR(150),
    marca VARCHAR(100),
    presentacion VARCHAR(100),
    unidad_base VARCHAR(10),
    costo_inicial NUMERIC(14,4),
    porcentaje_incremento NUMERIC(6,3),
    stock_minimo NUMERIC(14,4),
    error_validacion TEXT
);

CREATE TABLE staging_tercero (
    fila_origen INTEGER,
    tipo_persona VARCHAR(10),
    tipo_documento VARCHAR(10),
    numero_documento VARCHAR(30),
    nombre VARCHAR(100),
    apellido VARCHAR(100),
    razon_social VARCHAR(200),
    direccion VARCHAR(200),
    telefono VARCHAR(30),
    correo VARCHAR(120),
    es_cliente BOOLEAN,
    es_proveedor BOOLEAN,
    error_validacion TEXT
);

CREATE TABLE staging_saldo_inicial (
    fila_origen INTEGER,
    codigo_barras VARCHAR(50),
    cantidad NUMERIC(14,4),
    estado VARCHAR(20),
    costo_unitario NUMERIC(14,4),
    fecha_vencimiento DATE,
    error_validacion TEXT
);

-- ============================================================================
-- FUNCIONES DE APOYO
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_usuario_auditoria()
RETURNS BIGINT AS $$
DECLARE
    v_usuario TEXT;
BEGIN
    v_usuario := current_setting('app.usuario_id', true);
    IF v_usuario IS NULL OR v_usuario = '' THEN
        RETURN NULL;
    END IF;
    RETURN v_usuario::BIGINT;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_origen_auditoria()
RETURNS canal_operacion AS $$
DECLARE
    v_origen TEXT;
BEGIN
    v_origen := current_setting('app.origen', true);
    IF v_origen = 'offline' THEN
        RETURN 'offline'::canal_operacion;
    END IF;
    RETURN 'online'::canal_operacion;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_periodo_cerrado(p_fecha TIMESTAMPTZ)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM cierre_mensual
        WHERE periodo = to_char(p_fecha, 'YYYY-MM')
          AND estado = 'cerrado'
    );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_validar_periodo_abierto()
RETURNS TRIGGER AS $$
DECLARE
    v_fecha TIMESTAMPTZ;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;
    v_fecha := CASE
        WHEN TG_TABLE_NAME = 'movimiento_inventario' THEN NEW.fecha_hora
        ELSE NEW.fecha
    END;
    IF fn_periodo_cerrado(v_fecha) THEN
        RAISE EXCEPTION 'El período % está cerrado', to_char(v_fecha, 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_validar_rol_tercero()
RETURNS TRIGGER AS $$
DECLARE
    v_valido BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'compra' THEN
        SELECT es_proveedor AND activo INTO v_valido FROM tercero WHERE id = NEW.proveedor_id;
        IF COALESCE(v_valido, FALSE) = FALSE THEN
            RAISE EXCEPTION 'El tercero % no es un proveedor activo', NEW.proveedor_id USING ERRCODE = 'P0001';
        END IF;
    ELSIF TG_TABLE_NAME = 'venta' THEN
        SELECT es_cliente AND activo INTO v_valido FROM tercero WHERE id = NEW.cliente_id;
        IF COALESCE(v_valido, FALSE) = FALSE THEN
            RAISE EXCEPTION 'El tercero % no es un cliente activo', NEW.cliente_id USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_validar_detalle_compra()
RETURNS TRIGGER AS $$
DECLARE
    v_controla_vencimiento BOOLEAN;
    v_controla_garantia BOOLEAN;
BEGIN
    SELECT controla_vencimiento, controla_garantia
      INTO v_controla_vencimiento, v_controla_garantia
      FROM producto
     WHERE id = NEW.producto_id;

    IF COALESCE(v_controla_vencimiento, FALSE) AND NEW.fecha_vencimiento IS NULL THEN
        RAISE EXCEPTION 'El producto % requiere fecha de vencimiento', NEW.producto_id USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_controla_garantia, FALSE) AND NULLIF(trim(NEW.referencia_garantia), '') IS NULL THEN
        RAISE EXCEPTION 'El producto % requiere referencia de garantía', NEW.producto_id USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_convertir_a_base(
    p_producto_id BIGINT,
    p_unidad_id BIGINT,
    p_tipo tipo_unidad_conv,
    p_cantidad NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
    v_unidad_base BIGINT;
    v_factor NUMERIC(14,6);
    v_decimales SMALLINT;
    v_resultado NUMERIC(14,4);
BEGIN
    IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor que cero' USING ERRCODE = 'P0001';
    END IF;

    SELECT unidad_base_id, decimales_permitidos
      INTO v_unidad_base, v_decimales
      FROM producto
     WHERE id = p_producto_id;

    IF v_unidad_base IS NULL THEN
        RAISE EXCEPTION 'Producto % no existe', p_producto_id USING ERRCODE = 'P0001';
    END IF;

    IF p_unidad_id = v_unidad_base THEN
        v_factor := 1;
    ELSE
        SELECT factor_a_base
          INTO v_factor
          FROM unidad_conversion
         WHERE producto_id = p_producto_id
           AND unidad_id = p_unidad_id
           AND tipo = p_tipo;
    END IF;

    IF v_factor IS NULL THEN
        RAISE EXCEPTION 'No existe conversión % para producto %, unidad %', p_tipo, p_producto_id, p_unidad_id USING ERRCODE = 'P0001';
    END IF;

    v_resultado := p_cantidad * v_factor;
    IF v_resultado <> round(v_resultado, v_decimales) THEN
        RAISE EXCEPTION 'La cantidad % excede los % decimales permitidos para producto %', v_resultado, v_decimales, p_producto_id USING ERRCODE = 'P0001';
    END IF;
    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_precio_vigente(p_producto_id BIGINT)
RETURNS NUMERIC AS $$
DECLARE
    v_precio NUMERIC;
BEGIN
    SELECT COALESCE(precio_manual, precio_calculado)
      INTO v_precio
      FROM precio_historial
     WHERE producto_id = p_producto_id
       AND vigente_hasta IS NULL
     ORDER BY vigente_desde DESC, id DESC
     LIMIT 1;
    RETURN v_precio;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_auditar()
RETURNS TRIGGER AS $$
DECLARE
    v_fila JSONB;
    v_registro_id TEXT;
BEGIN
    IF current_setting('app.suprimir_auditoria', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    v_fila := CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::JSONB ELSE row_to_json(NEW)::JSONB END;
    IF v_fila ? 'id' THEN
        v_registro_id := v_fila ->> 'id';
    ELSIF TG_TABLE_NAME = 'existencia' THEN
        v_registro_id := (v_fila ->> 'producto_id') || ':' || (v_fila ->> 'estado');
    ELSIF TG_TABLE_NAME = 'rol_permiso' THEN
        v_registro_id := (v_fila ->> 'rol_id') || ':' || (v_fila ->> 'permiso_id');
    ELSIF TG_TABLE_NAME = 'usuario_rol' THEN
        v_registro_id := (v_fila ->> 'usuario_id') || ':' || (v_fila ->> 'rol_id');
    ELSE
        v_registro_id := md5(v_fila::TEXT);
    END IF;

    INSERT INTO auditoria(tabla_afectada, registro_id, accion, valores_antes, valores_despues, usuario_id, origen)
    VALUES (
        TG_TABLE_NAME,
        v_registro_id,
        lower(TG_OP),
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD)::JSONB END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW)::JSONB END,
        fn_usuario_auditoria(),
        fn_origen_auditoria()
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_proteger_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'La tabla % es inmutable', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCIONES DE NEGOCIO
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_aplicar_entrada_compra(
    p_producto_id BIGINT,
    p_cantidad NUMERIC,
    p_unidad_id BIGINT,
    p_costo_unitario NUMERIC,
    p_lote_id BIGINT,
    p_usuario_id BIGINT,
    p_documento_id BIGINT,
    p_canal canal_operacion DEFAULT 'online',
    p_uuid_offline UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_cantidad_base NUMERIC(14,4);
    v_cantidad_anterior NUMERIC(14,4);
    v_costo_anterior NUMERIC(14,4);
    v_costo_nuevo NUMERIC(14,4);
    v_porcentaje NUMERIC(6,3);
    v_precio NUMERIC(14,2);
BEGIN
    IF p_costo_unitario < 0 THEN
        RAISE EXCEPTION 'El costo unitario no puede ser negativo' USING ERRCODE = 'P0001';
    END IF;

    v_cantidad_base := fn_convertir_a_base(p_producto_id, p_unidad_id, 'compra', p_cantidad);

    SELECT cantidad INTO v_cantidad_anterior
      FROM existencia
     WHERE producto_id = p_producto_id AND estado = 'disponible'
     FOR UPDATE;
    v_cantidad_anterior := COALESCE(v_cantidad_anterior, 0);

    SELECT costo_promedio INTO v_costo_anterior
      FROM precio_historial
     WHERE producto_id = p_producto_id AND vigente_hasta IS NULL
     ORDER BY vigente_desde DESC, id DESC LIMIT 1;
    v_costo_anterior := COALESCE(v_costo_anterior, p_costo_unitario);

    v_costo_nuevo := ((v_cantidad_anterior * v_costo_anterior) + (v_cantidad_base * p_costo_unitario))
        / NULLIF(v_cantidad_anterior + v_cantidad_base, 0);

    INSERT INTO existencia(producto_id, estado, cantidad)
    VALUES (p_producto_id, 'disponible', v_cantidad_base)
    ON CONFLICT (producto_id, estado)
    DO UPDATE SET cantidad = existencia.cantidad + EXCLUDED.cantidad;

    UPDATE lote
       SET cantidad_disponible = cantidad_disponible + v_cantidad_base
     WHERE id = p_lote_id
       AND producto_id = p_producto_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El lote % no pertenece al producto %', p_lote_id, p_producto_id USING ERRCODE = 'P0001';
    END IF;

    SELECT porcentaje_incremento INTO v_porcentaje FROM producto WHERE id = p_producto_id;
    v_precio := round(v_costo_nuevo * (1 + v_porcentaje / 100), 2);

    UPDATE precio_historial
       SET vigente_hasta = now()
     WHERE producto_id = p_producto_id AND vigente_hasta IS NULL;

    INSERT INTO precio_historial(producto_id, costo_promedio, porcentaje_incremento, precio_calculado, usuario_id)
    VALUES (p_producto_id, v_costo_nuevo, v_porcentaje, v_precio, p_usuario_id);

    INSERT INTO movimiento_inventario(
        producto_id, tipo, cantidad, estado_origen, estado_destino, lote_id,
        documento_tipo, documento_id, usuario_id, canal, uuid_offline
    ) VALUES (
        p_producto_id, 'entrada_compra', v_cantidad_base, NULL, 'disponible', p_lote_id,
        'compra', p_documento_id, p_usuario_id, p_canal, p_uuid_offline
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_consumir_lotes_fifo(
    p_producto_id BIGINT,
    p_cantidad NUMERIC
) RETURNS VOID AS $$
DECLARE
    v_lote RECORD;
    v_pendiente NUMERIC(14,4) := p_cantidad;
    v_tomar NUMERIC(14,4);
BEGIN
    FOR v_lote IN
        SELECT id, cantidad_disponible
          FROM lote
         WHERE producto_id = p_producto_id
           AND cantidad_disponible > 0
         ORDER BY fecha_ingreso, id
         FOR UPDATE
    LOOP
        EXIT WHEN v_pendiente <= 0;
        v_tomar := LEAST(v_lote.cantidad_disponible, v_pendiente);
        UPDATE lote SET cantidad_disponible = cantidad_disponible - v_tomar WHERE id = v_lote.id;
        v_pendiente := v_pendiente - v_tomar;
    END LOOP;

    IF v_pendiente > 0 THEN
        RAISE EXCEPTION 'No hay lotes suficientes para producto %', p_producto_id USING ERRCODE = 'P0001';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_aplicar_salida_venta(
    p_producto_id BIGINT,
    p_cantidad NUMERIC,
    p_unidad_id BIGINT,
    p_lote_id BIGINT,
    p_usuario_id BIGINT,
    p_documento_id BIGINT,
    p_canal canal_operacion DEFAULT 'online',
    p_uuid_offline UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_cantidad_base NUMERIC(14,4);
    v_disponible NUMERIC(14,4);
    v_lote_disponible NUMERIC(14,4);
BEGIN
    v_cantidad_base := fn_convertir_a_base(p_producto_id, p_unidad_id, 'venta', p_cantidad);

    SELECT cantidad INTO v_disponible
      FROM existencia
     WHERE producto_id = p_producto_id AND estado = 'disponible'
     FOR UPDATE;

    IF v_disponible IS NULL OR v_disponible < v_cantidad_base THEN
        RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, solicitado: %)',
            p_producto_id, COALESCE(v_disponible, 0), v_cantidad_base USING ERRCODE = 'P0001';
    END IF;

    IF p_lote_id IS NOT NULL THEN
        SELECT cantidad_disponible INTO v_lote_disponible
          FROM lote
         WHERE id = p_lote_id AND producto_id = p_producto_id
         FOR UPDATE;
        IF v_lote_disponible IS NULL OR v_lote_disponible < v_cantidad_base THEN
            RAISE EXCEPTION 'Lote % insuficiente para producto %', p_lote_id, p_producto_id USING ERRCODE = 'P0001';
        END IF;
        UPDATE lote SET cantidad_disponible = cantidad_disponible - v_cantidad_base WHERE id = p_lote_id;
    ELSE
        PERFORM fn_consumir_lotes_fifo(p_producto_id, v_cantidad_base);
    END IF;

    UPDATE existencia
       SET cantidad = cantidad - v_cantidad_base
     WHERE producto_id = p_producto_id AND estado = 'disponible';

    INSERT INTO movimiento_inventario(
        producto_id, tipo, cantidad, estado_origen, estado_destino, lote_id,
        documento_tipo, documento_id, usuario_id, canal, uuid_offline
    ) VALUES (
        p_producto_id, 'salida_venta', v_cantidad_base, 'disponible', NULL, p_lote_id,
        'venta', p_documento_id, p_usuario_id, p_canal, p_uuid_offline
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_cambiar_estado_existencia(
    p_producto_id BIGINT,
    p_estado_origen estado_existencia,
    p_estado_destino estado_existencia,
    p_cantidad NUMERIC,
    p_usuario_id BIGINT,
    p_motivo VARCHAR(200)
) RETURNS VOID AS $$
DECLARE
    v_origen NUMERIC(14,4);
BEGIN
    IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor que cero' USING ERRCODE = 'P0001';
    END IF;
    IF p_estado_origen = p_estado_destino THEN
        RAISE EXCEPTION 'El estado de origen y destino deben ser distintos' USING ERRCODE = 'P0001';
    END IF;
    IF NULLIF(trim(p_motivo), '') IS NULL THEN
        RAISE EXCEPTION 'El motivo es obligatorio para cambiar estado' USING ERRCODE = 'P0001';
    END IF;

    SELECT cantidad INTO v_origen
      FROM existencia
     WHERE producto_id = p_producto_id AND estado = p_estado_origen
     FOR UPDATE;

    IF v_origen IS NULL OR v_origen < p_cantidad THEN
        RAISE EXCEPTION 'Saldo insuficiente en % para producto % (disponible: %, solicitado: %)',
            p_estado_origen, p_producto_id, COALESCE(v_origen, 0), p_cantidad USING ERRCODE = 'P0001';
    END IF;

    UPDATE existencia
       SET cantidad = cantidad - p_cantidad
     WHERE producto_id = p_producto_id AND estado = p_estado_origen;

    INSERT INTO existencia(producto_id, estado, cantidad)
    VALUES (p_producto_id, p_estado_destino, p_cantidad)
    ON CONFLICT (producto_id, estado)
    DO UPDATE SET cantidad = existencia.cantidad + EXCLUDED.cantidad;

    INSERT INTO movimiento_inventario(
        producto_id, tipo, cantidad, estado_origen, estado_destino,
        documento_tipo, usuario_id, motivo
    ) VALUES (
        p_producto_id, 'cambio_estado', p_cantidad, p_estado_origen, p_estado_destino,
        'ajuste_estado', p_usuario_id, p_motivo
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_registrar_precio_manual(
    p_producto_id BIGINT,
    p_precio_manual NUMERIC,
    p_usuario_id BIGINT
) RETURNS VOID AS $$
DECLARE
    v_costo NUMERIC(14,4);
    v_porcentaje NUMERIC(6,3);
    v_calculado NUMERIC(14,2);
BEGIN
    IF p_precio_manual IS NULL OR p_precio_manual < 0 THEN
        RAISE EXCEPTION 'El precio manual no puede ser negativo' USING ERRCODE = 'P0001';
    END IF;

    SELECT costo_promedio, porcentaje_incremento, precio_calculado
      INTO v_costo, v_porcentaje, v_calculado
      FROM precio_historial
     WHERE producto_id = p_producto_id AND vigente_hasta IS NULL
     ORDER BY vigente_desde DESC, id DESC LIMIT 1;

    IF v_costo IS NULL THEN
        RAISE EXCEPTION 'El producto % no tiene costo vigente', p_producto_id USING ERRCODE = 'P0001';
    END IF;

    UPDATE precio_historial SET vigente_hasta = now()
     WHERE producto_id = p_producto_id AND vigente_hasta IS NULL;

    INSERT INTO precio_historial(producto_id, costo_promedio, porcentaje_incremento, precio_calculado, precio_manual, usuario_id)
    VALUES (p_producto_id, v_costo, v_porcentaje, v_calculado, p_precio_manual, p_usuario_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_ejecutar_cierre_mensual(
    p_periodo CHAR(7),
    p_usuario_id BIGINT,
    p_observaciones TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_cierre_id BIGINT;
    v_valor_total NUMERIC(16,2);
BEGIN
    IF p_periodo !~ '^[0-9]{4}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'El período debe tener formato AAAA-MM' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM cierre_mensual WHERE periodo = p_periodo) THEN
        RAISE EXCEPTION 'El período % ya tiene cierre', p_periodo USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
        SELECT 1 FROM integracion_evento
         WHERE estado = 'pendiente_conflicto'
           AND to_char(fecha_recibido, 'YYYY-MM') = p_periodo
    ) THEN
        RAISE EXCEPTION 'Existen conflictos de integración pendientes para el período %', p_periodo USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(SUM(e.cantidad * COALESCE(ph.costo_promedio, 0)), 0)
      INTO v_valor_total
      FROM existencia e
      LEFT JOIN LATERAL (
          SELECT costo_promedio
            FROM precio_historial
           WHERE producto_id = e.producto_id
           ORDER BY vigente_desde DESC, id DESC
           LIMIT 1
      ) ph ON TRUE;

    INSERT INTO cierre_mensual(periodo, usuario_id, valor_total_inventario, observaciones)
    VALUES (p_periodo, p_usuario_id, v_valor_total, p_observaciones)
    RETURNING id INTO v_cierre_id;

    INSERT INTO cierre_mensual_detalle(cierre_id, producto_id, estado, cantidad, costo_promedio, valor_total)
    SELECT
        v_cierre_id,
        e.producto_id,
        e.estado,
        e.cantidad,
        COALESCE(ph.costo_promedio, 0),
        round(e.cantidad * COALESCE(ph.costo_promedio, 0), 2)
    FROM existencia e
    LEFT JOIN LATERAL (
        SELECT costo_promedio
          FROM precio_historial
         WHERE producto_id = e.producto_id
         ORDER BY vigente_desde DESC, id DESC
         LIMIT 1
    ) ph ON TRUE;

    RETURN v_cierre_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_anular_documento(
    p_tipo_documento VARCHAR(10),
    p_documento_id BIGINT,
    p_usuario_id BIGINT,
    p_motivo VARCHAR(200)
) RETURNS VOID AS $$
BEGIN
    IF NULLIF(trim(p_motivo), '') IS NULL THEN
        RAISE EXCEPTION 'El motivo de anulación es obligatorio' USING ERRCODE = 'P0001';
    END IF;

    IF p_tipo_documento = 'compra' THEN
        UPDATE compra SET estado = 'anulado' WHERE id = p_documento_id AND estado = 'confirmado';
    ELSIF p_tipo_documento = 'venta' THEN
        UPDATE venta SET estado = 'anulado' WHERE id = p_documento_id AND estado = 'confirmado';
    ELSE
        RAISE EXCEPTION 'Tipo de documento inválido: %', p_tipo_documento USING ERRCODE = 'P0001';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Documento confirmado no encontrado' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO integracion_evento(sistema_origen, tipo_evento, identificador_externo, payload, estado, fecha_aplicado)
    VALUES (
        'interno',
        'anulacion_' || p_tipo_documento,
        'anulacion-' || p_tipo_documento || '-' || p_documento_id || '-' || extract(epoch FROM clock_timestamp())::BIGINT,
        jsonb_build_object('documento_id', p_documento_id, 'usuario_id', p_usuario_id, 'motivo', p_motivo),
        'aplicado', now()
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS DE VALIDACIÓN
-- ============================================================================

CREATE TRIGGER trg_compra_periodo_abierto
BEFORE INSERT OR UPDATE ON compra
FOR EACH ROW EXECUTE FUNCTION fn_validar_periodo_abierto();

CREATE TRIGGER trg_venta_periodo_abierto
BEFORE INSERT OR UPDATE ON venta
FOR EACH ROW EXECUTE FUNCTION fn_validar_periodo_abierto();

CREATE TRIGGER trg_movimiento_periodo_abierto
BEFORE INSERT OR UPDATE ON movimiento_inventario
FOR EACH ROW EXECUTE FUNCTION fn_validar_periodo_abierto();

CREATE TRIGGER trg_compra_proveedor
BEFORE INSERT OR UPDATE ON compra
FOR EACH ROW EXECUTE FUNCTION fn_validar_rol_tercero();

CREATE TRIGGER trg_venta_cliente
BEFORE INSERT OR UPDATE ON venta
FOR EACH ROW EXECUTE FUNCTION fn_validar_rol_tercero();

CREATE TRIGGER trg_detalle_compra_lote
BEFORE INSERT OR UPDATE ON compra_detalle
FOR EACH ROW EXECUTE FUNCTION fn_validar_detalle_compra();

CREATE TRIGGER trg_proteger_auditoria
BEFORE UPDATE OR DELETE ON auditoria
FOR EACH ROW EXECUTE FUNCTION fn_proteger_inmutable();

CREATE TRIGGER trg_proteger_cierre
BEFORE UPDATE OR DELETE ON cierre_mensual
FOR EACH ROW EXECUTE FUNCTION fn_proteger_inmutable();

CREATE TRIGGER trg_proteger_cierre_detalle
BEFORE UPDATE OR DELETE ON cierre_mensual_detalle
FOR EACH ROW EXECUTE FUNCTION fn_proteger_inmutable();

-- ============================================================================
-- TRIGGERS DE AUDITORÍA
-- ============================================================================

CREATE TRIGGER trg_auditar_producto AFTER INSERT OR UPDATE OR DELETE ON producto FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_unidad_conversion AFTER INSERT OR UPDATE OR DELETE ON unidad_conversion FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_tercero AFTER INSERT OR UPDATE OR DELETE ON tercero FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_usuario AFTER INSERT OR UPDATE OR DELETE ON usuario FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_usuario_rol AFTER INSERT OR UPDATE OR DELETE ON usuario_rol FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_rol_permiso AFTER INSERT OR UPDATE OR DELETE ON rol_permiso FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_lote AFTER INSERT OR UPDATE OR DELETE ON lote FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_existencia AFTER INSERT OR UPDATE OR DELETE ON existencia FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_precio AFTER INSERT OR UPDATE OR DELETE ON precio_historial FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_compra AFTER INSERT OR UPDATE OR DELETE ON compra FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_compra_detalle AFTER INSERT OR UPDATE OR DELETE ON compra_detalle FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_venta AFTER INSERT OR UPDATE OR DELETE ON venta FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_venta_detalle AFTER INSERT OR UPDATE OR DELETE ON venta_detalle FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_movimiento AFTER INSERT OR UPDATE OR DELETE ON movimiento_inventario FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_cierre AFTER INSERT ON cierre_mensual FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_cierre_detalle AFTER INSERT ON cierre_mensual_detalle FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_integracion AFTER INSERT OR UPDATE OR DELETE ON integracion_evento FOR EACH ROW EXECUTE FUNCTION fn_auditar();

