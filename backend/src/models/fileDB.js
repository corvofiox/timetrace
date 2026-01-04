const fs = require('fs').promises;
const path = require('path');
const lockfile = require('proper-lockfile');
const { getDataDir } = require('../config/keys');

const DATA_DIR = getDataDir();
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GOALS_FILE = path.join(DATA_DIR, 'goals.json');
const DAYS_FILE = path.join(DATA_DIR, 'days.json');
const REFRESH_TOKENS_FILE = path.join(DATA_DIR, 'refreshTokens.json');

const ensureDataDir = async () => {
  try {
    await fs.access(DATA_DIR);
  } catch (error) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
};

const readJsonFile = async (filePath) => {
  let release;
  try {
    await ensureDataDir();
    release = await lockfile.lock(filePath, { retries: 3, stale: 5000, minTimeout: 50, maxTimeout: 200 });
    const data = await fs.readFile(filePath, 'utf8');
    if (!data.trim()) {
      return [];
    }
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    if (error instanceof SyntaxError && error.message.includes('Unexpected end of JSON input')) {
      return [];
    }
    throw error;
  } finally {
    if (release) {
      try {
        await release();
      } catch (e) {
        console.error('Failed to release lock:', e);
      }
    }
  }
};

const writeJsonFile = async (filePath, data) => {
  let release;
  try {
    await ensureDataDir();
    release = await lockfile.lock(filePath, { retries: 5, stale: 10000, minTimeout: 50, maxTimeout: 200 });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } finally {
    if (release) {
      try {
        await release();
      } catch (e) {
        console.error('Failed to release lock:', e);
      }
    }
  }
};

const atomicUpdate = async (filePath, updateFn) => {
  let release;
  try {
    await ensureDataDir();
    release = await lockfile.lock(filePath, { retries: 5, stale: 10000, minTimeout: 50, maxTimeout: 200 });
    const data = await fs.readFile(filePath, 'utf8');
    const currentData = data.trim() ? JSON.parse(data) : [];
    const updatedData = await updateFn(currentData);
    await fs.writeFile(filePath, JSON.stringify(updatedData, null, 2), 'utf8');
    return updatedData;
  } catch (error) {
    if (error.code === 'ENOENT') {
      const updatedData = await updateFn([]);
      await fs.writeFile(filePath, JSON.stringify(updatedData, null, 2), 'utf8');
      return updatedData;
    }
    throw error;
  } finally {
    if (release) {
      try {
        await release();
      } catch (e) {
        console.error('Failed to release lock:', e);
      }
    }
  }
};

// 日期验证工具函数
const dateUtils = {
  // 验证日期字符串格式是否为YYYY-MM-DD
  isValidDateString(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    
    // 检查日期是否有效（特别处理31日的情况）
    return date.getFullYear() === year && 
           date.getMonth() === month - 1 && 
           date.getDate() === day;
  },
  
  // 获取月份的天数（正确处理31日的情况）
  getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  },
  
  // 验证日期范围是否有效
  isValidDateRange(startDate, endDate) {
    if (!this.isValidDateString(startDate) || !this.isValidDateString(endDate)) {
      return false;
    }
    
    return startDate <= endDate;
  }
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
  },

  // 批量更新目标顺序
  reorder: async (goalIds) => {
    return await atomicUpdate(GOALS_FILE, (allGoals) => {
      return allGoals.map(goal => {
        const index = goalIds.findIndex(id => id.toString() === goal.id.toString());
        if (index !== -1) {
          return {
            ...goal,
            order: index,
            updatedAt: new Date()
          };
        }
        return goal;
      });
    });
  }
};

// 日计划数据操作
const days = {
  // 获取所有日计划
  getAll: async () => {
    return await readJsonFile(DAYS_FILE);
  },

  // 获取指定日期范围内的日计划（性能优化版本）
  getByDateRange: async (startDate, endDate, userId = null) => {
    const allDays = await readJsonFile(DAYS_FILE);
    
    // 先按用户ID过滤（如果提供了）
    let filteredDays = userId ? 
      allDays.filter(day => day.userId === userId) : 
      allDays;
    
    // 再按日期范围过滤
    const result = filteredDays.filter(day => {
      return day.date >= startDate && day.date <= endDate;
    });
    
    return result;
  },

  // 搜索包含指定关键词的日计划（性能优化版本）
  searchByKeyword: async (keyword, userId = null) => {
    const allDays = await readJsonFile(DAYS_FILE);
    
    // 先按用户ID过滤（如果提供了）
    let filteredDays = userId ? 
      allDays.filter(day => day.userId === userId) : 
      allDays;
    
    // 将关键字拆分成单个词，去除空格和空字符串
    const keywords = keyword.toLowerCase()
      .split(/\s+/)  // 按空格拆分
      .filter(word => word.length > 0);  // 过滤掉空字符串
    
    const results = [];
    
    // 搜索每日备注
    filteredDays.forEach(day => {
      if (day.summary) {
        const summaryLower = day.summary.toLowerCase();
        
        // 检查备注是否包含所有关键字
        const allKeywordsMatch = keywords.every(keyword => 
          summaryLower.includes(keyword)
        );
        
        if (allKeywordsMatch) {
          results.push({
            date: day.date,
            content: day.summary,
            type: 'summary'
          });
        }
      }
    });
    
    // 按日期排序（最新的在前）
    results.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return results;
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
        // 优先使用 id 查找，如果没有 id 则使用 date 和 userId 查找
        let index;
        if (existingDay.id) {
          index = allDays.findIndex(day => day.id === existingDay.id);
        } else {
          index = allDays.findIndex(day => day.date === existingDay.date && day.userId === existingDay.userId);
        }
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
      // 优先使用 id 查找，如果没有 id 则使用 date 和 userId 查找
      let index;
      if (existingDay.id) {
        index = allDays.findIndex(day => day.id === existingDay.id);
      } else {
        index = allDays.findIndex(day => day.date === existingDay.date && day.userId === existingDay.userId);
      }
      if (index !== -1) {
        allDays[index] = { ...allDays[index], ...dayData };
        // 确保保留 id 字段（如果存在）
        if (existingDay.id) {
          allDays[index].id = existingDay.id;
        }
        await writeJsonFile(DAYS_FILE, allDays);
        return allDays[index];
      }
    }
    // 创建新日计划
    const newDay = {
      id: await generateId('days'),
      ...dayData,
      createdAt: new Date()
    };
    allDays.push(newDay);
    await writeJsonFile(DAYS_FILE, allDays);
    return newDay;
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
  },

  batchUpdate: async (days) => {
    return await atomicUpdate(DAYS_FILE, (allDays) => {
      const allDaysMap = new Map();
      allDays.forEach(day => {
        allDaysMap.set(day.date, day);
      });
      
      days.forEach(day => {
        const isSummaryEmpty = !day.summary || day.summary.trim() === '';
        const areTasksEmpty = !day.tasks || day.tasks.length === 0;
        
        if (isSummaryEmpty && areTasksEmpty) {
          allDaysMap.delete(day.date);
        } else {
          const existingDay = allDaysMap.get(day.date);
          if (existingDay && existingDay.id) {
            day.id = existingDay.id;
          }
          allDaysMap.set(day.date, day);
        }
      });
      
      return Array.from(allDaysMap.values());
    });
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
  },

  // 清理过期的刷新令牌
  cleanExpiredTokens: async (maxAgeDays = 7) => {
    const allTokens = await readJsonFile(REFRESH_TOKENS_FILE);
    const initialLength = allTokens.length;
    const now = new Date();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    
    for (let i = allTokens.length - 1; i >= 0; i--) {
      const token = allTokens[i];
      const createdAt = new Date(token.createdAt);
      const age = now - createdAt;
      
      if (age > maxAgeMs) {
        allTokens.splice(i, 1);
      }
    }
    
    if (allTokens.length !== initialLength) {
      await writeJsonFile(REFRESH_TOKENS_FILE, allTokens);
    }
    
    return initialLength - allTokens.length;
  }
};

const ID_COUNTERS_FILE = path.join(DATA_DIR, 'idCounters.json');

let idCounters = {
  users: 1,
  goals: 1,
  days: 1
};

let savePending = false;
let saveTimer = null;

const SAVE_INTERVAL = 5000;
const SAVE_AFTER_GENERATIONS = 10;

let generationCounters = {
  users: 0,
  goals: 0,
  days: 0
};

const initIdCounters = async () => {
  let release;
  try {
    release = await lockfile.lock(ID_COUNTERS_FILE, { retries: 3, stale: 10000 });
    const data = await fs.readFile(ID_COUNTERS_FILE, 'utf8');
    const counters = JSON.parse(data);
    idCounters.users = counters.users || 1;
    idCounters.goals = counters.goals || 1;
    idCounters.days = counters.days || 1;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('ID counters file not found, using default values');
    } else {
      console.error('Failed to read ID counters, using default values:', error.message);
    }
  } finally {
    if (release) {
      try {
        await release();
      } catch (e) {
        console.error('Failed to release lock:', e);
      }
    }
  }
};

const saveIdCounters = async () => {
  let release;
  try {
    release = await lockfile.lock(ID_COUNTERS_FILE, { retries: 3, stale: 10000 });
    await fs.writeFile(ID_COUNTERS_FILE, JSON.stringify(idCounters, null, 2), 'utf8');
    generationCounters = { users: 0, goals: 0, days: 0 };
  } catch (error) {
    console.error('Failed to save ID counters:', error);
  } finally {
    if (release) {
      try {
        await release();
      } catch (e) {
        console.error('Failed to release lock:', e);
      }
    }
  }
};

const scheduleSave = () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  
  saveTimer = setTimeout(() => {
    saveIdCounters();
    saveTimer = null;
  }, SAVE_INTERVAL);
};

const generateId = async (type) => {
  const id = idCounters[type]++;
  generationCounters[type]++;
  
  if (generationCounters[type] >= SAVE_AFTER_GENERATIONS) {
    await saveIdCounters();
  } else {
    scheduleSave();
  }
  
  return id;
};

const cleanup = () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveIdCounters();
};

process.on('beforeExit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

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
  init,
  dateUtils
};