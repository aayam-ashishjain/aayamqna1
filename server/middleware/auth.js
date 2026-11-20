const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

function signHostToken(host) {
  return jwt.sign(
    { sub: host.id, email: host.email, name: host.name, role: 'host' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyHostToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function extractBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

function requireHost(req, res, next) {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: 'Host authentication required' });

  try {
    req.hostUser = verifyHostToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalHost(req, _res, next) {
  const token = extractBearer(req);
  if (token) {
    try {
      req.hostUser = verifyHostToken(token);
    } catch {
      req.hostUser = null;
    }
  }
  return next();
}

module.exports = { signHostToken, verifyHostToken, requireHost, optionalHost };
