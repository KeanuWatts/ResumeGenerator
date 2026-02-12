const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Reads req.query.limit and req.query.offset, validates them, and sets req.pagination = { limit, offset }.
 * limit: default 20, max 100. offset: default 0, min 0.
 */
export function paginationMiddleware(req, res, next) {
  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);
  if (Number.isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  if (Number.isNaN(offset) || offset < 0) offset = 0;
  req.pagination = { limit, offset };
  next();
}
