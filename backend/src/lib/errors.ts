export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'SOLICITUD_INVALIDA', message, details);
export const unauthorized = (message = 'Autenticación requerida') => new AppError(401, 'NO_AUTENTICADO', message);
export const forbidden = (message = 'No tiene permiso para esta operación') => new AppError(403, 'SIN_PERMISO', message);
export const notFound = (message = 'Recurso no encontrado') => new AppError(404, 'NO_ENCONTRADO', message);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICTO', message, details);
export const businessRule = (message: string, details?: unknown) => new AppError(422, 'REGLA_DE_NEGOCIO', message, details);

const UNIQUE_MESSAGES: Record<string, string> = {
  producto_codigo_barras_key: 'Ya existe un producto con ese código de barras (RN-01)',
  usuario_correo_key: 'Ya existe un usuario con ese correo',
  marca_nombre_key: 'Ya existe una marca con ese nombre',
  unidad_medida_codigo_key: 'Ya existe una unidad con ese código',
  categoria_nombre_categoria_padre_id_key: 'Ya existe esa categoría en el mismo nivel',
  tercero_tipo_documento_numero_documento_key: 'Ya existe un tercero con ese tipo y número de documento (RN-11)',
  unidad_conversion_producto_id_unidad_id_tipo_key: 'La conversión ya existe para ese producto, unidad y tipo',
  integracion_evento_identificador_externo_key: 'El evento ya fue recibido (RN-16)',
  venta_uuid_offline_key: 'La operación offline ya fue aplicada (RN-16)',
  cierre_mensual_periodo_key: 'El período ya tiene cierre (RN-08)',
};

const CHECK_MESSAGES: Record<string, string> = {
  chk_persona_natural: 'Una persona natural requiere nombre y apellido (RN-11)',
  chk_persona_juridica: 'Una persona jurídica requiere razón social (RN-11)',
  chk_al_menos_un_rol: 'El tercero debe ser cliente, proveedor o ambos',
  existencia_cantidad_check: 'Ningún saldo de existencia puede ser negativo (RN-03)',
  unidad_conversion_factor_a_base_check: 'El factor de conversión debe ser mayor que cero',
};

interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

/** Traduce errores de PostgreSQL a errores de dominio sin exponer detalles internos. */
export function mapDatabaseError(error: unknown): AppError | null {
  const e = error as PgError;
  if (!e || typeof e.code !== 'string') return null;
  switch (e.code) {
    case 'P0001': // RAISE EXCEPTION de funciones y triggers de negocio
      return businessRule(e.message);
    case '23505':
      return conflict(UNIQUE_MESSAGES[e.constraint ?? ''] ?? 'El registro ya existe');
    case '23514':
      return businessRule(CHECK_MESSAGES[e.constraint ?? ''] ?? `Restricción violada: ${e.constraint ?? 'desconocida'}`);
    case '23503':
      return businessRule('El registro referenciado no existe');
    case '23502':
      return badRequest('Falta un dato obligatorio');
    case '22P02':
    case '22003':
      return badRequest('Valor con formato o rango inválido');
    case '40P01':
    case '40001':
      return conflict('Operación concurrente detectada; intente de nuevo');
    case 'ECONNREFUSED':
    case '57P01':
    case '57P03':
      return new AppError(503, 'BD_NO_DISPONIBLE', 'La base de datos no está disponible temporalmente');
    default:
      return null;
  }
}
