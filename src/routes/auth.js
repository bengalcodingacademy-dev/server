import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { AppError, ErrorTypes, asyncHandler } from '../middleware/errorHandler.js';

// In-memory storage for temporary user verification data
// In production, consider using Redis or a more robust solution
const tempUserStorage = new Map();

// Cleanup expired temporary data every 5 minutes
setInterval(() => {
  const now = new Date();
  for (const [email, data] of tempUserStorage.entries()) {
    if (data.otpExpiresAt && data.otpExpiresAt < now) {
      tempUserStorage.delete(email);
      console.log(`Cleaned up expired verification data for: ${email}`);
    }
  }
}, 5 * 60 * 1000); // 5 minutes

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10).max(15),
  password: z.string().min(8),
  dateOfBirth: z.string().datetime()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});


export function authRouter(prisma) {
  const router = express.Router();
  // Simple SMTP transporter configuration
  const transporter = nodemailer.createTransporter({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 30000,  // 30 seconds
    greetingTimeout: 15000,    // 15 seconds
    socketTimeout: 30000,      // 30 seconds
    tls: {
      rejectUnauthorized: false // Allow self-signed certificates
    }
  });

  router.post('/register', asyncHandler(async (req, res, next) => {
    const { name, email, phone, password, dateOfBirth } = registerSchema.parse(req.body);
    
    // Check if user already exists (verified) by email
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      console.log(`🔍 Email ${email} found:`, {
        id: existingByEmail.id,
        email: existingByEmail.email,
        emailVerifiedAt: existingByEmail.emailVerifiedAt,
        phoneVerifiedAt: existingByEmail.phoneVerifiedAt
      });
      
      if (existingByEmail.emailVerifiedAt) {
        throw new AppError('Email already registered', 400, ErrorTypes.CONFLICT);
      }
    }

    // Check if phone number already exists in verified users
    const existingByPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingByPhone) {
      console.log(`🔍 Phone ${phone} found:`, {
        id: existingByPhone.id,
        email: existingByPhone.email,
        emailVerifiedAt: existingByPhone.emailVerifiedAt,
        phoneVerifiedAt: existingByPhone.phoneVerifiedAt
      });
      
      if (existingByPhone.emailVerifiedAt) {
        throw new AppError('Phone number already registered', 400, ErrorTypes.CONFLICT);
      }
    }

    // Clean up any unverified users with same email/phone
    if (existingByEmail && !existingByEmail.emailVerifiedAt) {
      await prisma.user.delete({ where: { id: existingByEmail.id } });
    }
    if (existingByPhone && !existingByPhone.emailVerifiedAt) {
      await prisma.user.delete({ where: { id: existingByPhone.id } });
    }
    
    // Generate email verification token
    const emailToken = Math.floor(100000 + Math.random()*900000).toString();
    const exp = new Date(Date.now() + 15*60*1000);
    
    // Store verification data temporarily in memory (NOT in database)
    const tempUserData = {
      name,
      email,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      dateOfBirth: new Date(dateOfBirth),
      age: (() => {
        const dob = new Date(dateOfBirth);
        const diff = Date.now() - dob.getTime();
        const ageDate = new Date(diff);
        return Math.abs(ageDate.getUTCFullYear() - 1970);
      })(),
      otpCode: emailToken,
      otpExpiresAt: exp,
      role: 'STUDENT',
      createdAt: new Date()
    };
    
    // Store in memory with email as key
    tempUserStorage.set(email, tempUserData);
    
    // Send verification email
    let emailSent = false;
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        console.log(`📧 Sending verification email to: ${email}`);
        
        await transporter.sendMail({
          to: email,
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          subject: 'Verify your email - Bengal Coding Academy',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #ffb209;">Bengal Coding Academy</h2>
              <p>Hello ${name},</p>
              <p>Thank you for registering with Bengal Coding Academy! Please verify your email address by entering the code below:</p>
              <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #ffb209; font-size: 32px; margin: 0; letter-spacing: 5px;">${emailToken}</h1>
              </div>
              <p>This code will expire in 15 minutes.</p>
              <p>If you didn't create an account with us, please ignore this email.</p>
              <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 12px;">Bengal Coding Academy - Empowering the next generation of developers</p>
            </div>
          `
        });
        
        emailSent = true;
        console.log(`✅ Verification email sent successfully to: ${email}`);
      } catch (err) {
        console.error('❌ Failed to send verification email:', err.message || err);
        emailSent = false;
        // Don't throw error - continue with registration even if email fails
      }
    } else {
      console.log('⚠️ SMTP not configured - email verification code for', email, 'is:', emailToken);
    }
    
    // Log the verification code for development/testing
    console.log(`📧 Email verification code for ${email}: ${emailToken}`);
    
    // Respond immediately - user is NOT saved to database yet
    res.json({ 
      email: email,
      needsEmailVerification: true,
      message: emailSent ? 'Verification email sent! Please check your inbox.' : 'Please check the server logs for your verification code.',
      emailSent: emailSent,
      // Include verification code in development mode for testing
      ...(process.env.NODE_ENV !== 'production' && { verificationCode: emailToken })
    });
  }));

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      
      // Check if user is verified (only email verification required now)
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
      
      // Get temporary user data from memory
      const tempUserData = tempUserStorage.get(body.email);
      if (!tempUserData || !tempUserData.otpCode || !tempUserData.otpExpiresAt) {
        return res.status(400).json({ error: 'Invalid or expired verification code' });
      }
      
      if (tempUserData.otpCode !== body.code || tempUserData.otpExpiresAt < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired code' });
      }
      
            // NOW save user to database after successful email verification
            const newUser = await prisma.user.create({
              data: {
                name: tempUserData.name,
                email: tempUserData.email,
                phone: tempUserData.phone,
                passwordHash: tempUserData.passwordHash,
                dateOfBirth: tempUserData.dateOfBirth,
                age: tempUserData.age,
                role: tempUserData.role,
                emailVerifiedAt: new Date(),
                createdAt: tempUserData.createdAt
              }
            });
      
      // Clean up temporary data
      tempUserStorage.delete(body.email);
      
      res.json({ 
        ok: true, 
        email: newUser.email,
        message: 'Email verified successfully! You can now log in.'
      });
    } catch (e) { 
      next(e); 
    }
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


