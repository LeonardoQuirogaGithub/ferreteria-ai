import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, mapDatabaseError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Formato común de error: { error: { code, message, details? } }. Nunca expone trazas. */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDACION',
        message: 'Datos de entrada inválidos',
        details: error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      },
    });
  }
  const appError = error instanceof AppError ? error : mapDatabaseError(error);
  if (appError) {
    return res.status(appError.status).json({
      error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) },
    });
  }
  if ((error as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'CARGA_DEMASIADO_GRANDE', message: 'La solicitud excede el tamaño permitido' } });
  }
  if ((error as { type?: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'JSON_INVALIDO', message: 'El cuerpo no es JSON válido' } });
  }
  logger.error({ err: error, path: req.path }, 'Error no controlado');
  return res.status(500).json({ error: { code: 'ERROR_INTERNO', message: 'Ocurrió un error inesperado' } });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'RUTA_NO_ENCONTRADA', message: 'Ruta no encontrada' } });
}
