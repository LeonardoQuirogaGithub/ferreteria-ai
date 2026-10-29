-- Migración 002: correcciones al esquema base y reglas de documentos.
-- Cubre hallazgos del plan de V&V: H-01/H-02 (auditoría inmutable incluso ante TRUNCATE),
-- RN-06 (documentos no se editan ni borran), RN-18 (usuarios no se borran), numeración única,
-- motivo de anulación (RF-DOC-001), sesiones de renovación (RF-SEG-001) y verificación kardex/saldos.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Envoltura IMMUTABLE de unaccent para poder indexar búsquedas sin tildes.
CREATE OR REPLACE FUNCTION f_unaccent(TEXT)
RETURNS TEXT AS $$
    SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE INDEX idx_producto_busqueda_trgm ON producto USING gin (f_unaccent(lower(nombre)) gin_trgm_ops);
CREATE INDEX idx_movimiento_fecha ON movimiento_inventario(fecha_hora);
CREATE INDEX idx_lote_producto_saldo ON lote(producto_id) WHERE cantidad_disponible > 0;

-- ---------------------------------------------------------------------------
-- Corrección: la versión original evaluaba NEW.fecha_hora y NEW.fecha dentro del mismo CASE;
-- PL/pgSQL resuelve ambos campos y falla en compra/venta ("el registro new no tiene fecha_hora").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validar_periodo_abierto()
RETURNS TRIGGER AS $$
DECLARE
    v_fecha TIMESTAMPTZ;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'movimiento_inventario' THEN
        v_fecha := NEW.fecha_hora;
    ELSE
        v_fecha := NEW.fecha;
    END IF;
    IF fn_periodo_cerrado(v_fecha) THEN
        RAISE EXCEPTION 'El período % está cerrado', to_char(v_fecha, 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Inmutabilidad reforzada (RNF-SEG-003): TRUNCATE también queda bloqueado.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_proteger_auditoria_truncate BEFORE TRUNCATE ON auditoria
FOR EACH STATEMENT EXECUTE FUNCTION fn_proteger_inmutable();
CREATE TRIGGER trg_proteger_cierre_truncate BEFORE TRUNCATE ON cierre_mensual
FOR EACH STATEMENT EXECUTE FUNCTION fn_proteger_inmutable();
CREATE TRIGGER trg_proteger_cierre_detalle_truncate BEFORE TRUNCATE ON cierre_mensual_detalle
FOR EACH STATEMENT EXECUTE FUNCTION fn_proteger_inmutable();

-- Detalles de documentos y kardex: solo inserción.
CREATE TRIGGER trg_proteger_compra_detalle BEFORE UPDATE OR DELETE ON compra_detalle
FOR EACH ROW EXECUTE FUNCTION fn_proteger_inmutable();
CREATE TRIGGER trg_proteger_venta_detalle BEFORE UPDATE OR DELETE ON venta_detalle
FOR EACH ROW EXECUTE FUNCTION fn_proteger_inmutable();
CREATE TRIGGER trg_proteger_movimiento BEFORE UPDATE OR DELETE ON movimiento_inventario
FOR EACH ROW EXECUTE FUNCTION fn_proteger_inmutable();

CREATE OR REPLACE FUNCTION fn_impedir_borrado()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Los registros de % no se eliminan; se desactivan o se anulan', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuario_sin_borrado BEFORE DELETE ON usuario FOR EACH ROW EXECUTE FUNCTION fn_impedir_borrado();
CREATE TRIGGER trg_tercero_sin_borrado BEFORE DELETE ON tercero FOR EACH ROW EXECUTE FUNCTION fn_impedir_borrado();
CREATE TRIGGER trg_producto_sin_borrado BEFORE DELETE ON producto FOR EACH ROW EXECUTE FUNCTION fn_impedir_borrado();
CREATE TRIGGER trg_lote_sin_borrado BEFORE DELETE ON lote FOR EACH ROW EXECUTE FUNCTION fn_impedir_borrado();

-- ---------------------------------------------------------------------------
-- Anulación con motivo y responsable (RF-DOC-001, RN-06).
-- ---------------------------------------------------------------------------
ALTER TABLE compra
    ADD COLUMN observaciones TEXT,
    ADD COLUMN motivo_anulacion VARCHAR(200),
    ADD COLUMN anulado_por BIGINT REFERENCES usuario(id),
    ADD COLUMN anulado_en TIMESTAMPTZ;

ALTER TABLE venta
    ADD COLUMN motivo_anulacion VARCHAR(200),
    ADD COLUMN anulado_por BIGINT REFERENCES usuario(id),
    ADD COLUMN anulado_en TIMESTAMPTZ;

-- Un documento confirmado solo admite el paso a "anulado"; nunca se borra.
CREATE OR REPLACE FUNCTION fn_proteger_documento()
RETURNS TRIGGER AS $$
DECLARE
    v_permitidas TEXT[] := ARRAY['estado', 'motivo_anulacion', 'anulado_por', 'anulado_en'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Los documentos de % no se eliminan; se anulan', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
    IF OLD.estado = 'anulado' THEN
        RAISE EXCEPTION 'El documento % ya está anulado', OLD.numero USING ERRCODE = 'P0001';
    END IF;
    IF (to_jsonb(OLD) - v_permitidas) <> (to_jsonb(NEW) - v_permitidas) OR NEW.estado <> 'anulado' THEN
        RAISE EXCEPTION 'Los documentos confirmados no se editan; solo se anulan' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proteger_compra BEFORE UPDATE OR DELETE ON compra
FOR EACH ROW EXECUTE FUNCTION fn_proteger_documento();
CREATE TRIGGER trg_proteger_venta BEFORE UPDATE OR DELETE ON venta
FOR EACH ROW EXECUTE FUNCTION fn_proteger_documento();

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

    -- DP-10: la anulación no revierte existencias hasta que el interesado defina la política.
    IF p_tipo_documento = 'compra' THEN
        UPDATE compra
           SET estado = 'anulado', motivo_anulacion = p_motivo, anulado_por = p_usuario_id, anulado_en = now()
         WHERE id = p_documento_id AND estado = 'confirmado';
    ELSIF p_tipo_documento = 'venta' THEN
        UPDATE venta
           SET estado = 'anulado', motivo_anulacion = p_motivo, anulado_por = p_usuario_id, anulado_en = now()
         WHERE id = p_documento_id AND estado = 'confirmado';
    ELSE
        RAISE EXCEPTION 'Tipo de documento inválido: %', p_tipo_documento USING ERRCODE = 'P0001';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Documento confirmado no encontrado' USING ERRCODE = 'P0001';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Numeración única de documentos (RN-12, RN-13).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE seq_documento_ingreso;
CREATE SEQUENCE seq_factura;
CREATE SEQUENCE seq_cotizacion;

CREATE OR REPLACE FUNCTION fn_siguiente_numero(p_tipo TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN CASE p_tipo
        WHEN 'compra' THEN 'ING-' || lpad(nextval('seq_documento_ingreso')::TEXT, 6, '0')
        WHEN 'venta' THEN 'FAC-' || lpad(nextval('seq_factura')::TEXT, 6, '0')
        WHEN 'cotizacion' THEN 'COT-' || lpad(nextval('seq_cotizacion')::TEXT, 6, '0')
    END;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Entrada de inventario parametrizada por tipo de documento (compra o saldo inicial).
-- Misma lógica de 04_modelo_datos_ferreteria.sql; se añade p_documento_tipo.
-- ---------------------------------------------------------------------------
DROP FUNCTION fn_aplicar_entrada_compra(BIGINT, NUMERIC, BIGINT, NUMERIC, BIGINT, BIGINT, BIGINT, canal_operacion, UUID);

CREATE OR REPLACE FUNCTION fn_aplicar_entrada_compra(
    p_producto_id BIGINT,
    p_cantidad NUMERIC,
    p_unidad_id BIGINT,
    p_costo_unitario NUMERIC,
    p_lote_id BIGINT,
    p_usuario_id BIGINT,
    p_documento_id BIGINT,
    p_canal canal_operacion DEFAULT 'online',
    p_uuid_offline UUID DEFAULT NULL,
    p_documento_tipo VARCHAR(30) DEFAULT 'compra'
) RETURNS VOID AS $$
DECLARE
    v_cantidad_base NUMERIC(14,4);
    v_cantidad_anterior NUMERIC(14,4);
    v_costo_anterior NUMERIC(14,4);
    v_costo_nuevo NUMERIC(14,4);
    v_porcentaje NUMERIC(6,3);
    v_precio NUMERIC(14,2);
BEGIN
    -- p_costo_unitario es costo por unidad base (ver DP-08).
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

    -- DP-04: el promedio pondera solo la existencia disponible.
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
        p_documento_tipo, p_documento_id, p_usuario_id, p_canal, p_uuid_offline
    );
END;
$$ LANGUAGE plpgsql;

-- Factor de una unidad alterna a la unidad base (1 si es la unidad base).
CREATE OR REPLACE FUNCTION fn_factor_conversion(
    p_producto_id BIGINT,
    p_unidad_id BIGINT,
    p_tipo tipo_unidad_conv
) RETURNS NUMERIC AS $$
DECLARE
    v_unidad_base BIGINT;
    v_factor NUMERIC;
BEGIN
    SELECT unidad_base_id INTO v_unidad_base FROM producto WHERE id = p_producto_id;
    IF v_unidad_base IS NULL THEN
        RAISE EXCEPTION 'Producto % no existe', p_producto_id USING ERRCODE = 'P0001';
    END IF;
    IF p_unidad_id = v_unidad_base THEN
        RETURN 1;
    END IF;
    SELECT factor_a_base INTO v_factor
      FROM unidad_conversion
     WHERE producto_id = p_producto_id AND unidad_id = p_unidad_id AND tipo = p_tipo;
    IF v_factor IS NULL THEN
        RAISE EXCEPTION 'No existe conversión % para producto %, unidad %', p_tipo, p_producto_id, p_unidad_id USING ERRCODE = 'P0001';
    END IF;
    RETURN v_factor;
END;
$$ LANGUAGE plpgsql STABLE;

-- Cambio de porcentaje de incremento (RF-PRE-001). Ver DP-06.
CREATE OR REPLACE FUNCTION fn_actualizar_porcentaje(
    p_producto_id BIGINT,
    p_porcentaje NUMERIC,
    p_usuario_id BIGINT
) RETURNS VOID AS $$
DECLARE
    v_costo NUMERIC(14,4);
BEGIN
    IF p_porcentaje IS NULL OR p_porcentaje < 0 THEN
        RAISE EXCEPTION 'El porcentaje de incremento no puede ser negativo' USING ERRCODE = 'P0001';
    END IF;

    UPDATE producto SET porcentaje_incremento = p_porcentaje, actualizado_en = now() WHERE id = p_producto_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto % no existe', p_producto_id USING ERRCODE = 'P0001';
    END IF;

    SELECT costo_promedio INTO v_costo
      FROM precio_historial
     WHERE producto_id = p_producto_id AND vigente_hasta IS NULL
     FOR UPDATE;
    IF v_costo IS NULL THEN
        RETURN; -- sin costo todavía: el precio se calculará en la primera compra.
    END IF;

    UPDATE precio_historial SET vigente_hasta = now()
     WHERE producto_id = p_producto_id AND vigente_hasta IS NULL;

    INSERT INTO precio_historial(producto_id, costo_promedio, porcentaje_incremento, precio_calculado, usuario_id)
    VALUES (p_producto_id, v_costo, p_porcentaje, round(v_costo * (1 + p_porcentaje / 100), 2), p_usuario_id);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Verificación de consistencia (RF-MOV-001: la suma del kardex coincide con la existencia).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_verificar_kardex()
RETURNS TABLE(producto_id BIGINT, estado estado_existencia, saldo_existencia NUMERIC, saldo_kardex NUMERIC) AS $$
    WITH mov AS (
        SELECT m.producto_id, m.estado_destino AS estado, m.cantidad
          FROM movimiento_inventario m WHERE m.estado_destino IS NOT NULL
        UNION ALL
        SELECT m.producto_id, m.estado_origen, -m.cantidad
          FROM movimiento_inventario m WHERE m.estado_origen IS NOT NULL
    ), k AS (
        SELECT mov.producto_id, mov.estado, SUM(mov.cantidad) AS saldo FROM mov GROUP BY 1, 2
    )
    SELECT COALESCE(e.producto_id, k.producto_id), COALESCE(e.estado, k.estado),
           COALESCE(e.cantidad, 0), COALESCE(k.saldo, 0)
      FROM existencia e
      FULL JOIN k ON k.producto_id = e.producto_id AND k.estado = e.estado
     WHERE COALESCE(e.cantidad, 0) <> COALESCE(k.saldo, 0);
$$ LANGUAGE sql STABLE;

-- Los lotes guardan el saldo físico (los tres estados), por eso se comparan con el total.
CREATE OR REPLACE FUNCTION fn_verificar_lotes()
RETURNS TABLE(producto_id BIGINT, saldo_lotes NUMERIC, saldo_existencia NUMERIC) AS $$
    WITH l AS (SELECT lote.producto_id, SUM(cantidad_disponible) AS s FROM lote GROUP BY 1),
         e AS (SELECT existencia.producto_id, SUM(cantidad) AS s FROM existencia GROUP BY 1)
    SELECT COALESCE(l.producto_id, e.producto_id), COALESCE(l.s, 0), COALESCE(e.s, 0)
      FROM l FULL JOIN e ON e.producto_id = l.producto_id
     WHERE COALESCE(l.s, 0) <> COALESCE(e.s, 0);
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Sesiones de renovación (refresh tokens rotados y revocables). Solo se guarda el hash.
-- ---------------------------------------------------------------------------
CREATE TABLE sesion_refresh (
    id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id),
    token_hash CHAR(64) NOT NULL UNIQUE,
    expira_en TIMESTAMPTZ NOT NULL,
    revocado_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sesion_refresh_usuario ON sesion_refresh(usuario_id);

-- ---------------------------------------------------------------------------
-- Auditoría: misma función del esquema base, pero sin copiar hashes de contraseña
-- a valores_antes/valores_despues.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_auditar()
RETURNS TRIGGER AS $$
DECLARE
    v_fila JSONB;
    v_antes JSONB;
    v_despues JSONB;
    v_registro_id TEXT;
BEGIN
    IF current_setting('app.suprimir_auditoria', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_antes := to_jsonb(OLD) - 'hash_password'; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_despues := to_jsonb(NEW) - 'hash_password'; END IF;
    v_fila := COALESCE(v_despues, v_antes);

    IF v_fila ? 'id' THEN
        v_registro_id := v_fila ->> 'id';
    ELSIF TG_TABLE_NAME = 'existencia' THEN
        v_registro_id := (v_fila ->> 'producto_id') || ':' || (v_fila ->> 'estado');
    ELSIF TG_TABLE_NAME = 'rol_permiso' THEN
        v_registro_id := (v_fila ->> 'rol_id') || ':' || (v_fila ->> 'permiso_id');
    ELSIF TG_TABLE_NAME = 'usuario_rol' THEN
        v_registro_id := (v_fila ->> 'usuario_id') || ':' || (v_fila ->> 'rol_id');
    ELSIF v_fila ? 'producto_id' THEN
        v_registro_id := v_fila ->> 'producto_id';
    ELSE
        v_registro_id := md5(v_fila::TEXT);
    END IF;

    INSERT INTO auditoria(tabla_afectada, registro_id, accion, valores_antes, valores_despues, usuario_id, origen)
    VALUES (TG_TABLE_NAME, v_registro_id, lower(TG_OP), v_antes, v_despues, fn_usuario_auditoria(), fn_origen_auditoria());

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditar_marca AFTER INSERT OR UPDATE OR DELETE ON marca FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_categoria AFTER INSERT OR UPDATE OR DELETE ON categoria FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_auditar_unidad AFTER INSERT OR UPDATE OR DELETE ON unidad_medida FOR EACH ROW EXECUTE FUNCTION fn_auditar();
