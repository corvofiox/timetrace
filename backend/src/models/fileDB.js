const fs = require('fs').promises;
const path = require('path');

// 数据文件路径
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GOALS_FILE = path.join(DATA_DIR, 'goals.json');
const DAYS_FILE = path.join(DATA_DIR, 'days.json');
const REFRESH_TOKENS_FILE = path.join(DATA_DIR, 'refreshTokens.json');

// 确保数据目录存在
const ensureDataDir = async () => {
  try {
    await fs.access(DATA_DIR);
  } catch (error) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
};

// 读取JSON文件
const readJsonFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    // 处理文件存在但为空的情况
    if (!data.trim()) {
      return [];
    }
    return JSON.parse(data);
  } catch (error) {
    // 如果文件不存在，返回空数组
    if (error.code === 'ENOENT') {
      return [];
    }
    // 如果是JSON解析错误（文件存在但内容无效），也返回空数组
    if (error instanceof SyntaxError && error.message.includes('Unexpected end of JSON input')) {
      return [];
    }
    throw error;
  }
};

// 写入JSON文件
const writeJsonFile = async (filePath, data) => {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// 用户数据操作
const users = {
  // 获取所有用户
  getAll: async () => {
    return await readJsonFile(USERS_FILE);
  },

  // 根据邮箱查找用户
  findByEmail: async (email) => {
    const allUsers = await readJsonFile(USERS_FILE);
    return allUsers.find(user => user.email === email);
  },

  // 根据ID查找用户
  findById: async (id) => {
    const allUsers = await readJsonFile(USERS_FILE);
    const idStr = id.toString();
    return allUsers.find(user => user.id.toString() === idStr);
  },

  // 创建用户
  create: async (userData) => {
    const allUsers = await readJsonFile(USERS_FILE);
    const newUser = {
      id: await generateId('users'),
      ...userData,
      createdAt: new Date()
    };
    allUsers.push(newUser);
    await writeJsonFile(USERS_FILE, allUsers);
    return newUser;
  }
};

// 目标数据操作
const goals = {
  // 获取所有目标
  getAll: async () => {
    return await readJsonFile(GOALS_FILE);
  },

  // 根据ID查找目标
  findById: async (id) => {
    const allGoals = await readJsonFile(GOALS_FILE);
    const idStr = id.toString();
    return allGoals.find(goal => goal.id.toString() === idStr);
  },

  // 创建目标
  create: async (goalData) => {
    const allGoals = await readJsonFile(GOALS_FILE);
    const newGoal = {
      id: await generateId('goals'),
      ...goalData,
      createdAt: new Date()
    };
    allGoals.push(newGoal);
    await writeJsonFile(GOALS_FILE, allGoals);
    return newGoal;
  },

  // 更新目标
  update: async (id, goalData) => {
    const allGoals = await readJsonFile(GOALS_FILE);
    const idStr = id.toString();
    const index = allGoals.findIndex(goal => goal.id.toString() === idStr);
    if (index !== -1) {
      // 确保只更新提供的字段，保留其他字段不变
      const updatedGoal = {
        ...allGoals[index],
        ...goalData,
        updatedAt: new Date()
      };
      allGoals[index] = updatedGoal;
      await writeJsonFile(GOALS_FILE, allGoals);
      return updatedGoal;
    }
    return null;
  },

  // 删除目标
  delete: async (id) => {
    const allGoals = await readJsonFile(GOALS_FILE);
    const idStr = id.toString();
    const index = allGoals.findIndex(goal => goal.id.toString() === idStr);
    if (index !== -1) {
      const deletedGoal = allGoals.splice(index, 1)[0];
      await writeJsonFile(GOALS_FILE, allGoals);
      return deletedGoal;
    }
    return null;
  }
};

// 日计划数据操作
const days = {
  // 获取所有日计划
  getAll: async () => {
    return await readJsonFile(DAYS_FILE);
  },

  // 根据ID查找日计划
  findById: async (id) => {
    const allDays = await readJsonFile(DAYS_FILE);
    return allDays.find(day => day.id === id);
  },

  // 根据日期和用户ID查找日计划
  findByDate: async (date, userId) => {
    const allDays = await readJsonFile(DAYS_FILE);
    if (userId) {
      return allDays.find(day => day.date === date && day.userId === userId);
    }
    return allDays.find(day => day.date === date);
  },

  // 创建或更新日计划
  createOrUpdate: async (dayData) => {
    const allDays = await readJsonFile(DAYS_FILE);
    const existingDay = await days.findByDate(dayData.date, dayData.userId);
    
    // 检查是否应该删除条目：备注为空且任务数组为空
    const isSummaryEmpty = !dayData.summary || dayData.summary.trim() === '';
    const areTasksEmpty = !dayData.tasks || dayData.tasks.length === 0;
    
    if (isSummaryEmpty && areTasksEmpty) {
      // 如果备注和任务都为空，删除现有条目（如果存在）
      if (existingDay) {
        const index = allDays.findIndex(day => day.id === existingDay.id);
        if (index !== -1) {
          allDays.splice(index, 1);
          await writeJsonFile(DAYS_FILE, allDays);
          return { deleted: true, id: existingDay.id };
        }
      }
      // 如果没有现有条目，什么都不做
      return { deleted: false, message: 'No data to save' };
    }
    
    if (existingDay) {
      // 更新现有日计划
      const index = allDays.findIndex(day => day.id === existingDay.id);
      allDays[index] = { ...allDays[index], ...dayData };
      await writeJsonFile(DAYS_FILE, allDays);
      return allDays[index];
    } else {
      // 创建新日计划
      const newDay = {
        id: await generateId('days'),
        ...dayData,
        createdAt: new Date()
      };
      allDays.push(newDay);
      await writeJsonFile(DAYS_FILE, allDays);
      return newDay;
    }
  },

  // 删除日计划
  delete: async (id) => {
    const allDays = await readJsonFile(DAYS_FILE);
    const index = allDays.findIndex(day => day.id === id);
    if (index !== -1) {
      const deletedDay = allDays.splice(index, 1)[0];
      await writeJsonFile(DAYS_FILE, allDays);
      return deletedDay;
    }
    return null;
  }
};

// 刷新令牌数据操作
const refreshTokens = {
  // 获取所有刷新令牌
  getAll: async () => {
    return await readJsonFile(REFRESH_TOKENS_FILE);
  },

  // 保存刷新令牌
  save: async (token, userId) => {
    const allTokens = await readJsonFile(REFRESH_TOKENS_FILE);
    
    // 检查是否已存在该用户的刷新令牌，如果存在则删除旧令牌
    const existingTokenIndex = allTokens.findIndex(rt => rt.userId === userId);
    if (existingTokenIndex !== -1) {
      allTokens.splice(existingTokenIndex, 1);
    }
    
    // 添加新令牌
    allTokens.push({
      token,
      userId,
      createdAt: new Date()
    });
    
    await writeJsonFile(REFRESH_TOKENS_FILE, allTokens);
  },

  // 查找刷新令牌
  find: async (token) => {
    const allTokens = await readJsonFile(REFRESH_TOKENS_FILE);
    return allTokens.find(rt => rt.token === token);
  },

  // 删除刷新令牌
  delete: async (token) => {
    const allTokens = await readJsonFile(REFRESH_TOKENS_FILE);
    const index = allTokens.findIndex(rt => rt.token === token);
    if (index !== -1) {
      const deletedToken = allTokens.splice(index, 1)[0];
      await writeJsonFile(REFRESH_TOKENS_FILE, allTokens);
      return deletedToken;
    }
    return null;
  },

  // 删除用户的所有刷新令牌
  deleteAllByUserId: async (userId) => {
    const allTokens = await readJsonFile(REFRESH_TOKENS_FILE);
    const initialLength = allTokens.length;
    for (let i = allTokens.length - 1; i >= 0; i--) {
      if (allTokens[i].userId === userId) {
        allTokens.splice(i, 1);
      }
    }
    await writeJsonFile(REFRESH_TOKENS_FILE, allTokens);
    return initialLength - allTokens.length;
  }
};

// ID生成器
const idCounters = {
  users: 1,
  goals: 1,
  days: 1
};

const ID_COUNTERS_FILE = path.join(DATA_DIR, 'idCounters.json');

// 初始化ID计数器
const initIdCounters = async () => {
  try {
    const data = await fs.readFile(ID_COUNTERS_FILE, 'utf8');
    const counters = JSON.parse(data);
    idCounters.users = counters.users || 1;
    idCounters.goals = counters.goals || 1;
    idCounters.days = counters.days || 1;
  } catch (error) {
    // 如果文件不存在，使用默认值
    await writeJsonFile(ID_COUNTERS_FILE, idCounters);
  }
};

// 生成唯一ID
const generateId = async (type) => {
  const id = idCounters[type]++;
  await writeJsonFile(ID_COUNTERS_FILE, idCounters);
  return id;
};

// 初始化函数，确保数据目录和ID计数器存在
const init = async () => {
  await ensureDataDir();
  await initIdCounters();
};

module.exports = {
  users,
  goals,
  days,
  refreshTokens,
  generateId,
  init
};