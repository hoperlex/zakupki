export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Требуется авторизация') =>
  new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Доступ запрещён') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Не найдено') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string, details?: unknown) =>
  new AppError(409, 'conflict', msg, details);
export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, 'unprocessable', msg, details);
