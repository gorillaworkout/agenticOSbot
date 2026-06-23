import { describe, it, expect } from 'vitest';

// Test API response helpers (extracted from api.ts pattern)
function ok(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

function err(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status });
}

function paginated(items: unknown[], total: number, page: number, pageSize: number): Response {
  return Response.json({
    ok: true,
    data: items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

describe('API response helpers', () => {
  describe('ok', () => {
    it('returns success response with data', async () => {
      const response = ok({ name: 'test' });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data.name).toBe('test');
    });

    it('supports custom status codes', async () => {
      const response = ok({ created: true }, 201);
      expect(response.status).toBe(201);
    });
  });

  describe('err', () => {
    it('returns error response', async () => {
      const response = err('Something went wrong');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe('Something went wrong');
    });

    it('supports custom status codes', async () => {
      const response = err('Not found', 404);
      expect(response.status).toBe(404);
    });
  });

  describe('paginated', () => {
    it('returns paginated response with correct metadata', async () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const response = paginated(items, 25, 1, 10);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data).toHaveLength(3);
      expect(body.pagination.total).toBe(25);
      expect(body.pagination.totalPages).toBe(3);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(10);
    });

    it('handles empty results', async () => {
      const response = paginated([], 0, 1, 10);
      const body = await response.json();
      expect(body.data).toHaveLength(0);
      expect(body.pagination.totalPages).toBe(0);
    });
  });
});
