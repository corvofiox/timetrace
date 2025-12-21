const {
  getAllGoals,
  getGoalById,
  createGoal,
  updateGoal,
  deleteGoal
} = require('../models/database');

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
    
    res.status(200).json({
      success: true,
      count: sortedGoals.length,
      data: sortedGoals
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single goal
// @route   GET /api/goals/:id
// @access  Private
exports.getGoal = async (req, res) => {
  try {
    const goal = await getGoalById(req.params.id);
    
    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Goal not found'
      });
    }
    
    // 确保目标属于当前用户
    if (goal.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this goal'
      });
    }
    
    res.status(200).json({
      success: true,
      data: goal
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create new goal
// @route   POST /api/goals
// @access  Private
exports.createGoal = async (req, res) => {
  try {
    // 确保创建的目标与当前用户关联
    const goalData = {
      ...req.body,
      userId: req.user.id
    };
    
    const goal = await createGoal(goalData);
    
    res.status(201).json({
      success: true,
      data: goal
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update goal
// @route   PUT /api/goals/:id
// @access  Private
exports.updateGoal = async (req, res) => {
  try {
    const existingGoal = await getGoalById(req.params.id);
    
    if (!existingGoal) {
      return res.status(404).json({
        success: false,
        message: 'Goal not found'
      });
    }
    
    // 确保目标属于当前用户
    if (existingGoal.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this goal'
      });
    }
    
    const goal = await updateGoal(req.params.id, req.body);
    
    res.status(200).json({
      success: true,
      data: goal
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete goal
// @route   DELETE /api/goals/:id
// @access  Private
exports.deleteGoal = async (req, res) => {
  try {
    const existingGoal = await getGoalById(req.params.id);
    
    if (!existingGoal) {
      return res.status(404).json({
        success: false,
        message: 'Goal not found'
      });
    }
    
    // 确保目标属于当前用户
    if (existingGoal.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this goal'
      });
    }
    
    const goal = await deleteGoal(req.params.id);
    
    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reorder goals
// @route   PUT /api/goals/reorder
// @access  Private
exports.reorderGoals = async (req, res) => {
  try {
    const { goalIds } = req.body;
    
    if (!goalIds || !Array.isArray(goalIds)) {
      return res.status(400).json({
        success: false,
        message: 'Goal IDs array is required'
      });
    }
    
    // 获取所有当前用户的目标
    const allGoals = await getAllGoals();
    const userGoals = allGoals.filter(goal => goal.userId === req.user.id);
    
    // 顺序更新每个目标的order字段，避免并发问题
    for (let i = 0; i < goalIds.length; i++) {
      const goalId = goalIds[i];
      const goal = userGoals.find(g => g.id.toString() === goalId.toString());
      
      if (goal) {
        try {
          await updateGoal(goal.id, { order: i });
        } catch (error) {
          throw error;
        }
      }
    }
    
    // 返回更新后的目标列表
    const updatedGoals = (await getAllGoals()).filter(goal => goal.userId === req.user.id);
    const sortedGoals = updatedGoals.sort((a, b) => a.order - b.order);
    
    res.status(200).json({
      success: true,
      data: sortedGoals
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};