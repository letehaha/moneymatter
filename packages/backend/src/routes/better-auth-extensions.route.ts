/**
 * Routes that wrap better-auth server-side only APIs.
 * These endpoints expose functionality that better-auth doesn't provide as HTTP endpoints.
 */
import { setPassword, signupsOpen } from '@controllers/better-auth-extensions.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import express, { Router } from 'express';

const router = Router({});

// Intentionally no authenticateSession: pre-login pages call this.
router.get('/signups-open', signupsOpen);

// The global body parser skips `/auth/*` so better-auth's handler owns the raw stream.
// Parsing per-route (not router-wide) leaves unmatched `/auth/*` requests untouched.
// Demo users cannot set/change passwords.
router.post('/set-password', express.json(), authenticateSession, blockDemoUsers, setPassword);

export default router;
