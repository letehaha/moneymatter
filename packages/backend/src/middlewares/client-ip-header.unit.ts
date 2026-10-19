import { describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { CLIENT_IP_HEADER, setClientIpHeaderMiddleware } from './client-ip-header';

const buildApp = ({ trustProxy }: { trustProxy: Parameters<express.Express['set']>[1] }) => {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(setClientIpHeaderMiddleware);
  app.get('/ip', (req, res) => {
    res.json({ header: req.headers[CLIENT_IP_HEADER] ?? null, reqIp: req.ip });
  });
  return app;
};

describe('setClientIpHeaderMiddleware', () => {
  it('copies the address Express resolved behind a trusted proxy into the client IP header', async () => {
    const app = buildApp({ trustProxy: ['loopback'] });

    const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.7');

    expect(res.body.header).toBe('203.0.113.7');
  });

  it('takes the first untrusted hop from the right, so a prepended fake address is ignored', async () => {
    const app = buildApp({ trustProxy: ['loopback', 'uniquelocal'] });

    const res = await request(app).get('/ip').set('X-Forwarded-For', '1.2.3.4, 203.0.113.7, 172.19.0.5');

    expect(res.body.header).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For when the request comes from an untrusted address', async () => {
    const app = buildApp({ trustProxy: ['10.0.0.0/8'] });

    const res = await request(app).get('/ip').set('X-Forwarded-For', '1.2.3.4');

    expect(res.body.header).toMatch(/127\.0\.0\.1$/);
  });

  it('overwrites a client IP header sent by the caller', async () => {
    const app = buildApp({ trustProxy: ['10.0.0.0/8'] });

    const res = await request(app).get('/ip').set(CLIENT_IP_HEADER, '1.2.3.4');

    expect(res.body.header).toMatch(/127\.0\.0\.1$/);
  });

  it('overwrites a client IP header sent by the caller behind a trusted proxy as well', async () => {
    const app = buildApp({ trustProxy: ['loopback'] });

    const res = await request(app).get('/ip').set(CLIENT_IP_HEADER, '1.2.3.4').set('X-Forwarded-For', '203.0.113.7');

    expect(res.body.header).toBe('203.0.113.7');
  });

  it('removes a caller-supplied header when Express resolved no address', () => {
    const req = { ip: undefined, headers: { [CLIENT_IP_HEADER]: '1.2.3.4' } } as unknown as express.Request;
    let called = false;

    setClientIpHeaderMiddleware(req, {} as express.Response, () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(req.headers[CLIENT_IP_HEADER]).toBeUndefined();
  });
});
