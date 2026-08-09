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

// 迁移完成标记：迁移成功后把源文件改名 <file>.migrated（保留源数据不删除）。
// 重启时仅扫描仍存在的源文件，避免"用户已删除的数据/已登出的令牌"从 JSON 复活
const MIGRATED_SUFFIX = '.migrated';

/**
 * 检查源 JSON 文件是否有待迁移数据。
 * 迁移成功的文件会被改名 <file>.migrated（源文件不再存在），
 * 因此"普通文件名仍存在"即代表尚未迁移，或迁移后新写入的数据文件
 * @param {string} fileName
 * @returns {boolean}
 */
function isPending(fileName) {
  return fs.existsSync(path.join(DATA_DIR, fileName));
}

/**
 * 迁移成功后给源 JSON 文件打完成标记：改名 <file>.migrated。
 * 若目标名已被占用（旧标记仍存在，说明出现了新的同名数据文件），
 * 追加数字后缀避免覆盖旧标记数据。
 * @param {string} fileName
 */
function markMigrated(fileName) {
  const src = path.join(DATA_DIR, fileName);
  let dst = path.join(DATA_DIR, fileName + MIGRATED_SUFFIX);
  let suffix = 1;
  while (fs.existsSync(dst)) {
    dst = path.join(DATA_DIR, `${fileName}.migrated.${suffix}`);
    suffix += 1;
  }
  fs.renameSync(src, dst);
}

/**
 * 按指定键去重，保留最后一条（JSON 数组中靠后的视为最新）
 * 避免 INSERT 触发主键冲突拖垮整个迁移
 * 注意：去重键按集合区分——users/goals/days 用 id；
 * refreshTokens 旧版 JSON 结构只有 {token, userId, createdAt} 无 id 字段，
 * 必须按 token 去重，否则全部记录被丢弃导致迁移后 0 条、所有用户被登出
 * @param {Array} records
 * @param {string} key 去重字段名，默认 'id'
 */
function dedupById(records, key = 'id') {
  const map = new Map();
  (records || []).forEach(record => {
    if (record && record[key] !== undefined && record[key] !== null) {
      map.set(String(record[key]), record);
    }
  });
  return Array.from(map.values());
}

/**
 * 日计划按 (userId, date) 去重，保留最后一条（视为最新）
 * SQLite days 表有 UNIQUE(userId, date) 约束，重复数据会直接冲突
 */
function dedupDays(records) {
  const map = new Map();
  (records || []).forEach(record => {
    if (record && record.userId !== undefined && record.date) {
      map.set(`${record.userId}:${record.date}`, record);
    }
  });
  return Array.from(map.values());
}

/**
 * 执行从 JSON 到 SQLite 的迁移（幂等增量迁移）
 * - 只读取仍存在的源文件：迁移成功的文件会被改名 <file>.migrated 标记，重启不重跑，
 *   已删除/已登出的数据不会从 JSON 复活；迁移后新写入的数据文件仍会被增量迁移
 * - 迁移前清洗数据：按 id 去重(保留最新)、日计划按 (userId,date) 去重
 * - 跳过悬空外键（goal.userId / day.userId / token.userId 对应的用户不存在）的记录
 * - 单条失败仅跳过该条并告警，不拖垮整个迁移
 * @returns {{success: boolean, message: string, counts: Object}}
 */
function migrateFromJson() {
  const counts = {
    users: 0,
    goals: 0,
    days: 0,
    refreshTokens: 0
  };

  // 只读取仍有待迁移数据的源文件（普通文件名存在 = 未迁移或新写入的数据文件）；
  // 已迁移的文件已被改名 <file>.migrated，不再读取
  const sources = {
    users: { fileName: 'users.json', records: [] },
    goals: { fileName: 'goals.json', records: [] },
    days: { fileName: 'days.json', records: [] },
    refreshTokens: { fileName: 'refreshTokens.json', records: [] }
  };
  Object.values(sources).forEach(source => {
    if (isPending(source.fileName)) {
      source.records = readJsonFile(source.fileName);
    }
  });

  const pending = Object.values(sources).filter(source => source.records.length > 0);
  // 没有待迁移数据：全部已标记完成，或文件为空/不存在
  if (pending.length === 0) {
    return {
      success: true,
      message: '没有未迁移的 JSON 数据文件，跳过迁移',
      counts
    };
  }

  console.log('[数据迁移] 开始从 JSON 迁移到 SQLite...');

  const db = sqliteDB.getDb ? sqliteDB.getDb() : null;
  if (!db) {
    console.error('[数据迁移] SQLite 未初始化，跳过迁移');
    return {
      success: false,
      message: 'SQLite 未初始化，跳过迁移',
      counts
    };
  }

  // 数据清洗：按主键去重(保留最新)；days 额外按 (userId, date) 去重
  // 去重键按集合区分：users/goals/days 用 id；refreshTokens 旧结构无 id，按 token 去重
  const cleanUsers = dedupById(sources.users.records, 'id');
  const cleanGoals = dedupById(sources.goals.records, 'id');
  const cleanDays = dedupDays(dedupById(sources.days.records, 'id'));
  const cleanTokens = dedupById(sources.refreshTokens.records, 'token');

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

  // 合法用户 id 集合 = SQLite 已有用户 ∪ 本次成功插入的用户（增量迁移时避免悬空外键）
  const validUserIds = new Set(
    (sqliteDB.users.getAll ? sqliteDB.users.getAll() : []).map(user => String(user.id))
  );

  const skipRecord = (type, id, error) => {
    console.warn(`[数据迁移] 跳过${type} ${id}: ${error.message}`);
  };

  const migrateTransaction = db.transaction(() => {
    cleanUsers.forEach(user => {
      try {
        insertUser.run(
          user.id,
          user.username,
          String(user.email || '').toLowerCase(),
          user.password,
          user.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString()
        );
        counts.users++;
        validUserIds.add(String(user.id));
      } catch (error) {
        // 主键/email/username 唯一冲突等：跳过该条，不拖垮迁移（重复数据已在清洗阶段去除）
        skipRecord('用户', user.id, error);
      }
    });

    cleanGoals.forEach(goal => {
      // 跳过悬空外键：所属用户不存在
      if (!validUserIds.has(String(goal.userId))) {
        console.warn(`[数据迁移] 跳过目标 ${goal.id}: 所属用户 ${goal.userId} 不存在（悬空外键）`);
        return;
      }
      try {
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
      } catch (error) {
        skipRecord('目标', goal.id, error);
      }
    });

    cleanDays.forEach(day => {
      // 跳过悬空外键：所属用户不存在
      if (!validUserIds.has(String(day.userId))) {
        console.warn(`[数据迁移] 跳过日计划 ${day.date}: 所属用户 ${day.userId} 不存在（悬空外键）`);
        return;
      }
      try {
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
      } catch (error) {
        // UNIQUE(userId, date) 冲突等：跳过该条
        skipRecord('日计划', `${day.date}(${day.userId})`, error);
      }
    });

    cleanTokens.forEach(token => {
      // 跳过悬空外键：所属用户不存在
      if (!validUserIds.has(String(token.userId))) {
        console.warn(`[数据迁移] 跳过刷新令牌: 所属用户 ${token.userId} 不存在（悬空外键）`);
        return;
      }
      try {
        insertToken.run(
          token.token,
          token.userId,
          token.createdAt ? new Date(token.createdAt).toISOString() : new Date().toISOString()
        );
        counts.refreshTokens++;
      } catch (error) {
        skipRecord('刷新令牌', token.token, error);
      }
    });
  });

  migrateTransaction();

  // 迁移成功后对每个有数据的源文件打完成标记（改名保留源数据，不删除）。
  // 之后重启不会再重跑迁移，已删除/已登出的数据不会从 JSON 复活；
  // 标记失败仅告警，下次启动会重试（INSERT 幂等，重复数据被唯一约束跳过）
  pending.forEach(source => {
    try {
      markMigrated(source.fileName);
    } catch (error) {
      console.warn(`[数据迁移] 标记 ${source.fileName} 迁移完成失败(下次启动将重试):`, error.message);
    }
  });

  console.log('[数据迁移] 迁移完成:', counts);

  return {
    success: true,
    message: 'JSON 数据已成功迁移到 SQLite',
    counts
  };
}

module.exports = {
  migrateFromJson
};
