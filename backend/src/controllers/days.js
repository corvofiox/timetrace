const {
  getAllDays,
  getDayById,
  getDayByDate,
  createOrUpdateDay,
  deleteDay
} = require('../models/database');

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

// @desc    Search notes in days
// @route   GET /api/days/search
// @access  Private
exports.searchNotes = async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword) {
      return res.status(400).json({
        success: false,
        message: 'Keyword is required'
      });
    }
    
    // 获取所有日计划
    let days = await getAllDays();
    
    // 只获取当前用户的日计划
    days = days.filter(day => day.userId === req.user.id);
    
    const results = [];
    
    // 将关键字拆分成单个词，去除空格和空字符串
    const keywords = keyword.toLowerCase()
      .split(/\s+/)  // 按空格拆分
      .filter(word => word.length > 0);  // 过滤掉空字符串
    
    // 搜索每日备注
    days.forEach(day => {
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
    
    res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};