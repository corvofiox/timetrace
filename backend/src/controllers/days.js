const {
  getAllDays,
  getDayById,
  getDayByDate,
  createOrUpdateDay,
  deleteDay
} = require('../config/database');

// @desc    Get all days
// @route   GET /api/days
// @access  Private
exports.getDays = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let days = await getAllDays();
    
    // 只获取当前用户的日计划
    days = days.filter(day => day.userId === req.user.id);
    
    // Filter by date range if provided
    if (startDate && endDate) {
      days = days.filter(day => {
        return day.date >= startDate && day.date <= endDate;
      });
    }
    
    res.status(200).json({
      success: true,
      count: days.length,
      data: days
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single day
// @route   GET /api/days/:id
// @access  Private
exports.getDay = async (req, res) => {
  try {
    const day = await getDayById(req.params.id);
    
    if (!day) {
      return res.status(404).json({
        success: false,
        message: 'Day not found'
      });
    }
    
    // 确保日计划属于当前用户
    if (day.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this day'
      });
    }
    
    res.status(200).json({
      success: true,
      data: day
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get day by date
// @route   GET /api/days/date/:date
// @access  Private
exports.getDayByDate = async (req, res) => {
  try {
    const day = await getDayByDate(req.params.date, req.user.id);
    
    // 如果找不到该日期的日计划，返回一个空的日计划对象
    if (!day) {
      return res.status(200).json({
        success: true,
        data: {
          date: req.params.date,
          userId: req.user.id,
          summary: '',
          tasks: []
        }
      });
    }
    
    res.status(200).json({
      success: true,
      data: day
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create or update day
// @route   POST /api/days
// @access  Private
exports.createOrUpdateDay = async (req, res) => {
  try {
    // 确保创建的日计划与当前用户关联
    const dayData = {
      ...req.body,
      userId: req.user.id
    };
    
    const day = await createOrUpdateDay(dayData);
    
    // 检查是否删除了条目
    if (day.deleted) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'Day entry deleted due to empty content'
      });
    }
    
    res.status(201).json({
      success: true,
      data: day
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update day
// @route   PUT /api/days/:id
// @access  Private
exports.updateDay = async (req, res) => {
  try {
    const existingDay = await getDayById(req.params.id);
    
    if (!existingDay) {
      return res.status(404).json({
        success: false,
        message: 'Day not found'
      });
    }
    
    // 确保日计划属于当前用户
    if (existingDay.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this day'
      });
    }
    
    const day = await createOrUpdateDay({ ...req.body, id: req.params.id });
    
    // 检查是否删除了条目
    if (day.deleted) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'Day entry deleted due to empty content'
      });
    }
    
    res.status(200).json({
      success: true,
      data: day
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete day
// @route   DELETE /api/days/:id
// @access  Private
exports.deleteDay = async (req, res) => {
  try {
    const existingDay = await getDayById(req.params.id);
    
    if (!existingDay) {
      return res.status(404).json({
        success: false,
        message: 'Day not found'
      });
    }
    
    // 确保日计划属于当前用户
    if (existingDay.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this day'
      });
    }
    
    const day = await deleteDay(req.params.id);
    
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