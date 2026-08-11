// tests/search.test.js — Day search: task-title matching + summary + AND semantics (2.0)
const path = require('path');
const fs = require('fs');
const os = require('os');

// 必须在加载文件数据库模块前设置测试环境变量与数据目录
const testDataDir = path.join(os.tmpdir(), 'timetrace-search-test-' + Date.now());
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

describe('Days API — search by keyword (2.0 task-title matching)', () => {
  const uniqueEmail = () => `search-test-${Date.now()}-${emailCounter}-${Math.random().toString(36).slice(2)}@example.com`;

  const register = async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: `searchuser${emailCounter}`, email: uniqueEmail(), password: 'password123' })
      .expect(201);
    return res.body.token;
  };

  const createDay = async (token, dayData) => {
    await request(app)
      .post('/api/days')
      .set('Authorization', `Bearer ${token}`)
      .send(dayData)
      .expect(201);
  };

  const search = async (token, keyword) => {
    const res = await request(app)
      .get('/api/days/search')
      .query({ keyword })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    return res.body.data;
  };

  test('keyword hitting a task title returns type:task', async () => {
    const token = await register();

    await createDay(token, {
      date: '2026-08-09',
      summary: '完成季度复盘',
      tasks: [{ title: '整理周报', completed: false }]
    });

    const results = await search(token, '周报');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      date: '2026-08-09',
      content: '整理周报',
      type: 'task'
    });
  });

  test('keyword hitting summary returns type:summary', async () => {
    const token = await register();

    await createDay(token, {
      date: '2026-08-08',
      summary: '完成季度复盘',
      tasks: [{ title: '整理周报', completed: false }]
    });

    const results = await search(token, '复盘');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      date: '2026-08-08',
      content: '完成季度复盘',
      type: 'summary'
    });
  });

  test('same-day summary and task both matching yield two records', async () => {
    const token = await register();

    await createDay(token, {
      date: '2026-08-07',
      summary: '整理周报',
      tasks: [{ title: '整理周报', completed: false }]
    });

    const results = await search(token, '周报');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.type).sort()).toEqual(['summary', 'task']);
  });

  test('two keywords use AND semantics across summary and task titles', async () => {
    const token = await register();

    await createDay(token, {
      date: '2026-08-09',
      summary: '完成季度复盘',
      tasks: [
        { title: '整理周报', completed: false },
        { title: '回复邮件', completed: false }
      ]
    });

    // 双词同时命中同一任务标题
    const bothInTitle = await search(token, '整理 周报');
    expect(bothInTitle).toHaveLength(1);
    expect(bothInTitle[0]).toMatchObject({ type: 'task', content: '整理周报' });

    // 双词同时命中 summary
    const bothInSummary = await search(token, '季度 复盘');
    expect(bothInSummary).toHaveLength(1);
    expect(bothInSummary[0]).toMatchObject({ type: 'summary', content: '完成季度复盘' });

    // 双词分散在不同任务标题中 → 不命中（AND 语义：单个标题必须包含全部关键词）
    const splitAcross = await search(token, '整理 邮件');
    expect(splitAcross).toHaveLength(0);
  });
});
