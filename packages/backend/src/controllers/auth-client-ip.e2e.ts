import { describe, expect, it } from '@jest/globals';
import { CLIENT_IP_HEADER } from '@middlewares/client-ip-header';
import { makeAuthRequest } from '@tests/helpers';

// Covers the wiring against the mocked better-auth: what Express makes of the proxy headers and which
// header the auth config reads. supertest connects from loopback, which is trusted by default.
const CLIENT_IP = '203.0.113.7';
const DOCKER_PROXY_IP = '172.19.0.5';

const signIn = async ({ headers }: { headers: Record<string, string> }) =>
  makeAuthRequest({
    method: 'post',
    url: '/auth/sign-in/email',
    payload: { email: 'test@test.local', password: 'password123' },
    headers,
  });

describe('Client IP recorded on auth sessions', () => {
  it('records the client address when a proxy appends its own hop to X-Forwarded-For', async () => {
    // Cloudflare Tunnel -> frontend container: the frontend nginx appends the cloudflared container.
    const res = await signIn({ headers: { 'X-Forwarded-For': `${CLIENT_IP}, ${DOCKER_PROXY_IP}` } });

    expect(res.statusCode).toBe(200);
    expect(res.body.session.ipAddress).toBe(CLIENT_IP);
  });

  it('records the client address when the proxy forwards a single address', async () => {
    const res = await signIn({ headers: { 'X-Forwarded-For': CLIENT_IP } });

    expect(res.statusCode).toBe(200);
    expect(res.body.session.ipAddress).toBe(CLIENT_IP);
  });

  it('ignores addresses a caller prepends to X-Forwarded-For', async () => {
    const res = await signIn({ headers: { 'X-Forwarded-For': `6.6.6.6, ${CLIENT_IP}, ${DOCKER_PROXY_IP}` } });

    expect(res.statusCode).toBe(200);
    expect(res.body.session.ipAddress).toBe(CLIENT_IP);
  });

  it('ignores a client IP header sent by the caller', async () => {
    const res = await signIn({ headers: { [CLIENT_IP_HEADER]: '6.6.6.6', 'X-Forwarded-For': CLIENT_IP } });

    expect(res.statusCode).toBe(200);
    expect(res.body.session.ipAddress).toBe(CLIENT_IP);
  });

  it('records the socket address when no proxy header is present', async () => {
    const res = await signIn({ headers: { [CLIENT_IP_HEADER]: '6.6.6.6' } });

    expect(res.statusCode).toBe(200);
    expect(res.body.session.ipAddress).toMatch(/127\.0\.0\.1$/);
  });

  it('records the address on sign-up as well', async () => {
    const res = await makeAuthRequest({
      method: 'post',
      url: '/auth/sign-up/email',
      payload: { email: 'client-ip@test.local', password: 'password123', name: 'Client IP' },
      headers: { 'X-Forwarded-For': `${CLIENT_IP}, ${DOCKER_PROXY_IP}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.session.ipAddress).toBe(CLIENT_IP);
  });
});
