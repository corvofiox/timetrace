// 基于 SQLite 的数据库实现
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getDataDir } = require('../config/keys');
const { dateUtils } = require('./fileDB');

const DATA_DIR = getDataDir();
const DB_FILE = path.join(DATA_DIR, 'timetrace.db');

let db = null;

// 日期序列化/反序列化辅助函数
const serializeDate = (date) => date instanceof Date ? date.toISOString() : date;
const deserializeDate = (value) => value ? new Date(value) : value;

// 初始化数据库连接和表结构
const init = () => {
  if (db) return;

  // 确保数据目录存在（与 fileDB 的 ensureDataDir 行为一致）
  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);

  // 目标表
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      color TEXT,
      date TEXT,
      [order] INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_goals_userId ON goals(userId);
  `);

  // 日计划表
  db.exec(`
    CREATE TABLE IF NOT EXISTS days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      date TEXT NOT NULL,
      summary TEXT,
      tasks TEXT NOT NULL DEFAULT '[]',
      timeEntries TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userId, date)
    );
    CREATE INDEX IF NOT EXISTS idx_days_userId_date ON days(userId, date);
    CREATE INDEX IF NOT EXISTS idx_days_userId ON days(userId);
  `);

  // 刷新令牌表
  db.exec(`
    CREATE TABLE IF NOT EXISTS refreshTokens (
      token TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_refreshTokens_userId ON refreshTokens(userId);
  `);
};

// 获取底层数据库实例（用于迁移等高级场景）
const getDb = () => db;

// 关闭数据库连接
const cleanup = () => {
  if (db) {
    db.close();
    db = null;
  }
};

// 兼容 fileDB 的 generateId 接口，实际不使用（SQLite 自增主键）
const generateId = async () => {
  throw new Error('sqliteDB 使用自增主键，不应调用 generateId');
};

// 用户数据操作
const users = {
  getAll: () => {
    const rows = db.prepare('SELECT * FROM users').all();
    return rows.map(row => ({
      ...row,
      createdAt: deserializeDate(row.createdAt)
    }));
  },

  findByEmail: (email) => {
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!row) return null;
    return {
      ...row,
      createdAt: deserializeDate(row.createdAt)
    };
  },

  findById: (id) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      createdAt: deserializeDate(row.createdAt)
    };
  },

  create: (userData) => {
    const now = serializeDate(new Date());
    const result = db.prepare(
      'INSERT INTO users (username, email, password, createdAt) VALUES (?, ?, ?, ?)'
    ).run(
      userData.username,
      userData.email.toLowerCase(),
      userData.password,
      now
    );
    return {
      id: result.lastInsertRowid,
      username: userData.username,
      email: userData.email.toLowerCase(),
      password: userData.password,
      createdAt: deserializeDate(now)
    };
  }
};

// 目标数据操作
const goals = {
  getAll: () => {
    const rows = db.prepare('SELECT * FROM goals').all();
    return rows.map(row => ({
      ...row,
      createdAt: deserializeDate(row.createdAt),
      updatedAt: deserializeDate(row.updatedAt)
    }));
  },

  getByUserId: (userId) => {
    const rows = db.prepare('SELECT * FROM goals WHERE userId = ?').all(userId);
    return rows.map(row => ({
      ...row,
      createdAt: deserializeDate(row.createdAt),
      updatedAt: deserializeDate(row.updatedAt)
    }));
  },

  findById: (id) => {
    const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      createdAt: deserializeDate(row.createdAt),
      updatedAt: deserializeDate(row.updatedAt)
    };
  },

  create: (goalData) => {
    const now = serializeDate(new Date());
    const result = db.prepare(
      'INSERT INTO goals (userId, title, description, color, date, [order], createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      goalData.userId,
      goalData.title,
      goalData.description || null,
      goalData.color || null,
      goalData.date ?? null,
      goalData.order ?? null,
      now
    );
    return {
      ...goalData,
      id: result.lastInsertRowid,
      createdAt: deserializeDate(now)
    };
  },

  update: (id, goalData) => {
    const now = serializeDate(new Date());
    const existing = goals.findById(id);
    if (!existing) return null;

    const fields = [];
    const values = [];

    if (goalData.title !== undefined) { fields.push('title = ?'); values.push(goalData.title); }
    if (goalData.description !== undefined) { fields.push('description = ?'); values.push(goalData.description); }
    if (goalData.color !== undefined) { fields.push('color = ?'); values.push(goalData.color); }
    if (goalData.date !== undefined) { fields.push('date = ?'); values.push(goalData.date); }
    if (goalData.order !== undefined) { fields.push('[order] = ?'); values.push(goalData.order); }
    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return goals.findById(id);
  },

  delete: (id) => {
    const existing = goals.findById(id);
    if (!existing) return null;
    db.prepare('DELETE FROM goals WHERE id = ?').run(id);
    return existing;
  },

  reorder: (goalIds) => {
    // 只更新列出的目标：按传入顺序分配 order 0..n-1，仅当 order 实际变化时才更新并 bump updatedAt。
    // 未列入的目标（含其他用户的目标）完全不动，与 fileDB 语义统一，避免跨用户改写与时间戳漂移
    const selectStmt = db.prepare('SELECT [order] FROM goals WHERE id = ?');
    const updateStmt = db.prepare('UPDATE goals SET [order] = ?, updatedAt = ? WHERE id = ?');
    const now = serializeDate(new Date());
    const updateTransaction = db.transaction(() => {
      goalIds.forEach((id, index) => {
        const existing = selectStmt.get(id);
        // 目标不存在(已删除)或 order 未变化：跳过，不 bump updatedAt
        if (!existing || existing.order === index) return;
        updateStmt.run(index, now, id);
      });
    });
    updateTransaction();
    return goals.getAll();
  }
};

// 日计划数据操作
// 容错解析 JSON 字段：脏数据(非 JSON 字符串)不抛 500，降级为空值并告警
const safeJsonParse = (value, fallback = []) => {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn('[sqliteDB] 解析 JSON 字段失败，使用空值兜底:', error.message);
    return fallback;
  }
};

const parseDayRow = (row) => {
  if (!row) return null;
  return {
    ...row,
    tasks: safeJsonParse(row.tasks, []),
    timeEntries: safeJsonParse(row.timeEntries, []),
    createdAt: deserializeDate(row.createdAt),
    updatedAt: deserializeDate(row.updatedAt)
  };
};

const days = {
  getAll: () => {
    const rows = db.prepare('SELECT * FROM days').all();
    return rows.map(parseDayRow);
  },

  getByUserId: (userId) => {
    const rows = db.prepare('SELECT * FROM days WHERE userId = ?').all(userId);
    return rows.map(parseDayRow);
  },

  getByDateRange: (startDate, endDate, userId = null) => {
    let rows;
    if (userId) {
      rows = db.prepare('SELECT * FROM days WHERE userId = ? AND date >= ? AND date <= ?').all(userId, startDate, endDate);
    } else {
      rows = db.prepare('SELECT * FROM days WHERE date >= ? AND date <= ?').all(startDate, endDate);
    }
    return rows.map(parseDayRow);
  },

  searchByKeyword: (keyword, userId = null) => {
    const keywords = keyword.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 0);

    if (keywords.length === 0) return [];

    let rows;
    if (userId) {
      rows = db.prepare('SELECT * FROM days WHERE userId = ? AND summary IS NOT NULL').all(userId);
    } else {
      rows = db.prepare('SELECT * FROM days WHERE summary IS NOT NULL').all();
    }

    const results = rows
      .filter(row => {
        const summaryLower = row.summary.toLowerCase();
        return keywords.every(k => summaryLower.includes(k));
      })
      .map(row => ({
        date: row.date,
        content: row.summary,
        type: 'summary'
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return results;
  },

  findById: (id) => {
    const row = db.prepare('SELECT * FROM days WHERE id = ?').get(id);
    return parseDayRow(row);
  },

  findByDate: (date, userId) => {
    const row = db.prepare('SELECT * FROM days WHERE date = ? AND userId = ?').get(date, userId);
    return parseDayRow(row);
  },

  createOrUpdate: (dayData) => {
    const existing = days.findByDate(dayData.date, dayData.userId);

    // 未提供的字段(undefined/null)回读已有值，避免部分更新被误判为"全空"而删除整条记录。
    // 例如 POST {date, tasks:[]} 缺少 summary/timeEntries 时不再误删已有日计划。
    const summary = dayData.summary !== undefined && dayData.summary !== null
      ? dayData.summary
      : (existing ? existing.summary : '');
    const tasks = dayData.tasks !== undefined && dayData.tasks !== null
      ? dayData.tasks
      : (existing ? existing.tasks : []);
    const timeEntries = dayData.timeEntries !== undefined && dayData.timeEntries !== null
      ? dayData.timeEntries
      : (existing ? existing.timeEntries : []);

    const isSummaryEmpty = !summary || String(summary).trim() === '';
    const areTasksEmpty = !Array.isArray(tasks) || tasks.length === 0;
    const areTimeEntriesEmpty = !Array.isArray(timeEntries) || timeEntries.length === 0;
    const shouldDelete = isSummaryEmpty && areTasksEmpty && areTimeEntriesEmpty;

    if (shouldDelete) {
      if (existing) {
        db.prepare('DELETE FROM days WHERE id = ?').run(existing.id);
      }
      return { deleted: true, message: 'No data to save' };
    }

    const now = serializeDate(new Date());
    const tasksJson = JSON.stringify(Array.isArray(tasks) ? tasks : []);
    const timeEntriesJson = JSON.stringify(Array.isArray(timeEntries) ? timeEntries : []);

    if (existing) {
      db.prepare(
        'UPDATE days SET summary = ?, tasks = ?, timeEntries = ?, updatedAt = ? WHERE id = ?'
      ).run(
        summary || '',
        tasksJson,
        timeEntriesJson,
        now,
        existing.id
      );
      return days.findById(existing.id);
    }

    const result = db.prepare(
      'INSERT INTO days (userId, date, summary, tasks, timeEntries, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      dayData.userId,
      dayData.date,
      summary || '',
      tasksJson,
      timeEntriesJson,
      now
    );
    return days.findById(result.lastInsertRowid);
  },

  delete: (id) => {
    const existing = days.findById(id);
    if (!existing) return null;
    db.prepare('DELETE FROM days WHERE id = ?').run(id);
    return existing;
  },

  batchUpdate: (daysList) => {
    const selectStmt = db.prepare('SELECT * FROM days WHERE userId = ? AND date = ?');
    const updateStmt = db.prepare(
      'UPDATE days SET summary = ?, tasks = ?, timeEntries = ?, updatedAt = ? WHERE userId = ? AND date = ?'
    );
    const insertStmt = db.prepare(
      'INSERT INTO days (userId, date, summary, tasks, timeEntries, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const deleteStmt = db.prepare('DELETE FROM days WHERE userId = ? AND date = ?');

    const now = serializeDate(new Date());

    const batchTransaction = db.transaction(() => {
      daysList.forEach(day => {
        // effective 语义（与单条 createOrUpdate 对齐）：缺省字段（undefined/null）先读现有行回读原值，
        // 删除判定基于合并后的 effective 值——缺 summary + 显式 tasks:[] 时保留已有 summary 不清空不误删
        const existing = selectStmt.get(day.userId, day.date);
        const summary = day.summary !== undefined && day.summary !== null
          ? day.summary
          : (existing ? existing.summary : '');
        const tasks = day.tasks !== undefined && day.tasks !== null
          ? day.tasks
          : (existing ? safeJsonParse(existing.tasks, []) : []);
        const timeEntries = day.timeEntries !== undefined && day.timeEntries !== null
          ? day.timeEntries
          : (existing ? safeJsonParse(existing.timeEntries, []) : []);

        const isSummaryEmpty = !summary || String(summary).trim() === '';
        const areTasksEmpty = !Array.isArray(tasks) || tasks.length === 0;
        const areTimeEntriesEmpty = !Array.isArray(timeEntries) || timeEntries.length === 0;
        const shouldDelete = isSummaryEmpty && areTasksEmpty && areTimeEntriesEmpty;

        if (shouldDelete) {
          deleteStmt.run(day.userId, day.date);
          return;
        }

        const tasksJson = JSON.stringify(Array.isArray(tasks) ? tasks : []);
        const timeEntriesJson = JSON.stringify(Array.isArray(timeEntries) ? timeEntries : []);

        if (existing) {
          updateStmt.run(summary || '', tasksJson, timeEntriesJson, now, day.userId, day.date);
        } else {
          insertStmt.run(day.userId, day.date, summary || '', tasksJson, timeEntriesJson, now);
        }
      });
    });

    batchTransaction();
    // 返回实际保存的记录（含自动生成的 id），已删除的日期不返回
    return daysList
      .map(day => days.findByDate(day.date, day.userId))
      .filter(day => day !== null);
  }
};

// 刷新令牌数据操作
const parseRefreshTokenRow = (row) => {
  if (!row) return null;
  return {
    ...row,
    createdAt: deserializeDate(row.createdAt)
  };
};

const refreshTokens = {
  getAll: () => {
    const rows = db.prepare('SELECT * FROM refreshTokens').all();
    return rows.map(parseRefreshTokenRow);
  },

  save: (token, userId) => {
    const now = serializeDate(new Date());
    // DELETE+INSERT 放入同一事务，避免 INSERT 失败时旧令牌已删、新令牌未存导致用户被登出
    db.transaction(() => {
      db.prepare('DELETE FROM refreshTokens WHERE userId = ?').run(userId);
      db.prepare('INSERT INTO refreshTokens (token, userId, createdAt) VALUES (?, ?, ?)').run(token, userId, now);
    })();
  },

  find: (token, maxAgeDays = 7) => {
    const row = db.prepare('SELECT * FROM refreshTokens WHERE token = ?').get(token);
    if (!row) return null;

    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const createdAt = new Date(row.createdAt);
    const age = Date.now() - createdAt.getTime();

    if (age > maxAgeMs) {
      db.prepare('DELETE FROM refreshTokens WHERE token = ?').run(token);
      return null;
    }

    return parseRefreshTokenRow(row);
  },

  delete: (token) => {
    const row = db.prepare('SELECT * FROM refreshTokens WHERE token = ?').get(token);
    if (!row) return null;
    db.prepare('DELETE FROM refreshTokens WHERE token = ?').run(token);
    return parseRefreshTokenRow(row);
  },

  rotate: (oldToken, newToken, userId) => {
    const now = serializeDate(new Date());
    // DELETE+INSERT 放入同一事务，避免 INSERT 失败时旧令牌已删、新令牌未存导致用户被登出
    db.transaction(() => {
      db.prepare('DELETE FROM refreshTokens WHERE token = ?').run(oldToken);
      db.prepare('DELETE FROM refreshTokens WHERE userId = ?').run(userId);
      db.prepare('INSERT INTO refreshTokens (token, userId, createdAt) VALUES (?, ?, ?)').run(newToken, userId, now);
    })();
    return { token: newToken, userId, createdAt: deserializeDate(now) };
  },

  deleteAllByUserId: (userId) => {
    const result = db.prepare('DELETE FROM refreshTokens WHERE userId = ?').run(userId);
    return result.changes;
  },

  cleanExpiredTokens: (maxAgeDays = 7) => {
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = db.prepare('DELETE FROM refreshTokens WHERE createdAt < ?').run(cutoff);
    return result.changes;
  }
};

module.exports = {
  users,
  goals,
  days,
  refreshTokens,
  generateId,
  init,
  cleanup,
  getDb,
  dateUtils
};
