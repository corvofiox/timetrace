// JSON 文件数据库无损迁移到 SQLite
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../config/keys');
const sqliteDB = require('./sqliteDB');

const DATA_DIR = getDataDir();

/**
 * 读取 JSON 文件，返回数组
 * @param {string} fileName
 * @returns {Array}
 */
function readJsonFile(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    if (!data.trim()) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`[迁移失败] 读取 ${fileName} 出错:`, error.message);
    return [];
  }
}

/**
 * 检查 SQLite 数据库是否为空（无用户数据）
 * @returns {boolean}
 */
function isSQLiteEmpty() {
  const result = sqliteDB.users.getAll();
  return result.length === 0;
}

/**
 * 执行从 JSON 到 SQLite 的无损迁移
 * @returns {{success: boolean, message: string, counts: Object}}
 */
function migrateFromJson() {
  const counts = {
    users: 0,
    goals: 0,
    days: 0,
    refreshTokens: 0
  };

  // 如果 SQLite 已有数据，跳过迁移
  if (!isSQLiteEmpty()) {
    return {
      success: true,
      message: 'SQLite 数据库已有数据，跳过迁移',
      counts
    };
  }

  const users = readJsonFile('users.json');
  const goals = readJsonFile('goals.json');
  const days = readJsonFile('days.json');
  const refreshTokens = readJsonFile('refreshTokens.json');

  // 如果 JSON 文件全部为空，无需迁移
  if (users.length === 0 && goals.length === 0 && days.length === 0 && refreshTokens.length === 0) {
    return {
      success: true,
      message: 'JSON 文件为空，无需迁移',
      counts
    };
  }

  console.log('[数据迁移] 开始从 JSON 迁移到 SQLite...');

  const db = sqliteDB.getDb ? sqliteDB.getDb() : null;
  const insertUser = db.prepare(
    'INSERT INTO users (id, username, email, password, createdAt) VALUES (?, ?, ?, ?, ?)'
  );
  const insertGoal = db.prepare(
    'INSERT INTO goals (id, userId, title, description, color, date, [order], createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertDay = db.prepare(
    'INSERT INTO days (id, userId, date, summary, tasks, timeEntries, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertToken = db.prepare(
    'INSERT INTO refreshTokens (token, userId, createdAt) VALUES (?, ?, ?)'
  );

  const migrateTransaction = db.transaction(() => {
    users.forEach(user => {
      insertUser.run(
        user.id,
        user.username,
        user.email.toLowerCase(),
        user.password,
        user.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString()
      );
      counts.users++;
    });

    goals.forEach(goal => {
      insertGoal.run(
        goal.id,
        goal.userId,
        goal.title,
        goal.description || null,
        goal.color || null,
        goal.date ?? null,
        goal.order ?? null,
        goal.createdAt ? new Date(goal.createdAt).toISOString() : new Date().toISOString(),
        goal.updatedAt ? new Date(goal.updatedAt).toISOString() : null
      );
      counts.goals++;
    });

    days.forEach(day => {
      insertDay.run(
        day.id,
        day.userId,
        day.date,
        day.summary || '',
        JSON.stringify(day.tasks || []),
        JSON.stringify(day.timeEntries || []),
        day.createdAt ? new Date(day.createdAt).toISOString() : new Date().toISOString(),
        day.updatedAt ? new Date(day.updatedAt).toISOString() : null
      );
      counts.days++;
    });

    refreshTokens.forEach(token => {
      insertToken.run(
        token.token,
        token.userId,
        token.createdAt ? new Date(token.createdAt).toISOString() : new Date().toISOString()
      );
      counts.refreshTokens++;
    });
  });

  migrateTransaction();

  console.log('[数据迁移] 迁移完成:', counts);

  return {
    success: true,
    message: 'JSON 数据已成功迁移到 SQLite',
    counts
  };
}

module.exports = {
  migrateFromJson,
  isSQLiteEmpty
};
