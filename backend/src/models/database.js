// 基于JSON文件的数据库实现，支持数据持久化
const fileDB = require('./fileDB');

// 初始化文件数据库
let dbInitialized = false;
const ensureDBInitialized = async () => {
  if (!dbInitialized) {
    await fileDB.init();
    dbInitialized = true;
  }
};

// 查找用户
const findUserByEmail = async (email) => {
  await ensureDBInitialized();
  return await fileDB.users.findByEmail(email);
};

// 查找用户
const findUserById = async (id) => {
  await ensureDBInitialized();
  return await fileDB.users.findById(id);
};

// 创建用户
const createUser = async (userData) => {
  await ensureDBInitialized();
  return await fileDB.users.create(userData);
};

// 获取所有目标
const getAllGoals = async () => {
  await ensureDBInitialized();
  return await fileDB.goals.getAll();
};

// 根据ID获取目标
const getGoalById = async (id) => {
  await ensureDBInitialized();
  return await fileDB.goals.findById(id);
};

// 创建目标
const createGoal = async (goalData) => {
  await ensureDBInitialized();
  return await fileDB.goals.create(goalData);
};

// 更新目标
const updateGoal = async (id, goalData) => {
  await ensureDBInitialized();
  return await fileDB.goals.update(id, goalData);
};

// 删除目标
const deleteGoal = async (id) => {
  await ensureDBInitialized();
  return await fileDB.goals.delete(id);
};

// 获取所有日计划
const getAllDays = async () => {
  await ensureDBInitialized();
  return await fileDB.days.getAll();
};

// 获取指定日期范围内的日计划（性能优化版本）
const getDaysByDateRange = async (startDate, endDate, userId) => {
  await ensureDBInitialized();
  return await fileDB.days.getByDateRange(startDate, endDate, userId);
};

// 搜索包含指定关键词的日计划（性能优化版本）
const searchDaysByKeyword = async (keyword, userId) => {
  await ensureDBInitialized();
  return await fileDB.days.searchByKeyword(keyword, userId);
};

// 根据ID获取日计划
const getDayById = async (id) => {
  await ensureDBInitialized();
  return await fileDB.days.findById(id);
};

// 根据日期获取日计划
const getDayByDate = async (date, userId) => {
  await ensureDBInitialized();
  return await fileDB.days.findByDate(date, userId);
};

// 创建或更新日计划
const createOrUpdateDay = async (dayData) => {
  await ensureDBInitialized();
  return await fileDB.days.createOrUpdate(dayData);
};

// 删除日计划
const deleteDay = async (id) => {
  await ensureDBInitialized();
  return await fileDB.days.delete(id);
};

// 刷新令牌相关函数
// 保存刷新令牌
const saveRefreshToken = async (token, userId) => {
  await ensureDBInitialized();
  await fileDB.refreshTokens.save(token, userId);
};

// 查找刷新令牌
const findRefreshToken = async (token) => {
  await ensureDBInitialized();
  return await fileDB.refreshTokens.find(token);
};

// 删除刷新令牌
const deleteRefreshToken = async (token) => {
  await ensureDBInitialized();
  return await fileDB.refreshTokens.delete(token);
};

// 删除用户的所有刷新令牌
const deleteAllUserRefreshTokens = async (userId) => {
  await ensureDBInitialized();
  return await fileDB.refreshTokens.deleteAllByUserId(userId);
};

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  getAllGoals,
  getGoalById,
  createGoal,
  updateGoal,
  deleteGoal,
  getAllDays,
  getDaysByDateRange,
  searchDaysByKeyword,
  getDayById,
  getDayByDate,
  createOrUpdateDay,
  deleteDay,
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  deleteAllUserRefreshTokens
};