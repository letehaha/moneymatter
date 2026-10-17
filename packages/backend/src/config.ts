export const API_PREFIX = '/api/v1';
export const BETTER_AUTH_BASE_URL = (process.env.BETTER_AUTH_URL || 'https://localhost:8081').replace(/\/+$/, '');

export const MCP_BASE_URL = process.env.MCP_BASE_URL || BETTER_AUTH_BASE_URL;
/** The frontend's own origin, without a trailing slash: Stripe-hosted pages are sent back to it and push notifications link into it. */
export const FRONTEND_BASE_URL = (process.env.AUTH_ORIGIN || 'https://localhost:8100').replace(/\/+$/, '');

/** Where Stripe-hosted checkout and portal send the buyer back; must match the frontend plan-billing route. */
export const PLAN_BILLING_URL = `${FRONTEND_BASE_URL}/settings/plan-billing`;
