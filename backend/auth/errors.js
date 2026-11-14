import logger from '../utils/logger.js';

export class AuthError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

export function sendAuthError(res, err) {
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  logger.error('Unerwarteter Auth-Fehler', { error: err?.message });
  return res.status(500).json({ error: 'Interner Fehler' });
}
