const {
  getAllDays,
  getDaysByDateRange,
  searchDaysByKeyword,
  getDayById,
  getDayByDate,
  createOrUpdateDay,
  deleteDay,
  batchUpdateDays
} = require('../models/database');

const dateUtils = require('../models/fileDB').dateUtils;
const { successResponse, errorResponse, validationErrorResponse, notFoundResponse, createdResponse } = require('../utils/response');

// @desc    Get all days
// @route   GET /api/days
// @access  Private
exports.getDays = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Filter by date range if provided
    if (startDate && endDate) {
      if (!dateUtils.isValidDateRange(startDate, endDate)) {
        return validationErrorResponse(res, 'Invalid date range provided');
      }
      
      const days = await getDaysByDateRange(startDate, endDate, req.user.id);
      
      successResponse(res, {
        count: days.length,
        data: days
      });
    } else {
      let days = await getAllDays();
      days = days.filter(day => day.userId === req.user.id);
      
      successResponse(res, {
        count: days.length,
        data: days
      });
    }
  } catch (error) {
    console.error('获取日计划 - 错误:', error);
    errorResponse(res, error.message);
  }
};

// @desc    Get single day
// @route   GET /api/days/:id
// @access  Private
exports.getDay = async (req, res) => {
  try {
    const day = await getDayById(req.params.id);
    
    if (!day) {
      return notFoundResponse(res, 'Day not found');
    }
    
    if (day.userId !== req.user.id) {
      return errorResponse(res, 'Not authorized to access this day', 403);
    }
    
    successResponse(res, { data: day });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Get day by date
// @route   GET /api/days/date/:date
// @access  Private
exports.getDayByDate = async (req, res) => {
  try {
    const dateParam = req.params.date;
    
    if (!dateUtils.isValidDateString(dateParam)) {
      return validationErrorResponse(res, 'Invalid date format. Expected YYYY-MM-DD');
    }
    
    const day = await getDayByDate(dateParam, req.user.id);
    
    if (!day) {
      return successResponse(res, {
        data: {
          date: dateParam,
          userId: req.user.id,
          summary: '',
          tasks: []
        }
      });
    }
    
    successResponse(res, { data: day });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Create or update day
// @route   POST /api/days
// @access  Private
exports.createOrUpdateDay = async (req, res) => {
  try {
    const dayData = {
      ...req.body,
      userId: req.user.id
    };
    
    const day = await createOrUpdateDay(dayData);
    
    if (day.deleted) {
      return successResponse(res, {
        data: null,
        message: 'Day entry deleted due to empty content'
      });
    }
    
    createdResponse(res, { data: day });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Update day
// @route   PUT /api/days/:id
// @access  Private
exports.updateDay = async (req, res) => {
  try {
    const existingDay = await getDayById(req.params.id);
    
    if (!existingDay) {
      return notFoundResponse(res, 'Day not found');
    }
    
    if (existingDay.userId !== req.user.id) {
      return errorResponse(res, 'Not authorized to update this day', 403);
    }
    
    const day = await createOrUpdateDay({ ...req.body, id: req.params.id });
    
    if (day.deleted) {
      return successResponse(res, {
        data: null,
        message: 'Day entry deleted due to empty content'
      });
    }
    
    successResponse(res, { data: day });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Delete day
// @route   DELETE /api/days/:id
// @access  Private
exports.deleteDay = async (req, res) => {
  try {
    const existingDay = await getDayById(req.params.id);
    
    if (!existingDay) {
      return notFoundResponse(res, 'Day not found');
    }
    
    if (existingDay.userId !== req.user.id) {
      return errorResponse(res, 'Not authorized to delete this day', 403);
    }
    
    const day = await deleteDay(req.params.id);
    
    successResponse(res, { data: {} });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Search notes in days
// @route   GET /api/days/search
// @access  Private
exports.searchNotes = async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword) {
      return validationErrorResponse(res, 'Keyword is required');
    }
    
    const results = await searchDaysByKeyword(keyword, req.user.id);
    
    successResponse(res, {
      count: results.length,
      data: results
    });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Batch update days
// @route   POST /api/days/batch
// @access  Private
exports.batchUpdateDays = async (req, res) => {
  try {
    const { days } = req.body;
    
    if (!days || !Array.isArray(days)) {
      return validationErrorResponse(res, 'Days array is required');
    }
    
    const userDays = days.map(day => ({
      ...day,
      userId: req.user.id
    }));
    
    const updatedDays = await batchUpdateDays(userDays);
    
    successResponse(res, {
      count: updatedDays.length,
      data: updatedDays
    });
  } catch (error) {
    console.error('批量更新API - 错误:', error);
    errorResponse(res, error.message);
  }
};