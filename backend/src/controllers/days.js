const {
  getAllDays,
  getDaysByDateRange,
  searchDaysByKeyword,
  getDayById,
  getDayByDate,
  createOrUpdateDay,
  deleteDay
} = require('../models/database');

// 导入日期验证工具
const dateUtils = require('../models/fileDB').dateUtils;

// @desc    Get all days
// @route   GET /api/days
// @access  Private
exports.getDays = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Filter by date range if provided
    if (startDate && endDate) {
      // 验证日期范围是否有效
      if (!dateUtils.isValidDateRange(startDate, endDate)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date range provided'
        });
      }
      
      // 使用优化的方法直接从数据库获取指定范围的数据
      const days = await getDaysByDateRange(startDate, endDate, req.user.id);
      
      res.status(200).json({
        success: true,
        count: days.length,
        data: days
      });
    } else {
      // 如果没有提供日期范围，则返回用户的所有日计划
      let days = await getAllDays();
      days = days.filter(day => day.userId === req.user.id);
      
      res.status(200).json({
        success: true,
        count: days.length,
        data: days
      });
    }
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
    const dateParam = req.params.date;
    
    // 验证日期格式是否有效
    if (!dateUtils.isValidDateString(dateParam)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Expected YYYY-MM-DD'
      });
    }
    
    const day = await getDayByDate(dateParam, req.user.id);
    
    // 如果找不到该日期的日计划，返回一个空的日计划对象
    if (!day) {
      return res.status(200).json({
        success: true,
        data: {
          date: dateParam,
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
    
    // 使用优化的搜索方法直接从数据库获取结果
    const results = await searchDaysByKeyword(keyword, req.user.id);
    
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