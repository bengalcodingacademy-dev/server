import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  try {
    // Try to get token from cookie first, then from Authorization header
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers.authorization || '';
      token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    }
    
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}


