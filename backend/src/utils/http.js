class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function ok(res, data, status = 200) {
  return res.status(status).json({ data });
}

module.exports = { HttpError, asyncHandler, ok };
