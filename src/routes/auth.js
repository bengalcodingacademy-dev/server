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
      
      // Check if user already exists (verified or unverified)
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.emailVerifiedAt) {
          return res.status(400).json({ error: 'Email already registered' });
        } else {
          // User exists but not verified, delete the old record and create new verification
          await prisma.user.delete({ where: { id: existing.id } });
        }
      }
      
      // Generate verification token
      const token = Math.floor(100000 + Math.random()*900000).toString();
      const exp = new Date(Date.now() + 15*60*1000);
      
      // Store verification data temporarily (not as a full user)
      const verificationData = {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        dateOfBirth: new Date(dateOfBirth),
        age: (() => {
          const dob = new Date(dateOfBirth);
          const diff = Date.now() - dob.getTime();
          const ageDate = new Date(diff);
          return Math.abs(ageDate.getUTCFullYear() - 1970);
        })(),
        otpCode: token,
        otpExpiresAt: exp,
        role: 'STUDENT'
      };
      
      // Store verification data first
      const tempUser = await prisma.user.create({ 
        data: { 
          ...verificationData,
          emailVerifiedAt: null // Explicitly set as unverified
        } 
      });
      
      // Send verification email asynchronously (don't wait for it)
      if (process.env.SMTP_USER) {
        // Send email in background - don't await it
        transporter.sendMail({
          to: email,
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          subject: 'Verify your email - Bengal Coding Academy',
          html: `<p>Your verification code is <b>${token}</b>. It expires in 15 minutes.</p>`
        }).catch(err => {
          console.error('Failed to send verification email:', err);
          console.log('FALLBACK: Verification code for', email, 'is:', token);
        });
      } else {
        console.log('SMTP not configured - verification code for', email, 'is:', token);
      }
      
      // Respond immediately without waiting for email
      res.json({ 
        id: tempUser.id, 
        name: tempUser.name, 
        email: tempUser.email, 
        needsEmailVerification: true 
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      
      // Check if user is verified
      if (!user.emailVerifiedAt) {
        return res.status(403).json({ 
          error: 'Please verify your email to continue. Check your inbox for the verification code.' 
        });
      }
      
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      
      // Set different token expiration for admin users
      const tokenExpiration = user.role === 'ADMIN' ? '8h' : '1h';
      const maxAge = user.role === 'ADMIN' ? 8 * 60 * 60 * 1000 : 60 * 60 * 1000;
      
      const accessToken = jwt.sign(
        { role: user.role },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: tokenExpiration, subject: user.id }
      );
      
      // Set cookie with token - adjust for local development
      const isDevelopment = process.env.NODE_ENV !== 'production';
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: !isDevelopment, // Only secure in production
        sameSite: isDevelopment ? 'lax' : 'none', // Lax for local development
        maxAge: maxAge
      });
      
      res.json({ 
        expiresInSec: user.role === 'ADMIN' ? 28800 : 3600, 
        user: { id: user.id, name: user.name, email: user.email, role: user.role } 
      });
    } catch (e) {
      next(e);
    }
  });


  router.post('/verify-email', async (req, res, next) => {
    try {
      const body = z.object({ email: z.string().email(), code: z.string().length(6) }).parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user || !user.otpCode || !user.otpExpiresAt) return res.status(400).json({ error: 'Invalid code' });
      if (user.otpCode !== body.code || user.otpExpiresAt < new Date()) return res.status(400).json({ error: 'Invalid or expired code' });
      
      // Only now do we fully activate the user by setting emailVerifiedAt
      const updated = await prisma.user.update({ 
        where: { id: user.id }, 
        data: { 
          emailVerifiedAt: new Date(), 
          otpCode: null, 
          otpExpiresAt: null 
        } 
      });
      
      res.json({ ok: true, email: updated.email });
    } catch (e) { next(e); }
  });

  // Cleanup unverified users (call this periodically)
  router.post('/cleanup-unverified', async (req, res, next) => {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const deleted = await prisma.user.deleteMany({
        where: {
          emailVerifiedAt: null,
          createdAt: {
            lt: oneDayAgo
          }
        }
      });
      res.json({ deleted: deleted.count });
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


  // Logout
  router.post('/logout', (req, res) => {
    // Clear all possible token cookie variations
    const tokenNames = ['accessToken', 'refreshToken', 'token', 'authToken', 'sessionToken'];
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const cookieOptions = [
      { httpOnly: true, secure: !isDevelopment, sameSite: isDevelopment ? 'lax' : 'none', path: '/' },
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


