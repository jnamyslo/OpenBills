export class AuthError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

export function sendAuthError(res, err) {
  return res.status(err.status || 500).json({ error: err.message, code: err.code });
}
