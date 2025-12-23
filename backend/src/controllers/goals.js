const {
  getAllGoals,
  getGoalById,
  createGoal,
  updateGoal,
  deleteGoal,
  reorderGoals
} = require('../models/database');
const { successResponse, errorResponse, validationErrorResponse, notFoundResponse, createdResponse } = require('../utils/response');

// @desc    Get all goals
// @route   GET /api/goals
// @access  Private
exports.getGoals = async (req, res) => {
  try {
    // 只获取当前用户的目标
    const goals = (await getAllGoals()).filter(goal => goal.userId === req.user.id);
    
    // 按order字段排序，如果没有order字段则按创建时间排序
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
    errorResponse(res, error.message);
  }
};

// @desc    Get single goal
// @route   GET /api/goals/:id
// @access  Private
exports.getGoal = async (req, res) => {
  try {
    const goal = await getGoalById(req.params.id);
    
    if (!goal) {
      return notFoundResponse(res, 'Goal not found');
    }
    
    if (goal.userId !== req.user.id) {
      return errorResponse(res, 'Not authorized to access this goal', 403);
    }
    
    successResponse(res, { data: goal });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Create new goal
// @route   POST /api/goals
// @access  Private
exports.createGoal = async (req, res) => {
  try {
    const goalData = {
      ...req.body,
      userId: req.user.id
    };
    
    const goal = await createGoal(goalData);
    
    createdResponse(res, { data: goal });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Update goal
// @route   PUT /api/goals/:id
// @access  Private
exports.updateGoal = async (req, res) => {
  try {
    const existingGoal = await getGoalById(req.params.id);
    
    if (!existingGoal) {
      return notFoundResponse(res, 'Goal not found');
    }
    
    if (existingGoal.userId !== req.user.id) {
      return errorResponse(res, 'Not authorized to update this goal', 403);
    }
    
    const goal = await updateGoal(req.params.id, req.body);
    
    successResponse(res, { data: goal });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Delete goal
// @route   DELETE /api/goals/:id
// @access  Private
exports.deleteGoal = async (req, res) => {
  try {
    const existingGoal = await getGoalById(req.params.id);
    
    if (!existingGoal) {
      return notFoundResponse(res, 'Goal not found');
    }
    
    if (existingGoal.userId !== req.user.id) {
      return errorResponse(res, 'Not authorized to delete this goal', 403);
    }
    
    const goal = await deleteGoal(req.params.id);
    
    successResponse(res, { data: {} });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Reorder goals
// @route   PUT /api/goals/reorder
// @access  Private
exports.reorderGoals = async (req, res) => {
  try {
    const { goalIds } = req.body;
    
    if (!goalIds || !Array.isArray(goalIds)) {
      return validationErrorResponse(res, 'Goal IDs array is required');
    }
    
    await reorderGoals(goalIds);
    
    const updatedGoals = (await getAllGoals()).filter(goal => goal.userId === req.user.id);
    const sortedGoals = updatedGoals.sort((a, b) => a.order - b.order);
    
    successResponse(res, { data: sortedGoals });
  } catch (error) {
    errorResponse(res, error.message);
  }
};