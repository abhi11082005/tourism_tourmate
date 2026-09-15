import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/index.js';
import { requireAuth } from '../middleware/auth.js';
import * as auth from '../services/auth.service.js';

export const authRouter = Router();

// Credential endpoints are the obvious brute-force target.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Include an uppercase letter, a lowercase letter and a digit',
  });

const registerSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password,
  fullName: z.string().min(2).max(120).trim(),
  phone: z.string().min(8).max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: z.string().min(1).max(128),
});

authRouter.post(
  '/register',
  credentialLimiter,
  validate('body', registerSchema),
  asyncHandler(async (req, res) => {
    const { user, token } = await auth.register(req.body);
    res.status(201).json({ user, token });
  })
);

authRouter.post(
  '/login',
  credentialLimiter,
  validate('body', loginSchema),
  asyncHandler(async (req, res) => {
    const { user, token } = await auth.login(req.body);
    res.json({ user, token });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    // getSession also re-checks the token against users.password_changed_at, so
    // a session revoked from another device dies on the next page load.
    res.json({ user: await auth.getSession(req.user) });
  })
);

authRouter.post(
  '/change-password',
  requireAuth,
  credentialLimiter,
  validate('body', z.object({ currentPassword: z.string().min(1), newPassword: password })),
  asyncHandler(async (req, res) => {
    res.json(await auth.changePassword({ userId: req.user.id, ...req.body }));
  })
);


// ==========================================
// OAUTH: GOOGLE
// ==========================================

// 1. INITIATION ROUTE
authRouter.get('/google', (req, res) => {
  const targetRedirect = req.query.redirect || '/';
  
  // Save intent in a short-lived cookie
  res.cookie('oauth_intent', targetRedirect, { 
    httpOnly: true, 
    maxAge: 10 * 60 * 1000 
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account'
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// 2. CALLBACK ROUTE
authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const code = req.query.code;
    const error = req.query.error;
    
    // Retrieve intent, default to home, and clean up
    const clientRedirect = req.cookies.oauth_intent || '/';
    res.clearCookie('oauth_intent');
    
    // Assumes your frontend runs on 5173 in dev. Set this in .env for production!
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (error || !code) {
      return res.redirect(`${FRONTEND_URL}/login?error=AccessDenied`);
    }

    // A. Exchange auth code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code.toString(),
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      }),
    });
    
    if (!tokenResponse.ok) throw new Error('Failed to fetch Google token');
    const tokenData = await tokenResponse.json();

    // B. Get user info from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    if (!userResponse.ok) throw new Error('Failed to fetch Google profile');
    const googleUser = await userResponse.json();

    // C. Delegate DB upsert and token generation to the service layer
    const { token } = await auth.googleLogin({
      email: googleUser.email.toLowerCase(),
      fullName: googleUser.name,
      providerId: googleUser.id, // Google's unique 'sub' identifier
      avatarUrl: googleUser.picture
    });

    // D. Return the user to the frontend.
    // If your app stores the token in an HTTP-only cookie, you would set it here:
    // res.cookie('auth_token', token, { httpOnly: true });
    // res.redirect(`${FRONTEND_URL}${clientRedirect}`);
    
    // Or, if your React app extracts the token from the URL, redirect like this:
    // Send the token back to the React app
    res.redirect(`${FRONTEND_URL}/oauth/callback?token=${token}&redirect=${encodeURIComponent(clientRedirect)}`);   
  })
);