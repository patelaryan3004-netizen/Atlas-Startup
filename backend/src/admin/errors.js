// Errors the Command Center raises on purpose, each carrying the HTTP status it should become.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}
export class BadRequestError extends HttpError { constructor(message) { super(400, message); } }
export class UnauthorizedError extends HttpError { constructor(message = 'sign in with your token') { super(401, message); } }
export class ForbiddenError extends HttpError { constructor(message) { super(403, message); } }
export class NotFoundError extends HttpError { constructor(message) { super(404, message); } }
export class ConflictError extends HttpError { constructor(message) { super(409, message); } }
export class TooManyRequestsError extends HttpError { constructor(message) { super(429, message); } }
