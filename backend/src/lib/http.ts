import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type Pagination = z.infer<typeof PaginationSchema>;

export function paginated<T>(items: T[], total: number, p: Pagination) {
  return { data: items, meta: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) } };
}

export const offset = (p: Pagination) => (p.page - 1) * p.pageSize;

export const IdParam = z.object({ id: z.coerce.number().int().positive() });

export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => schema.parse(data);
