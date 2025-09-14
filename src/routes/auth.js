import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  dateOfBirth: z.string().datetime()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export function authRouter(prisma) {
  const router = express.Router();
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });

  router.post('/register', async (req, res, next) => {
    try {
      const { name, email, password, dateOfBirth } = registerSchema.parse(req.body);
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(400).json({ error: 'Email already registered' });
      const passwordHash = await bcrypt.hash(password, 10);
      let age = null;
      if (dateOfBirth) {
        const dob = new Date(dateOfBirth);
        const diff = Date.now() - dob.getTime();
        const ageDate = new Date(diff);
        age = Math.abs(ageDate.getUTCFullYear() - 1970);
      }
      const token = Math.floor(100000 + Math.random()*900000).toString();
      const exp = new Date(Date.now() + 15*60*1000);
      const user = await prisma.user.create({ data: { name, email, passwordHash, role: 'STUDENT', dateOfBirth: new Date(dateOfBirth), age, otpCode: token, otpExpiresAt: exp } });
      if (process.env.SMTP_USER) {
        await transporter.sendMail({
          to: email,
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          subject: 'Verify your email - Bengal Coding Academy',
          html: `<p>Your verification code is <b>${token}</b>. It expires in 15 minutes.</p>`
        });
      }
      res.json({ id: user.id, name: user.name, email: user.email, needsEmailVerification: true });
    } catch (e) {
      next(e);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      if (!user.emailVerifiedAt) return res.status(403).json({ error: 'Please verify your email to continue.' });
      const accessToken = jwt.sign(
        { role: user.role },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '1h', subject: user.id }
      );
      
      // Set cookie with token
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: true, // Always secure for HTTPS
        sameSite: 'none', // Allow cross-site cookies
        maxAge: 60 * 60 * 1000 // 1 hour
      });
      
      res.json({ expiresInSec: 3600, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (e) {
      next(e);
    }
  });

  // Admin login route
  router.post('/admin/login', async (req, res, next) => {
    try {
      // Check if prisma client is properly initialized
      if (!prisma) {
        console.error('Prisma client is not initialized');
        return res.status(500).json({ error: 'Database connection error' });
      }

      const { username, password } = adminLoginSchema.parse(req.body);
      
      // Test database connection first
      try {
        await prisma.$connect();
      } catch (dbError) {
        console.error('Database connection failed:', dbError);
        return res.status(500).json({ error: 'Database connection failed' });
      }

      const admin = await prisma.admin.findUnique({ where: { username } });
      if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
      if (!admin.isActive) return res.status(403).json({ error: 'Admin account is deactivated' });
      
      const ok = await bcrypt.compare(password, admin.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      
      const accessToken = jwt.sign(
        { role: 'ADMIN', adminId: admin.id },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '8h', subject: admin.id }
      );
      
      // Update last login time
      await prisma.admin.update({ 
        where: { id: admin.id }, 
        data: { lastLoginAt: new Date() } 
      });
      
      // Set cookie with token
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: true, // Always secure for HTTPS
        sameSite: 'none', // Allow cross-site cookies
        maxAge: 8 * 60 * 60 * 1000 // 8 hours
      });
      
      res.json({ 
        expiresInSec: 28800, // 8 hours
        user: { 
          id: admin.id, 
          name: admin.name || admin.username, 
          username: admin.username, 
          email: admin.email,
          role: 'ADMIN' 
        } 
      });
    } catch (e) {
      console.error('Admin login error:', e);
      if (e.name === 'PrismaClientInitializationError') {
        return res.status(500).json({ error: 'Database connection error' });
      }
      next(e);
    }
  });

  router.post('/verify-email', async (req, res, next) => {
    try {
      const body = z.object({ email: z.string().email(), code: z.string().length(6) }).parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user || !user.otpCode || !user.otpExpiresAt) return res.status(400).json({ error: 'Invalid code' });
      if (user.otpCode !== body.code || user.otpExpiresAt < new Date()) return res.status(400).json({ error: 'Invalid or expired code' });
      const updated = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), otpCode: null, otpExpiresAt: null } });
      res.json({ ok: true, email: updated.email });
    } catch (e) { next(e); }
  });

  // Forgot password
  router.post('/forgot-password', async (req, res, next) => {
    try {
      const email = z.string().email().parse(req.body.email);
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        const exp = new Date(Date.now() + 1000 * 60 * 30); // 30 mins
        await prisma.user.update({ where: { id: user.id }, data: { resetToken: token, resetTokenExp: exp } });
        const resetUrl = `${process.env.WEB_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
        if (process.env.SMTP_USER) {
          await transporter.sendMail({
            to: email,
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            subject: 'Reset your Bengal Coding Academy password',
            html: `<p>Click the link to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
          });
        }
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Reset password
  router.post('/reset-password', async (req, res, next) => {
    try {
      const body = z.object({ token: z.string(), password: z.string().min(8) }).parse(req.body);
      const user = await prisma.user.findFirst({ where: { resetToken: body.token, resetTokenExp: { gt: new Date() } } });
      if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
      const passwordHash = await bcrypt.hash(body.password, 10);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash, resetToken: null, resetTokenExp: null } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Admin auth check endpoint
  router.get('/admin/me', async (req, res, next) => {
    try {
      // Check if prisma client is properly initialized
      if (!prisma) {
        console.error('Prisma client is not initialized in admin/me');
        return res.status(500).json({ error: 'Database connection error' });
      }

      // Try to get token from cookie first, then from Authorization header
      let token = req.cookies?.accessToken;
      if (!token) {
        const authHeader = req.headers.authorization || '';
        token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      }
      
      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      
      const jwt = await import('jsonwebtoken');
      const payload = jwt.default.verify(token, process.env.JWT_SECRET);
      
      if (payload.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      // Test database connection first
      try {
        await prisma.$connect();
      } catch (dbError) {
        console.error('Database connection failed in admin/me:', dbError);
        return res.status(500).json({ error: 'Database connection failed' });
      }
      
      const admin = await prisma.admin.findUnique({ where: { id: payload.sub } });
      if (!admin || !admin.isActive) {
        return res.status(401).json({ error: 'Admin not found or inactive' });
      }
      
      res.json({
        id: admin.id,
        name: admin.name || admin.username,
        username: admin.username,
        email: admin.email,
        role: 'ADMIN',
        lastLoginAt: admin.lastLoginAt
      });
    } catch (e) {
      console.error('Admin auth check error:', e);
      if (e.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      if (e.name === 'PrismaClientInitializationError') {
        return res.status(500).json({ error: 'Database connection error' });
      }
      return res.status(401).json({ error: 'Unauthorized' });
    }
  });

  // Logout
  router.post('/logout', (req, res) => {
    // Clear all possible token cookie variations
    const tokenNames = ['accessToken', 'refreshToken', 'token', 'authToken', 'sessionToken'];
    const cookieOptions = [
      { httpOnly: true, secure: true, sameSite: 'none', path: '/' },
      { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
      { httpOnly: false, secure: true, sameSite: 'none', path: '/' },
      { httpOnly: false, secure: false, sameSite: 'lax', path: '/' }
    ];
    
    // Clear all token variations with all possible configurations
    tokenNames.forEach(tokenName => {
      cookieOptions.forEach(options => {
        res.clearCookie(tokenName, options);
      });
    });
    
    res.json({ ok: true });
  });

  return router;
}


