// tests/auth.test.js — Auth and utility tests
const path = require('path');
const fs = require('fs');
const os = require('os');

// 必须在加载文件数据库模块前设置测试环境变量与数据目录
const testDataDir = path.join(os.tmpdir(), 'timetrace-test-' + Date.now());
fs.mkdirSync(testDataDir, { recursive: true });
process.env.DATA_DIR = testDataDir;
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-must-be-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

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

// ── Auth API integration tests ──

const request = require('supertest');

const { app } = require('../src/server');
const { initConfig } = require('../src/config/keys');
const fileDB = require('../src/models/fileDB');

let emailCounter = 0;

function getTestDataFile(fileName) {
  return path.join(testDataDir, fileName);
}

function clearDataFiles() {
  ['users.json', 'refreshTokens.json', 'goals.json', 'days.json'].forEach((fileName) => {
    const filePath = getTestDataFile(fileName);
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '[]', 'utf8');
    }
  });
}

beforeAll(async () => {
  initConfig();
  await fileDB.init();
});

beforeEach(() => {
  emailCounter += 1;
  clearDataFiles();
});

afterAll(async () => {
  if (testDataDir && fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

describe('Auth API integration', () => {
  const uniqueEmail = () => `test-${Date.now()}-${emailCounter}-${Math.random().toString(36).slice(2)}@example.com`;

  test('POST /api/auth/register rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({})
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/auth/register creates user with valid data', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'testuser', email: uniqueEmail(), password: 'password123' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  test('POST /api/auth/register rejects duplicate username case-insensitively', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'dupuser', email, password: 'password123' })
      .expect(201);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'DUPUSER', email: uniqueEmail(), password: 'password123' })
      .expect(409);
    expect(res.body.errorCode).toBe('REG_002');
  });

  test('POST /api/auth/register rejects password exceeding max length', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'longpass', email: uniqueEmail(), password: 'a'.repeat(129) })
      .expect(400);
    expect(res.body.errorCode).toBe('VAL_003');
  });

  test('POST /api/auth/login rejects invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notfound@example.com', password: 'wrongpassword' })
      .expect(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/auth/login returns tokens for valid credentials', async () => {
    const email = uniqueEmail();
    const password = 'password123';
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'loginuser', email, password })
      .expect(201);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  test('POST /api/auth/logout rejects deleting token not owned', async () => {
    const reg1 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'user1', email: uniqueEmail(), password: 'password123' })
      .expect(201);
    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'user2', email: uniqueEmail(), password: 'password123' })
      .expect(201);
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${reg1.body.token}`)
      .send({ refreshToken: reg2.body.refreshToken })
      .expect(401);
    expect(res.body.errorCode).toBe('AUTH_006');
  });

  test('POST /api/auth/refresh rotates refresh token atomically', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'refreshuser', email: uniqueEmail(), password: 'password123' })
      .expect(201);
    const refreshToken = reg.body.refreshToken;

    // 等待 1 秒确保新的 refreshToken 与旧的不相同（JWT iat 精度为秒）
    await new Promise(resolve => setTimeout(resolve, 1000));

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(refreshToken);

    // 旧刷新令牌应已失效
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });
});

describe('Days API integration', () => {
  const uniqueEmail = () => `test-${Date.now()}-${emailCounter}-${Math.random().toString(36).slice(2)}@example.com`;
  const today = new Date().toISOString().split('T')[0];

  test('POST /api/days/batch rejects invalid timeEntries', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'batchvalid', email: uniqueEmail(), password: 'password123' })
      .expect(201);

    const res = await request(app)
      .post('/api/days/batch')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        days: [{
          date: today,
          timeEntries: [{ goalId: '1', startTime: '25:00', endTime: '26:00' }]
        }]
      })
      .expect(400);
    expect(res.body.errorCode).toBe('DAY_004');
  });

  test('POST /api/days preserves day with only timeEntries', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'timeentry', email: uniqueEmail(), password: 'password123' })
      .expect(201);

    const goalRes = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ title: '专注目标', color: '#ff0000', date: `${today}T09:00` })
      .expect(201);
    const goalId = goalRes.body.data.id;

    await request(app)
      .post('/api/days')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        date: today,
        summary: '',
        tasks: [],
        timeEntries: [{ goalId, startTime: '09:00', endTime: '10:00' }]
      })
      .expect(201);

    const dayRes = await request(app)
      .get(`/api/days/date/${today}`)
      .set('Authorization', `Bearer ${reg.body.token}`)
      .expect(200);
    expect(dayRes.body.data.timeEntries).toHaveLength(1);
  });

  test('GET /api/days/:id returns DAY_NO_PERMISSION for other user', async () => {
    const reg1 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'owner', email: uniqueEmail(), password: 'password123' })
      .expect(201);
    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'intruder', email: uniqueEmail(), password: 'password123' })
      .expect(201);

    const dayRes = await request(app)
      .post('/api/days')
      .set('Authorization', `Bearer ${reg1.body.token}`)
      .send({ date: today, summary: '私有笔记', tasks: [] })
      .expect(201);

    const res = await request(app)
      .get(`/api/days/${dayRes.body.data.id}`)
      .set('Authorization', `Bearer ${reg2.body.token}`)
      .expect(401);
    expect(res.body.errorCode).toBe('DAY_006');
  });
});
