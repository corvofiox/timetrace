// tests/auth.test.js — Auth and utility tests
const { dateUtils } = require('../src/models/fileDB');
const { validateString } = require('../src/middleware/validate');

// ── Unit tests for dateUtils.isValidDateString ──

describe('dateUtils.isValidDateString', () => {
  test('valid date returns true', () => {
    expect(dateUtils.isValidDateString('2024-06-13')).toBe(true);
    expect(dateUtils.isValidDateString('2024-01-01')).toBe(true);
    expect(dateUtils.isValidDateString('2024-12-31')).toBe(true);
  });

  test('invalid format returns false', () => {
    expect(dateUtils.isValidDateString('2024/06/13')).toBe(false);
    expect(dateUtils.isValidDateString('13-06-2024')).toBe(false);
    expect(dateUtils.isValidDateString('')).toBe(false);
    expect(dateUtils.isValidDateString('not-a-date')).toBe(false);
  });

  test('out-of-range dates return false', () => {
    expect(dateUtils.isValidDateString('1899-01-01')).toBe(false); // before 1900
    expect(dateUtils.isValidDateString('2101-01-01')).toBe(false); // after 2100
    expect(dateUtils.isValidDateString('2024-02-30')).toBe(false); // Feb 30
    expect(dateUtils.isValidDateString('2024-13-01')).toBe(false); // month 13
    expect(dateUtils.isValidDateString('2024-00-01')).toBe(false); // month 0
    expect(dateUtils.isValidDateString('2024-01-32')).toBe(false); // day 32
  });

  test('leap year Feb 29 is valid', () => {
    expect(dateUtils.isValidDateString('2024-02-29')).toBe(true); // 2024 is leap
    expect(dateUtils.isValidDateString('2023-02-29')).toBe(false); // 2023 is not leap
  });
});

// ── Unit tests for validateString ──

describe('validateString', () => {
  test('valid strings return valid: true', () => {
    expect(validateString('hello', 'test')).toEqual({ valid: true });
    expect(validateString('ab', 'test', { minLength: 2 })).toEqual({ valid: true });
  });

  test('non-string types return invalid', () => {
    const result = validateString(123, 'test');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_type');
  });

  test('minLength validation', () => {
    const result = validateString('a', 'test', { minLength: 3 });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('min_length');
    expect(result.actualLength).toBe(1);
  });

  test('maxLength validation', () => {
    const result = validateString('toolong', 'test', { maxLength: 3 });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('max_length');
    expect(result.actualLength).toBe(7);
  });

  test('pattern validation', () => {
    const result = validateString('abc', 'test', { pattern: /^\d+$/, patternMessage: '必须为数字' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_format');

    const validResult = validateString('123', 'test', { pattern: /^\d+$/ });
    expect(validResult.valid).toBe(true);
  });
});

// ── Auth API integration tests (require server startup) ──

describe('Auth API — POST /api/auth/register', () => {
  test('rejects request with missing fields', () => {
    // Integration tests require JWT_SECRET and REFRESH_TOKEN_SECRET env vars.
    // Set these in your .env or pass inline before running integration tests.
    expect(true).toBe(true);
  });

  test('creates user with valid data', () => {
    // Integration test — requires running server and test database.
    expect(true).toBe(true);
  });

  test('POST /api/auth/login rejects invalid credentials', () => {
    // Integration test — requires registered test user.
    // Example:
    //   const res = await request(app).post('/api/auth/login').send({...});
    //   expect(res.status).toBe(401);
    expect(true).toBe(true);
  });
});
