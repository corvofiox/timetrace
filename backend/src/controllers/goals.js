const {
  getAllGoals,
  getGoalById,
  createGoal,
  updateGoal,
  deleteGoal
} = require('../config/database');

// @desc    Get all goals
// @route   GET /api/goals
// @access  Private
exports.getGoals = async (req, res) => {
  try {
    // 只获取当前用户的目标
    const goals = (await getAllGoals()).filter(goal => goal.userId === req.user.id);
    
    res.status(200).json({
      success: true,
      count: goals.length,
      data: goals
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