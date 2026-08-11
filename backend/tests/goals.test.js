// tests/goals.test.js — Goals API tests (2.0 dual-color support)
const path = require('path');
const fs = require('fs');
const os = require('os');

// 必须在加载文件数据库模块前设置测试环境变量与数据目录
const testDataDir = path.join(os.tmpdir(), 'timetrace-goals-test-' + Date.now());
fs.mkdirSync(testDataDir, { recursive: true });
process.env.DATA_DIR = testDataDir;
process.env.DB_TYPE = 'json';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-must-be-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const request = require('supertest');

const { app } = require('../src/server');
const { initConfig } = require('../src/config/keys');
const fileDB = require('../src/models/fileDB');

let emailCounter = 0;

function clearDataFiles() {
  ['users.json', 'refreshTokens.json', 'goals.json', 'days.json'].forEach((fileName) => {
    const filePath = path.join(testDataDir, fileName);
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

describe('Goals API — color validation (2.0 dual-color)', () => {
  const uniqueEmail = () => `goal-test-${Date.now()}-${emailCounter}-${Math.random().toString(36).slice(2)}@example.com`;

  const register = async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: `goaluser${emailCounter}`, email: uniqueEmail(), password: 'password123' })
      .expect(201);
    return res.body.token;
  };

  test('POST /api/goals accepts dual-color #RRGGBB,#RRGGBB', async () => {
    const token = await register();

    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '双色渐变目标', color: '#6366f1,#a855f7' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.color).toBe('#6366f1,#a855f7');
  });

  test('POST /api/goals still accepts single color #RRGGBB', async () => {
    const token = await register();

    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '单色目标', color: '#3498db' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.color).toBe('#3498db');
  });

  test('POST /api/goals rejects invalid color formats', async () => {
    const token = await register();

    for (const badColor of ['red', '#12345', '#6366f1,#a855f7,#000000']) {
      const res = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: '非法颜色', color: badColor })
        .expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('GOAL_003');
    }
  });
});

describe('Goals API — updateGoal color handling (2.0 dual-color)', () => {
  const uniqueEmail = () => `goal-upd-${Date.now()}-${emailCounter}-${Math.random().toString(36).slice(2)}@example.com`;

  const register = async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: `goalupd${emailCounter}`, email: uniqueEmail(), password: 'password123' })
      .expect(201);
    return res.body.token;
  };

  const createGoal = async (token) => {
    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '待更新目标', color: '#3498db' })
      .expect(201);
    return res.body.data;
  };

  test('PUT /api/goals/:id updates color to dual-color #RRGGBB,#RRGGBB', async () => {
    const token = await register();
    const goal = await createGoal(token);

    const res = await request(app)
      .put(`/api/goals/${goal.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ color: '#6366f1,#a855f7' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.color).toBe('#6366f1,#a855f7');
  });

  test('PUT /api/goals/:id explicitly clears color with empty string', async () => {
    const token = await register();
    const goal = await createGoal(token);

    const res = await request(app)
      .put(`/api/goals/${goal.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ color: '' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.color).toBeNull();
  });

  test('PUT /api/goals/:id rejects invalid color formats', async () => {
    const token = await register();
    const goal = await createGoal(token);

    const res = await request(app)
      .put(`/api/goals/${goal.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ color: 'red' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('GOAL_003');
  });
});
