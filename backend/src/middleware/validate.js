const { validationErrorResponse } = require('../utils/response');
const { ErrorCodes } = require('../utils/errors');

function validateRequired(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return {
      valid: false,
      message: `${fieldName}不能为空`,
      field: fieldName,
      reason: 'required'
    };
  }
  return { valid: true };
}

function validateString(value, fieldName, options = {}) {
  const { minLength, maxLength, pattern, patternMessage } = options;
  
  if (typeof value !== 'string') {
    return {
      valid: false,
      message: `${fieldName}必须是字符串`,
      field: fieldName,
      reason: 'invalid_type'
    };
  }
  
  if (minLength !== undefined && value.length < minLength) {
    return {
      valid: false,
      message: `${fieldName}长度至少为${minLength}个字符`,
      field: fieldName,
      reason: 'min_length',
      minLength,
      actualLength: value.length
    };
  }
  
  if (maxLength !== undefined && value.length > maxLength) {
    return {
      valid: false,
      message: `${fieldName}长度不能超过${maxLength}个字符`,
      field: fieldName,
      reason: 'max_length',
      maxLength,
      actualLength: value.length
    };
  }
  
  if (pattern && !pattern.test(value)) {
    return {
      valid: false,
      message: patternMessage || `${fieldName}格式无效`,
      field: fieldName,
      reason: 'invalid_format'
    };
  }
  
  return { valid: true };
}

function validateEmail(value, fieldName = '邮箱') {
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!value || value.trim() === '') {
    return {
      valid: false,
      message: `${fieldName}不能为空`,
      field: fieldName,
      reason: 'required'
    };
  }
  
  if (!EMAIL_REGEX.test(value)) {
    return {
      valid: false,
      message: `请输入有效的邮箱地址`,
      field: fieldName,
      reason: 'invalid_format'
    };
  }
  
  return { valid: true };
}

function validatePassword(value, fieldName = '密码') {
  if (!value || value.trim() === '') {
    return {
      valid: false,
      message: `${fieldName}不能为空`,
      field: fieldName,
      reason: 'required'
    };
  }
  
  if (value.length < 6) {
    return {
      valid: false,
      message: `${fieldName}长度至少为6个字符`,
      field: fieldName,
      reason: 'min_length',
      minLength: 6,
      actualLength: value.length
    };
  }
  
  return { valid: true };
}

function validateDate(value, fieldName = '日期') {
  const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  
  if (!value) {
    return {
      valid: false,
      message: `${fieldName}不能为空`,
      field: fieldName,
      reason: 'required'
    };
  }
  
  if (!DATE_REGEX.test(value)) {
    return {
      valid: false,
      message: `${fieldName}格式无效，请使用 YYYY-MM-DD 格式`,
      field: fieldName,
      reason: 'invalid_format',
      expected: 'YYYY-MM-DD'
    };
  }
  
  return { valid: true };
}

function validateTime(value, fieldName = '时间') {
  const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
  
  if (!value) {
    return {
      valid: false,
      message: `${fieldName}不能为空`,
      field: fieldName,
      reason: 'required'
    };
  }
  
  if (!TIME_REGEX.test(value)) {
    return {
      valid: false,
      message: `${fieldName}格式无效，请使用 HH:mm 格式`,
      field: fieldName,
      reason: 'invalid_format',
      expected: 'HH:mm'
    };
  }
  
  return { valid: true };
}

function validateColor(value, fieldName = '颜色') {
  const COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  
  if (value && !COLOR_REGEX.test(value)) {
    return {
      valid: false,
      message: `${fieldName}格式无效，请使用 #RRGGBB 格式`,
      field: fieldName,
      reason: 'invalid_format',
      expected: '#RRGGBB or #RGB'
    };
  }
  
  return { valid: true };
}

function validateArray(value, fieldName) {
  if (!Array.isArray(value)) {
    return {
      valid: false,
      message: `${fieldName}必须是数组格式`,
      field: fieldName,
      reason: 'invalid_type',
      expected: 'array'
    };
  }
  
  return { valid: true };
}

function validate(rules) {
  return (req, res, next) => {
    const errors = [];
    
    for (const rule of rules) {
      const { field, location = 'body', validations } = rule;
      const source = location === 'params' ? req.params : 
                     location === 'query' ? req.query : 
                     req.body;
      const value = source[field];
      
      for (const validation of validations) {
        let result;
        
        switch (validation.type) {
          case 'required':
            result = validateRequired(value, validation.fieldName || field);
            break;
          case 'string':
            result = validateString(value, validation.fieldName || field, validation.options);
            break;
          case 'email':
            result = validateEmail(value, validation.fieldName || field);
            break;
          case 'password':
            result = validatePassword(value, validation.fieldName || field);
            break;
          case 'date':
            result = validateDate(value, validation.fieldName || field);
            break;
          case 'time':
            result = validateTime(value, validation.fieldName || field);
            break;
          case 'color':
            result = validateColor(value, validation.fieldName || field);
            break;
          case 'array':
            result = validateArray(value, validation.fieldName || field);
            break;
          case 'custom':
            result = validation.validator(value, field);
            break;
          default:
            result = { valid: true };
        }
        
        if (!result.valid) {
          errors.push(result);
          break;
        }
      }
    }
    
    if (errors.length > 0) {
      const firstError = errors[0];
      return validationErrorResponse(res, firstError.message, ErrorCodes.VALIDATION_REQUIRED, {
        field: firstError.field,
        reason: firstError.reason,
        allErrors: errors
      });
    }
    
    next();
  };
}

module.exports = {
  validate,
  validateRequired,
  validateString,
  validateEmail,
  validatePassword,
  validateDate,
  validateTime,
  validateColor,
  validateArray
};
