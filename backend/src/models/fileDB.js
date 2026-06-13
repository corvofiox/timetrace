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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const readJsonFile = async (filePath, retryCount = 0) => {
  const MAX_RETRIES = 3;
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
    if (error.code === 'ELOCKED') {
      if (retryCount < MAX_RETRIES) {
        await sleep(Math.pow(2, retryCount) * 100);
        return readJsonFile(filePath, retryCount + 1);
      }
      console.error('Lock acquisition failed after max retries:', filePath);
      return [];
    }
    if (error instanceof SyntaxError) {
      console.warn('Corrupted JSON file, returning empty array:', filePath, error.message);
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
  } catch (error) {
    if (error.code === 'ELOCKED') {
      console.error('Lock acquisition failed during write, data may be lost:', filePath, error.message);
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
    if (error.code === 'ELOCKED') {
      console.error('Lock acquisition failed during atomic update:', filePath, error.message);
      throw error;
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

    // 验证年份范围（合理范围：1900-2100）
    if (year < 1900 || year > 2100) return false;

    // 验证月份范围
    if (month < 1 || month > 12) return false;

    // 获取该月实际天数
    const daysInMonth = new Date(year, month, 0).getDate();

    // 验证日期范围
    if (day < 1 || day > daysInMonth) return false;

    return true;
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
    let savedUser = null;
    await atomicUpdate(USERS_FILE, async (allUsers) => {
      savedUser = {
        id: await generateId('users'),
        ...userData,
        createdAt: new Date()
      };
      allUsers.push(savedUser);
      return allUsers;
    });
    return savedUser;
  }
};

// 目标数据操作
const goals = {
  // 获取所有目标
  getAll: async () => {
    return await readJsonFile(GOALS_FILE);
  },

  // 根据用户ID获取目标（性能优化：过滤在DB层完成）
  getByUserId: async (userId) => {
    const allGoals = await readJsonFile(GOALS_FILE);
    return allGoals.filter(goal => goal.userId === userId);
  },

  // 根据ID查找目标
  findById: async (id) => {
    const allGoals = await readJsonFile(GOALS_FILE);
    const idStr = id.toString();
    return allGoals.find(goal => goal.id.toString() === idStr);
  },

  // 创建目标
  create: async (goalData) => {
    let savedGoal = null;
    await atomicUpdate(GOALS_FILE, async (allGoals) => {
      savedGoal = {
        id: await generateId('goals'),
        ...goalData,
        createdAt: new Date()
      };
      allGoals.push(savedGoal);
      return allGoals;
    });
    return savedGoal;
  },

  // 更新目标
  update: async (id, goalData) => {
    const idStr = id.toString();
    return await atomicUpdate(GOALS_FILE, (allGoals) => {
      const index = allGoals.findIndex(goal => goal.id.toString() === idStr);
      if (index !== -1) {
        allGoals[index] = {
          ...allGoals[index],
          ...goalData,
          updatedAt: new Date()
        };
      }
      return allGoals;
    }).then((allGoals) => allGoals.find(goal => goal.id.toString() === idStr) || null);
  },

  // 删除目标
  delete: async (id) => {
    const idStr = id.toString();
    let deletedGoal = null;
    await atomicUpdate(GOALS_FILE, (allGoals) => {
      const index = allGoals.findIndex(goal => goal.id.toString() === idStr);
      if (index !== -1) {
        deletedGoal = allGoals.splice(index, 1)[0];
      }
      return allGoals;
    });
    return deletedGoal;
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
        // Reset stale order values for goals not in the reorder list
        return { ...goal, order: undefined };
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

  // 根据用户ID获取日计划（性能优化：过滤在DB层完成）
  getByUserId: async (userId) => {
    const allDays = await readJsonFile(DAYS_FILE);
    return allDays.filter(day => day.userId === userId);
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
    const idStr = id.toString();
    return allDays.find(day => day.id.toString() === idStr);
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
    // 预先计算是否为空数据，避免重复计算
    const isSummaryEmpty = !dayData.summary || dayData.summary.trim() === '';
    const areTasksEmpty = !dayData.tasks || dayData.tasks.length === 0;
    const shouldDelete = isSummaryEmpty && areTasksEmpty;

    try {
      return await atomicUpdate(DAYS_FILE, async (allDays) => {
        let existingDay = allDays.find(day => day.date === dayData.date && day.userId === dayData.userId);
        
        // 如果日期+用户ID查找未匹配，尝试通过ID查找（更新场景的兜底）
        if (!existingDay && dayData.id) {
          existingDay = allDays.find(day => day.id.toString() === dayData.id.toString());
        }

        if (shouldDelete) {
          // 如果备注和任务都为空，删除现有条目（如果存在）
          if (existingDay) {
            const index = allDays.findIndex(day => day.id === existingDay.id ||
              (day.date === existingDay.date && day.userId === existingDay.userId));
            if (index !== -1) {
              allDays.splice(index, 1);
            }
          }
          return allDays;
        }

        if (existingDay) {
          // 更新现有日计划
          const index = allDays.findIndex(day => day.id === existingDay.id ||
            (day.date === existingDay.date && day.userId === existingDay.userId));
          if (index !== -1) {
            allDays[index] = { ...allDays[index], ...dayData };
            // 确保保留 id 字段（如果存在）
            if (existingDay.id) {
              allDays[index].id = existingDay.id;
            }
            allDays[index].updatedAt = new Date();
            return allDays;
          }
        }

        // 创建新日计划
        const newDay = {
          id: await generateId('days'),
          ...dayData,
          createdAt: new Date()
        };
        allDays.push(newDay);
        return allDays;
      }).then((updatedDays) => {
        // 使用预先计算的结果，避免重复计算
        if (shouldDelete) {
          return { deleted: true, message: 'No data to save' };
        }

        // 查找操作后的结果（更新或新建）
        const resultDay = updatedDays.find(day => day.date === dayData.date && day.userId === dayData.userId);
        return resultDay || { deleted: false, message: 'No data to save' };
      });
    } catch (error) {
      console.error('[原子更新失败]', {
        error: error.message,
        date: dayData.date,
        userId: dayData.userId,
        operation: shouldDelete ? 'delete' : (dayData.id ? 'update' : 'create')
      });
      throw error;
    }
  },

  // 删除日计划
  delete: async (id) => {
    const idStr = id.toString();
    let deletedDay = null;
    await atomicUpdate(DAYS_FILE, (allDays) => {
      const index = allDays.findIndex(day => day.id.toString() === idStr);
      if (index !== -1) {
        deletedDay = allDays.splice(index, 1)[0];
      }
      return allDays;
    });
    return deletedDay;
  },

  batchUpdate: async (days) => {
    return await atomicUpdate(DAYS_FILE, (allDays) => {
      const allDaysMap = new Map();
      allDays.forEach(day => {
        const key = `${day.date}:${day.userId || ''}`;
        allDaysMap.set(key, day);
      });
      
      days.forEach(day => {
        const key = `${day.date}:${day.userId || ''}`;
        const isSummaryEmpty = !day.summary || day.summary.trim() === '';
        const areTasksEmpty = !day.tasks || day.tasks.length === 0;
        
        if (isSummaryEmpty && areTasksEmpty) {
          allDaysMap.delete(key);
        } else {
          const existingDay = allDaysMap.get(key);
          if (existingDay && existingDay.id) {
            day.id = existingDay.id;
          }
          // 合并现有字段，避免丢失 timeEntries 等未包含在 batch 中的字段
          const mergedDay = existingDay ? { ...existingDay, ...day } : day;
          allDaysMap.set(key, mergedDay);
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
  // NOTE: This replaces any existing token for the same userId (intentional single-session behavior).
  // Each user can only have one active refresh token at a time.
  save: async (token, userId) => {
    await atomicUpdate(REFRESH_TOKENS_FILE, (allTokens) => {
      const existingTokenIndex = allTokens.findIndex(rt => rt.userId === userId);
      if (existingTokenIndex !== -1) {
        allTokens.splice(existingTokenIndex, 1);
      }
      allTokens.push({
        token,
        userId,
        createdAt: new Date()
      });
      return allTokens;
    });
  },

  // 查找刷新令牌（同时验证是否过期）
  find: async (token, maxAgeDays = 7) => {
    return await atomicUpdate(REFRESH_TOKENS_FILE, (allTokens) => {
      const found = allTokens.find(rt => rt.token === token);
      if (!found) return allTokens;

      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const createdAt = new Date(found.createdAt);
      const age = Date.now() - createdAt.getTime();

      if (age > maxAgeMs) {
        const index = allTokens.findIndex(rt => rt.token === token);
        if (index !== -1) {
          allTokens.splice(index, 1);
        }
      }
      return allTokens;
    }).then((allTokens) => {
      return allTokens.find(rt => rt.token === token) || null;
    });
  },

  // 删除刷新令牌
  delete: async (token) => {
    let deletedToken = null;
    await atomicUpdate(REFRESH_TOKENS_FILE, (allTokens) => {
      const index = allTokens.findIndex(rt => rt.token === token);
      if (index !== -1) {
        deletedToken = allTokens.splice(index, 1)[0];
      }
      return allTokens;
    });
    return deletedToken;
  },

  // 删除用户的所有刷新令牌
  deleteAllByUserId: async (userId) => {
    let removedCount = 0;
    await atomicUpdate(REFRESH_TOKENS_FILE, (allTokens) => {
      const initialLength = allTokens.length;
      for (let i = allTokens.length - 1; i >= 0; i--) {
        if (allTokens[i].userId === userId) {
          allTokens.splice(i, 1);
        }
      }
      removedCount = initialLength - allTokens.length;
      return allTokens;
    });
    return removedCount;
  },

  // 清理过期的刷新令牌
  cleanExpiredTokens: async (maxAgeDays = 7) => {
    let removedCount = 0;
    await atomicUpdate(REFRESH_TOKENS_FILE, (allTokens) => {
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
      removedCount = initialLength - allTokens.length;
      return allTokens;
    });
    return removedCount;
  }
};

const ID_COUNTERS_FILE = path.join(DATA_DIR, 'idCounters.json');

let idCounters = {
  users: 1,
  goals: 1,
  days: 1
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
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, create it with default counters
      await fs.writeFile(ID_COUNTERS_FILE, JSON.stringify(idCounters, null, 2), 'utf8');
    } else {
      console.error('Failed to save ID counters:', error);
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

const generateId = async (type) => {
  // Use atomic read-increment-write to ensure ID counter consistency
  let release;
  try {
    release = await lockfile.lock(ID_COUNTERS_FILE, { retries: 5, stale: 10000 });
    let counters;
    try {
      const data = await fs.readFile(ID_COUNTERS_FILE, 'utf8');
      counters = JSON.parse(data);
    } catch (e) {
      if (e.code === 'ENOENT') {
        counters = {};
      } else {
        throw e;
      }
    }
    if (!(type in counters)) {
      counters[type] = 1;
    }
    const id = counters[type]++;
    // Update in-memory copy and persist
    idCounters[type] = counters[type];
    await fs.writeFile(ID_COUNTERS_FILE, JSON.stringify(counters, null, 2), 'utf8');
    return id;
  } catch (error) {
    // Fallback: use in-memory counter if file operations fail
    const id = idCounters[type] || 0;
    idCounters[type] = id + 1;
    console.error('Atomic ID generation failed, using in-memory fallback:', error);
    return id;
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

const cleanup = async () => {
  await saveIdCounters();
};

process.on('beforeExit', cleanup);

// SIGTERM/SIGINT handled by server.js for graceful shutdown

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
  cleanup,
  dateUtils
};