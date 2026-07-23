// 数据库入口，根据环境变量 DB_TYPE 选择使用 JSON 文件数据库或 SQLite
const fileDB = require('./fileDB');
const sqliteDB = require('./sqliteDB');
const { migrateFromJson } = require('./migrate');

const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase();
const useSqlite = DB_TYPE === 'sqlite';

// 获取当前使用的数据库实现
const getDB = () => {
  return useSqlite ? sqliteDB : fileDB;
};

// 初始化数据库（自动迁移 JSON 数据到 SQLite）
let dbInitialized = false;
const ensureDBInitialized = async () => {
  if (!dbInitialized) {
    const db = getDB();
    await db.init();

    // SQLite 模式下自动执行 JSON 数据迁移
    if (useSqlite) {
      migrateFromJson();
    }

    dbInitialized = true;
  }
};

// 查找用户
const findUserByEmail = async (email) => {
  await ensureDBInitialized();
  return await getDB().users.findByEmail(email);
};

// 查找用户
const findUserById = async (id) => {
  await ensureDBInitialized();
  return await getDB().users.findById(id);
};

// 获取所有用户（用于用户名唯一性校验）
const getAllUsers = async () => {
  await ensureDBInitialized();
  return await getDB().users.getAll();
};

// 创建用户
const createUser = async (userData) => {
  await ensureDBInitialized();
  return await getDB().users.create(userData);
};

// 获取所有目标
const getAllGoals = async () => {
  await ensureDBInitialized();
  return await getDB().goals.getAll();
};

// 根据用户ID获取目标（性能优化版本）
const getGoalsByUserId = async (userId) => {
  await ensureDBInitialized();
  return await getDB().goals.getByUserId(userId);
};

// 根据ID获取目标
const getGoalById = async (id) => {
  await ensureDBInitialized();
  return await getDB().goals.findById(id);
};

// 创建目标
const createGoal = async (goalData) => {
  await ensureDBInitialized();
  return await getDB().goals.create(goalData);
};

// 更新目标
const updateGoal = async (id, goalData) => {
  await ensureDBInitialized();
  return await getDB().goals.update(id, goalData);
};

// 删除目标
const deleteGoal = async (id) => {
  await ensureDBInitialized();
  return await getDB().goals.delete(id);
};

const reorderGoals = async (goalIds) => {
  await ensureDBInitialized();
  return await getDB().goals.reorder(goalIds);
};

// 获取所有日计划
const getAllDays = async () => {
  await ensureDBInitialized();
  return await getDB().days.getAll();
};

// 根据用户ID获取日计划（性能优化版本）
const getDaysByUserId = async (userId) => {
  await ensureDBInitialized();
  return await getDB().days.getByUserId(userId);
};

// 获取指定日期范围内的日计划（性能优化版本）
const getDaysByDateRange = async (startDate, endDate, userId) => {
  await ensureDBInitialized();
  return await getDB().days.getByDateRange(startDate, endDate, userId);
};

// 搜索包含指定关键词的日计划（性能优化版本）
const searchDaysByKeyword = async (keyword, userId) => {
  await ensureDBInitialized();
  return await getDB().days.searchByKeyword(keyword, userId);
};

// 根据ID获取日计划
const getDayById = async (id) => {
  await ensureDBInitialized();
  return await getDB().days.findById(id);
};

// 根据日期获取日计划
const getDayByDate = async (date, userId) => {
  await ensureDBInitialized();
  return await getDB().days.findByDate(date, userId);
};

// 创建或更新日计划
const createOrUpdateDay = async (dayData) => {
  await ensureDBInitialized();
  return await getDB().days.createOrUpdate(dayData);
};

// 删除日计划
const deleteDay = async (id) => {
  await ensureDBInitialized();
  return await getDB().days.delete(id);
};

// 批量更新日计划
const batchUpdateDays = async (days) => {
  await ensureDBInitialized();
  return await getDB().days.batchUpdate(days);
};

// 刷新令牌相关函数
// 保存刷新令牌
const saveRefreshToken = async (token, userId) => {
  await ensureDBInitialized();
  await getDB().refreshTokens.save(token, userId);
};

// 查找刷新令牌
const findRefreshToken = async (token, maxAgeDays = 7) => {
  await ensureDBInitialized();
  return await getDB().refreshTokens.find(token, maxAgeDays);
};

// 删除刷新令牌
const deleteRefreshToken = async (token) => {
  await ensureDBInitialized();
  return await getDB().refreshTokens.delete(token);
};

// 原子化轮换刷新令牌
const rotateRefreshToken = async (oldToken, newToken, userId) => {
  await ensureDBInitialized();
  return await getDB().refreshTokens.rotate(oldToken, newToken, userId);
};

// 删除用户的所有刷新令牌
const deleteAllUserRefreshTokens = async (userId) => {
  await ensureDBInitialized();
  return await getDB().refreshTokens.deleteAllByUserId(userId);
};

// 清理过期的刷新令牌
const cleanExpiredRefreshTokens = async (maxAgeDays = 7) => {
  await ensureDBInitialized();
  return await getDB().refreshTokens.cleanExpiredTokens(maxAgeDays);
};

// 数据库清理（关闭连接等）
const cleanup = async () => {
  await getDB().cleanup();
};

module.exports = {
  init: ensureDBInitialized,
  DB_TYPE,
  findUserByEmail,
  findUserById,
  getAllUsers,
  createUser,
  getAllGoals,
  getGoalsByUserId,
  getGoalById,
  createGoal,
  updateGoal,
  deleteGoal,
  reorderGoals,
  getAllDays,
  getDaysByUserId,
  getDaysByDateRange,
  searchDaysByKeyword,
  getDayById,
  getDayByDate,
  createOrUpdateDay,
  deleteDay,
  batchUpdateDays,
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  rotateRefreshToken,
  deleteAllUserRefreshTokens,
  cleanExpiredRefreshTokens,
  cleanup
};
