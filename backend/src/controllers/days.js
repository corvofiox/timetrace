const {
  getAllDays,
  getDaysByUserId,
  getDaysByDateRange,
  searchDaysByKeyword,
  getDayById,
  getDayByDate,
  createOrUpdateDay,
  deleteDay,
  batchUpdateDays,
  getGoalById
} = require('../models/database');

const dateUtils = require('../models/fileDB').dateUtils;
const {
  successResponse,
  validationErrorResponse,
  notFoundResponse,
  createdResponse,
  unauthorizedResponse,
  serverErrorResponse
} = require('../utils/response');
const { ErrorCodes } = require('../utils/errors');
const { validateString } = require('../middleware/validate');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateTimeFormat(time) {
  return TIME_REGEX.test(time);
}

function validateDateFormat(date) {
  return DATE_REGEX.test(date);
}

function validateTimeEntry(entry, index) {
  const errors = [];
  
  if (!entry.goalId) {
    errors.push({
      field: `timeEntries[${index}].goalId`,
      message: '时间条目缺少目标ID'
    });
  }
  
  if (!entry.startTime) {
    errors.push({
      field: `timeEntries[${index}].startTime`,
      message: '时间条目缺少开始时间'
    });
  } else if (!validateTimeFormat(entry.startTime)) {
    errors.push({
      field: `timeEntries[${index}].startTime`,
      message: `开始时间格式无效: ${entry.startTime}，请使用 HH:mm 格式`
    });
  }
  
  if (!entry.endTime) {
    errors.push({
      field: `timeEntries[${index}].endTime`,
      message: '时间条目缺少结束时间'
    });
  } else if (!validateTimeFormat(entry.endTime)) {
    errors.push({
      field: `timeEntries[${index}].endTime`,
      message: `结束时间格式无效: ${entry.endTime}，请使用 HH:mm 格式`
    });
  }
  
  if (entry.startTime && entry.endTime && validateTimeFormat(entry.startTime) && validateTimeFormat(entry.endTime)) {
    if (entry.endTime <= entry.startTime) {
      errors.push({
        field: `timeEntries[${index}]`,
        message: `结束时间(${entry.endTime})不能早于或等于开始时间(${entry.startTime})`
      });
    }
  }
  
  return errors;
}

async function validateTimeEntriesWithGoals(timeEntries, userId) {
  for (let i = 0; i < timeEntries.length; i++) {
    const entry = timeEntries[i];
    
    if (entry.goalId && entry.goalId.toString().trim() !== '') {
      const goal = await getGoalById(entry.goalId);
      if (!goal) {
        return { error: { response: validationErrorResponse, args: [`时间条目关联的目标不存在`, ErrorCodes.DAY_GOAL_NOT_FOUND, { field: `timeEntries[${i}].goalId`, goalId: entry.goalId, index: i }] } };
      }
      if (goal.userId !== userId) {
        return { error: { response: unauthorizedResponse, args: [`时间条目关联的目标不属于您`, ErrorCodes.GOAL_NO_PERMISSION, { field: `timeEntries[${i}].goalId`, goalId: entry.goalId }] } };
      }
    }
    
    const entryErrors = validateTimeEntry(entry, i);
    if (entryErrors.length > 0) {
      return { error: { response: validationErrorResponse, args: [entryErrors[0].message, ErrorCodes.DAY_TIME_INVALID, { field: entryErrors[0].field, errors: entryErrors }] } };
    }
  }
  return { error: null };
}

/**
 * 校验批量更新中日计划的内容字段结构
 * @param {Object} day - 日计划对象
 * @param {number} index - 索引
 * @returns {{valid: boolean, message?: string, field?: string, errorCode?: string}}
 */
function validateBatchDayContent(day, index) {
  if (day.summary !== undefined && typeof day.summary !== 'string') {
    return {
      valid: false,
      message: `第${index + 1}条日计划的 summary 必须是字符串`,
      field: `days[${index}].summary`,
      errorCode: ErrorCodes.VALIDATION_FORMAT
    };
  }

  if (day.tasks !== undefined) {
    if (!Array.isArray(day.tasks)) {
      return {
        valid: false,
        message: `第${index + 1}条日计划的 tasks 必须是数组`,
        field: `days[${index}].tasks`,
        errorCode: ErrorCodes.VALIDATION_FORMAT
      };
    }
    for (let j = 0; j < day.tasks.length; j++) {
      const task = day.tasks[j];
      if (!task || typeof task !== 'object') {
        return {
          valid: false,
          message: `第${index + 1}条日计划的第${j + 1}个任务必须是对象`,
          field: `days[${index}].tasks[${j}]`,
          errorCode: ErrorCodes.VALIDATION_FORMAT
        };
      }
      if (task.title !== undefined && typeof task.title !== 'string') {
        return {
          valid: false,
          message: `第${index + 1}条日计划的第${j + 1}个任务标题必须是字符串`,
          field: `days[${index}].tasks[${j}].title`,
          errorCode: ErrorCodes.VALIDATION_FORMAT
        };
      }
    }
  }

  if (day.timeEntries !== undefined) {
    if (!Array.isArray(day.timeEntries)) {
      return {
        valid: false,
        message: `第${index + 1}条日计划的 timeEntries 必须是数组`,
        field: `days[${index}].timeEntries`,
        errorCode: ErrorCodes.VALIDATION_FORMAT
      };
    }
    for (let j = 0; j < day.timeEntries.length; j++) {
      const entry = day.timeEntries[j];
      if (!entry || typeof entry !== 'object') {
        return {
          valid: false,
          message: `第${index + 1}条日计划的第${j + 1}个时间条目必须是对象`,
          field: `days[${index}].timeEntries[${j}]`,
          errorCode: ErrorCodes.VALIDATION_FORMAT
        };
      }
      const entryErrors = validateTimeEntry(entry, j);
      if (entryErrors.length > 0) {
        return {
          valid: false,
          message: `第${index + 1}条日计划：${entryErrors[0].message}`,
          field: `days[${index}].${entryErrors[0].field}`,
          errorCode: ErrorCodes.DAY_TIME_INVALID
        };
      }
    }
  }

  return { valid: true };
}

exports.getDays = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (startDate && endDate) {
      if (!dateUtils.isValidDateString(startDate)) {
        return validationErrorResponse(res, '开始日期无效，请输入有效的日期', ErrorCodes.DAY_DATE_INVALID, {
          field: 'startDate',
          value: startDate,
          expected: 'YYYY-MM-DD'
        });
      }
      
      if (!dateUtils.isValidDateString(endDate)) {
        return validationErrorResponse(res, '结束日期无效，请输入有效的日期', ErrorCodes.DAY_DATE_INVALID, {
          field: 'endDate',
          value: endDate,
          expected: 'YYYY-MM-DD'
        });
      }
      
      if (!dateUtils.isValidDateRange(startDate, endDate)) {
        return validationErrorResponse(res, '日期范围无效，开始日期不能晚于结束日期', ErrorCodes.DAY_DATE_INVALID, {
          startDate,
          endDate,
          reason: 'invalid_range'
        });
      }
      
      const days = await getDaysByDateRange(startDate, endDate, req.user.id);
      
      successResponse(res, {
        count: days.length,
        data: days
      });
    } else {
      const days = await getDaysByUserId(req.user.id);
      
      successResponse(res, {
        count: days.length,
        data: days
      });
    }
  } catch (error) {
    console.error('[获取日计划失败]', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      query: req.query
    });
    
    return serverErrorResponse(res, '获取日计划失败');
  }
};

exports.getDay = async (req, res) => {
  try {
    const day = await getDayById(req.params.id);
    
    if (!day) {
      return notFoundResponse(res, '日计划不存在', ErrorCodes.DAY_NOT_FOUND, {
        dayId: req.params.id
      });
    }
    
    if (day.userId !== req.user.id) {
      console.warn('[访问日计划失败] 无权限', {
        userId: req.user.id,
        dayId: req.params.id,
        dayOwnerId: day.userId
      });
      return unauthorizedResponse(res, '您没有权限访问此日计划', ErrorCodes.DAY_NO_PERMISSION, {
        reason: 'not_owner'
      });
    }
    
    successResponse(res, { data: day });
  } catch (error) {
    console.error('[获取日计划详情失败]', {
      error: error.message,
      dayId: req.params.id,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '获取日计划详情失败');
  }
};

exports.getDayByDate = async (req, res) => {
  try {
    const dateParam = req.params.date;
    
    if (!validateDateFormat(dateParam)) {
      return validationErrorResponse(res, '日期格式无效，请使用 YYYY-MM-DD 格式', ErrorCodes.DAY_DATE_INVALID, {
        field: 'date',
        value: dateParam,
        expected: 'YYYY-MM-DD'
      });
    }
    
    const day = await getDayByDate(dateParam, req.user.id);
    
    if (!day) {
      return notFoundResponse(res, '未找到该日期的日计划', ErrorCodes.DAY_NOT_FOUND, {
        date: dateParam
      });
    }
    
    successResponse(res, { data: day });
  } catch (error) {
    console.error('[按日期获取日计划失败]', {
      error: error.message,
      date: req.params.date,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '获取日计划失败');
  }
};

exports.createOrUpdateDay = async (req, res) => {
  try {
    const { date, timeEntries, tasks, summary } = req.body;

    if (!date) {
      return validationErrorResponse(res, '日期不能为空', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'date',
        reason: 'required'
      });
    }

    if (!validateDateFormat(date)) {
      return validationErrorResponse(res, '日期格式无效，请使用 YYYY-MM-DD 格式', ErrorCodes.DAY_DATE_INVALID, {
        field: 'date',
        value: date,
        expected: 'YYYY-MM-DD'
      });
    }

    if (timeEntries && Array.isArray(timeEntries)) {
      const validation = await validateTimeEntriesWithGoals(timeEntries, req.user.id);
      if (validation.error) {
        return validation.error.response(res, ...validation.error.args);
      }
    }

    const dayData = {
      date: req.body.date,
      timeEntries: req.body.timeEntries,
      tasks: req.body.tasks,
      summary: req.body.summary,
      userId: req.user.id
    };

    const day = await createOrUpdateDay(dayData);
    
    if (day.deleted) {
      return successResponse(res, {
        data: null,
        message: '日计划已删除（内容为空）'
      });
    }
    
    console.log('[保存日计划成功]', {
      date: day.date,
      userId: req.user.id,
      timeEntriesCount: day.timeEntries?.length || 0
    });
    
    createdResponse(res, { data: day });
  } catch (error) {
    console.error('[保存日计划失败]', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      body: { ...req.body, timeEntries: req.body.timeEntries?.length }
    });
    
    return serverErrorResponse(res, '保存日计划失败，请稍后重试');
  }
};

exports.updateDay = async (req, res) => {
  try {
    const dayId = req.params.id;
    const existingDay = await getDayById(dayId);
    
    if (!existingDay) {
      return notFoundResponse(res, '日计划不存在', ErrorCodes.DAY_NOT_FOUND, {
        dayId: dayId
      });
    }
    
    if (existingDay.userId !== req.user.id) {
      console.warn('[更新日计划失败] 无权限', {
        userId: req.user.id,
        dayId: dayId,
        dayOwnerId: existingDay.userId
      });
      return unauthorizedResponse(res, '您没有权限修改此日计划', ErrorCodes.DAY_NO_PERMISSION, {
        reason: 'not_owner'
      });
    }

    const { timeEntries } = req.body;
    
    if (timeEntries && Array.isArray(timeEntries)) {
      const validation = await validateTimeEntriesWithGoals(timeEntries, req.user.id);
      if (validation.error) {
        return validation.error.response(res, ...validation.error.args);
      }
    }
    
    const day = await createOrUpdateDay({
      id: dayId,
      date: existingDay.date,
      timeEntries: req.body.timeEntries,
      tasks: req.body.tasks,
      summary: req.body.summary,
      userId: req.user.id
    });
    
    if (day.deleted) {
      return successResponse(res, {
        data: null,
        message: '日计划已删除（内容为空）'
      });
    }
    
    console.log('[更新日计划成功]', {
      dayId: dayId,
      userId: req.user.id
    });
    
    successResponse(res, { data: day });
  } catch (error) {
    console.error('[更新日计划失败]', {
      error: error.message,
      stack: error.stack,
      dayId: req.params.id,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '更新日计划失败，请稍后重试');
  }
};

exports.deleteDay = async (req, res) => {
  try {
    const dayId = req.params.id;
    const existingDay = await getDayById(dayId);
    
    if (!existingDay) {
      return notFoundResponse(res, '日计划不存在', ErrorCodes.DAY_NOT_FOUND, {
        dayId: dayId
      });
    }
    
    if (existingDay.userId !== req.user.id) {
      console.warn('[删除日计划失败] 无权限', {
        userId: req.user.id,
        dayId: dayId,
        dayOwnerId: existingDay.userId
      });
      return unauthorizedResponse(res, '您没有权限删除此日计划', ErrorCodes.DAY_NO_PERMISSION, {
        reason: 'not_owner'
      });
    }
    
    await deleteDay(dayId);
    
    console.log('[删除日计划成功]', {
      dayId: dayId,
      userId: req.user.id,
      date: existingDay.date
    });
    
    successResponse(res, { data: {} });
  } catch (error) {
    console.error('[删除日计划失败]', {
      error: error.message,
      stack: error.stack,
      dayId: req.params.id,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '删除日计划失败，请稍后重试');
  }
};

exports.searchNotes = async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword || keyword.trim() === '') {
      return validationErrorResponse(res, '请输入搜索关键词', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'keyword',
        reason: 'required'
      });
    }
    
    const keywordValidation = validateString(keyword, '搜索关键词', { minLength: 2, maxLength: 100 });
    if (!keywordValidation.valid) {
      return validationErrorResponse(res, keywordValidation.message, ErrorCodes.VALIDATION_LENGTH, {
        field: keywordValidation.field,
        reason: keywordValidation.reason,
        minLength: keywordValidation.minLength,
        maxLength: keywordValidation.maxLength,
        actualLength: keywordValidation.actualLength
      });
    }

    const results = await searchDaysByKeyword(keyword.trim(), req.user.id);
    
    console.log('[搜索笔记成功]', {
      keyword: keyword.trim(),
      userId: req.user.id,
      resultCount: results.length
    });
    
    successResponse(res, {
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('[搜索笔记失败]', {
      error: error.message,
      userId: req.user?.id,
      keyword: req.query.keyword
    });
    
    return serverErrorResponse(res, '搜索失败，请稍后重试');
  }
};

exports.batchUpdateDays = async (req, res) => {
  try {
    const { days } = req.body;

    if (!days) {
      return validationErrorResponse(res, '请提供日计划数据', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'days',
        reason: 'required'
      });
    }

    if (!Array.isArray(days)) {
      return validationErrorResponse(res, '日计划数据必须是数组格式', ErrorCodes.VALIDATION_FORMAT, {
        field: 'days',
        reason: 'must_be_array',
        actualType: typeof days
      });
    }

    if (days.length === 0) {
      return validationErrorResponse(res, '日计划数据不能为空', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'days',
        reason: 'empty_array'
      });
    }

    // 限制批量更新数量，防止性能问题
    const MAX_BATCH_SIZE = 100;
    if (days.length > MAX_BATCH_SIZE) {
      return validationErrorResponse(res, `批量更新数量不能超过${MAX_BATCH_SIZE}条`, ErrorCodes.VALIDATION_RANGE, {
        field: 'days',
        reason: 'too_many_items',
        maxSize: MAX_BATCH_SIZE,
        actualSize: days.length
      });
    }

    // 验证所有日期格式
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (!day.date) {
        return validationErrorResponse(res, `第${i + 1}条日计划缺少日期`, ErrorCodes.VALIDATION_REQUIRED, {
          field: `days[${i}].date`,
          index: i
        });
      }
      if (!validateDateFormat(day.date)) {
        return validationErrorResponse(res, `第${i + 1}条日计划日期格式无效`, ErrorCodes.DAY_DATE_INVALID, {
          field: `days[${i}].date`,
          value: day.date,
          index: i
        });
      }

      const contentValidation = validateBatchDayContent(day, i);
      if (!contentValidation.valid) {
        return validationErrorResponse(res, contentValidation.message, contentValidation.errorCode, {
          field: contentValidation.field,
          index: i
        });
      }
    }

    // 添加用户ID并执行批量更新
    const userDays = days.map(day => ({
      ...day,
      userId: req.user.id
    }));

    const updatedDays = await batchUpdateDays(userDays);

    console.log('[批量更新日计划成功]', {
      userId: req.user.id,
      count: updatedDays.length
    });

    successResponse(res, {
      count: updatedDays.length,
      data: updatedDays
    });
  } catch (error) {
    console.error('[批量更新日计划失败]', {
      error: error.message,
      userId: req.user?.id,
      daysCount: req.body.days?.length
    });

    return serverErrorResponse(res, '批量更新失败，请稍后重试');
  }
};
