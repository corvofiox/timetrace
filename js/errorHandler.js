const ErrorHandler = {
  errorMessages: {
    AUTH_001: '请提供认证令牌',
    AUTH_002: '登录已过期，请重新登录',
    AUTH_003: '无效的令牌，请重新登录',
    AUTH_004: '令牌格式错误',
    AUTH_005: '用户不存在',
    
    REG_001: '该邮箱已被注册',
    REG_002: '该用户名已被使用',
    REG_003: '密码长度至少为6个字符',
    REG_004: '请输入有效的邮箱地址',
    
    LOGIN_001: '该邮箱未注册',
    LOGIN_002: '密码错误',
    LOGIN_003: '账号已被禁用',
    
    GOAL_001: '目标标题不能为空',
    GOAL_002: '目标标题不能超过100个字符',
    GOAL_003: '颜色格式无效',
    GOAL_004: '目标不存在',
    GOAL_005: '您没有权限修改此目标',
    GOAL_006: '您没有权限删除此目标',
    
    DAY_001: '日期格式无效',
    DAY_002: '关联的目标不存在',
    DAY_003: '时间冲突',
    DAY_004: '时间格式无效',
    DAY_005: '日计划不存在',
    
    VAL_001: '必填字段不能为空',
    VAL_002: '字段格式无效',
    VAL_003: '字段长度不符合要求',
    VAL_004: '数值超出范围',
    
    DB_001: '数据库读取错误',
    DB_002: '数据库写入错误',
    DB_003: '数据库锁定错误',
    
    UNKNOWN_001: '未知错误',
    
    NETWORK_ERROR: '网络连接失败，请检查网络',
    SERVER_ERROR: '服务器错误，请稍后重试',
    TIMEOUT_ERROR: '请求超时，请稍后重试'
  },

  parseError(error) {
    if (error && error.errorCode) {
      return {
        code: error.errorCode,
        message: error.message || this.errorMessages[error.errorCode] || '操作失败',
        details: error.details || null
      };
    }
    
    if (error && error.message) {
      return {
        code: 'UNKNOWN_001',
        message: error.message,
        details: null
      };
    }
    
    if (typeof error === 'string') {
      return {
        code: 'UNKNOWN_001',
        message: error,
        details: null
      };
    }
    
    return {
      code: 'UNKNOWN_001',
      message: '操作失败，请稍后重试',
      details: null
    };
  },

  getUserFriendlyMessage(error) {
    const parsed = this.parseError(error);
    
    if (this.errorMessages[parsed.code]) {
      return this.errorMessages[parsed.code];
    }
    
    return parsed.message;
  },

  handle(error, context = '', options = {}) {
    const parsed = this.parseError(error);
    const userMessage = this.getUserFriendlyMessage(error);
    
    console.error(`[${context}] 错误:`, {
      code: parsed.code,
      message: parsed.message,
      details: parsed.details,
      originalError: error
    });
    
    if (options.silent !== true) {
      this.showToUser(userMessage, options);
    }
    
    return {
      code: parsed.code,
      message: userMessage,
      details: parsed.details,
      handled: true
    };
  },

  showToUser(message, options = {}) {
    if (options.onShow) {
      options.onShow(message);
      return;
    }
    
    alert(message);
  },

  isAuthError(error) {
    const parsed = this.parseError(error);
    return parsed.code.startsWith('AUTH_') || 
           parsed.code.startsWith('LOGIN_') ||
           parsed.code === 'TOKEN_EXPIRED';
  },

  isValidationError(error) {
    const parsed = this.parseError(error);
    return parsed.code.startsWith('VAL_') || 
           parsed.code.startsWith('GOAL_') ||
           parsed.code.startsWith('DAY_') ||
           parsed.code.startsWith('REG_');
  },

  isNetworkError(error) {
    if (!error) return false;
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return true;
    }
    
    if (error.message && (
      error.message.includes('network') ||
      error.message.includes('Network') ||
      error.message.includes('Failed to fetch')
    )) {
      return true;
    }
    
    return false;
  },

  createError(code, message, details = null) {
    return {
      success: false,
      errorCode: code,
      message: message || this.errorMessages[code] || '操作失败',
      details: details
    };
  }
};

window.ErrorHandler = ErrorHandler;
