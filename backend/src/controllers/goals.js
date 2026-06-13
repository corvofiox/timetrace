const {
  getAllGoals,
  getGoalsByUserId,
  getGoalById,
  createGoal,
  updateGoal,
  deleteGoal,
  reorderGoals
} = require('../models/database');
const { 
  successResponse, 
  validationErrorResponse, 
  notFoundResponse, 
  createdResponse,
  unauthorizedResponse,
  serverErrorResponse
} = require('../utils/response');
const { ErrorCodes } = require('../utils/errors');
const { sanitizeBody } = require('../middleware/errorHandler');

const COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const MAX_TITLE_LENGTH = 100;

exports.getGoals = async (req, res) => {
  try {
    const goals = await getGoalsByUserId(req.user.id);
    
    const sortedGoals = goals.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    
    successResponse(res, {
      count: sortedGoals.length,
      data: sortedGoals
    });
  } catch (error) {
    console.error('[获取目标列表失败]', {
      error: error.message,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '获取目标列表失败');
  }
};

exports.getGoal = async (req, res) => {
  try {
    const goal = await getGoalById(req.params.id);
    
    if (!goal) {
      return notFoundResponse(res, '目标不存在', ErrorCodes.GOAL_NOT_FOUND, {
        goalId: req.params.id
      });
    }
    
    if (goal.userId !== req.user.id) {
      console.warn('[访问目标失败] 无权限', {
        userId: req.user.id,
        goalId: req.params.id,
        goalOwnerId: goal.userId
      });
      return unauthorizedResponse(res, '您没有权限访问此目标', ErrorCodes.GOAL_NO_PERMISSION, {
        reason: 'not_owner'
      });
    }
    
    successResponse(res, { data: goal });
  } catch (error) {
    console.error('[获取目标详情失败]', {
      error: error.message,
      goalId: req.params.id,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '获取目标详情失败');
  }
};

exports.createGoal = async (req, res) => {
  try {
    const { title, color, description, date } = req.body;

    if (!title || title.trim() === '') {
      return validationErrorResponse(res, '目标标题不能为空', ErrorCodes.GOAL_TITLE_EMPTY, {
        field: 'title',
        reason: 'required'
      });
    }

    if (title.length > MAX_TITLE_LENGTH) {
      return validationErrorResponse(res, `目标标题不能超过${MAX_TITLE_LENGTH}个字符`, ErrorCodes.GOAL_TITLE_TOO_LONG, {
        field: 'title',
        reason: 'max_length',
        maxLength: MAX_TITLE_LENGTH,
        actualLength: title.length
      });
    }

    if (color && !COLOR_REGEX.test(color)) {
      return validationErrorResponse(res, '颜色格式无效，请使用 #RRGGBB 格式', ErrorCodes.GOAL_COLOR_INVALID, {
        field: 'color',
        reason: 'invalid_format',
        expected: '#RRGGBB or #RGB'
      });
    }
    
    const goalData = {
      title: title.trim(),
      color: color || '#3498db',
      description: description?.trim() || '',
      date: date?.trim() || '',
      userId: req.user.id
    };
    
    const goal = await createGoal(goalData);
    
    console.log('[创建目标成功]', {
      goalId: goal.id,
      userId: req.user.id,
      title: goal.title
    });
    
    createdResponse(res, { data: goal });
  } catch (error) {
    console.error('[创建目标失败]', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      body: sanitizeBody(req.body)
    });
    
    return serverErrorResponse(res, '创建目标失败，请稍后重试');
  }
};

exports.updateGoal = async (req, res) => {
  try {
    const { title, color, description, date } = req.body;
    const goalId = req.params.id;

    if (title !== undefined) {
      if (title.trim() === '') {
        return validationErrorResponse(res, '目标标题不能为空', ErrorCodes.GOAL_TITLE_EMPTY, {
          field: 'title',
          reason: 'required'
        });
      }

      if (title.length > MAX_TITLE_LENGTH) {
        return validationErrorResponse(res, `目标标题不能超过${MAX_TITLE_LENGTH}个字符`, ErrorCodes.GOAL_TITLE_TOO_LONG, {
          field: 'title',
          reason: 'max_length',
          maxLength: MAX_TITLE_LENGTH,
          actualLength: title.length
        });
      }
    }

    if (color !== undefined && color !== '' && !COLOR_REGEX.test(color)) {
      return validationErrorResponse(res, '颜色格式无效，请使用 #RRGGBB 格式', ErrorCodes.GOAL_COLOR_INVALID, {
        field: 'color',
        reason: 'invalid_format',
        expected: '#RRGGBB or #RGB'
      });
    }
    
    const existingGoal = await getGoalById(goalId);
    
    if (!existingGoal) {
      return notFoundResponse(res, '目标不存在', ErrorCodes.GOAL_NOT_FOUND, {
        goalId: goalId
      });
    }
    
    if (existingGoal.userId !== req.user.id) {
      console.warn('[更新目标失败] 无权限', {
        userId: req.user.id,
        goalId: goalId,
        goalOwnerId: existingGoal.userId
      });
      return unauthorizedResponse(res, '您没有权限修改此目标', ErrorCodes.GOAL_NO_PERMISSION, {
        reason: 'not_owner'
      });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (color !== undefined) updateData.color = color;
    if (description !== undefined) updateData.description = description?.trim() || '';
    if (date !== undefined) updateData.date = date?.trim() || '';
    
    const goal = await updateGoal(goalId, updateData);
    
    console.log('[更新目标成功]', {
      goalId: goalId,
      userId: req.user.id
    });
    
    successResponse(res, { data: goal });
  } catch (error) {
    console.error('[更新目标失败]', {
      error: error.message,
      stack: error.stack,
      goalId: req.params.id,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '更新目标失败，请稍后重试');
  }
};

exports.deleteGoal = async (req, res) => {
  try {
    const goalId = req.params.id;
    const existingGoal = await getGoalById(goalId);
    
    if (!existingGoal) {
      return notFoundResponse(res, '目标不存在', ErrorCodes.GOAL_NOT_FOUND, {
        goalId: goalId
      });
    }
    
    if (existingGoal.userId !== req.user.id) {
      console.warn('[删除目标失败] 无权限', {
        userId: req.user.id,
        goalId: goalId,
        goalOwnerId: existingGoal.userId
      });
      return unauthorizedResponse(res, '您没有权限删除此目标', ErrorCodes.GOAL_DELETE_NO_PERMISSION, {
        reason: 'not_owner'
      });
    }
    
    await deleteGoal(goalId);
    
    console.log('[删除目标成功]', {
      goalId: goalId,
      userId: req.user.id,
      title: existingGoal.title
    });
    
    successResponse(res, { data: {} });
  } catch (error) {
    console.error('[删除目标失败]', {
      error: error.message,
      stack: error.stack,
      goalId: req.params.id,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '删除目标失败，请稍后重试');
  }
};

exports.reorderGoals = async (req, res) => {
  try {
    const { goalIds } = req.body;
    
    if (!goalIds) {
      return validationErrorResponse(res, '请提供目标ID列表', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'goalIds',
        reason: 'required'
      });
    }
    
    if (!Array.isArray(goalIds)) {
      return validationErrorResponse(res, '目标ID列表必须是数组格式', ErrorCodes.VALIDATION_FORMAT, {
        field: 'goalIds',
        reason: 'must_be_array',
        actualType: typeof goalIds
      });
    }

    if (goalIds.length === 0) {
      return validationErrorResponse(res, '目标ID列表不能为空', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'goalIds',
        reason: 'empty_array'
      });
    }

    for (const id of goalIds) {
      const goal = await getGoalById(id);
      if (!goal) {
        return notFoundResponse(res, `目标不存在: ${id}`, ErrorCodes.GOAL_NOT_FOUND, {
          goalId: id
        });
      }
      if (goal.userId !== req.user.id) {
        return unauthorizedResponse(res, `您没有权限操作此目标: ${id}`, ErrorCodes.GOAL_NO_PERMISSION, {
          reason: 'not_owner',
          goalId: id
        });
      }
    }
    
    await reorderGoals(goalIds);
    
    const updatedGoals = await getGoalsByUserId(req.user.id);
    const sortedGoals = updatedGoals.sort((a, b) => a.order - b.order);
    
    console.log('[重排目标成功]', {
      userId: req.user.id,
      count: goalIds.length
    });
    
    successResponse(res, { data: sortedGoals });
  } catch (error) {
    console.error('[重排目标失败]', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      goalIds: req.body.goalIds
    });
    
    return serverErrorResponse(res, '重排目标失败，请稍后重试');
  }
};
