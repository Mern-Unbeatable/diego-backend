import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { Application } from './app';

describe('App', () => {
  const application = new Application();
  const app = application.build();

  it('should return health status', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);

    expect(res.body.status).toBe('success');
    expect(res.body.message).toBe('Server is healthy');
  });
});
