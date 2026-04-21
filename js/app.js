// 应用数据模型
const appData = {
    goals: [],
    dailyPlans: {},
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    selectedDate: null,
    editingGoalId: null,
    user: null,  // 当前登录用户
    isAuthenticated: false,  // 认证状态
    settings: {
        theme: 'default',
        showWeekends: true,
        startWeekMonday: false,
        enableNotifications: false,
        notificationTime: '09:00'
    },
    // 待处理的任务更改
    pendingTaskChanges: {
        added: [],
        edited: [],
        deleted: []
    },
    
    // 保存当前月份到本地存储
    saveCurrentMonth() {
        localStorage.setItem('currentMonth', this.currentMonth);
        localStorage.setItem('currentYear', this.currentYear);
    },
    
    // 从本地存储恢复当前月份
    restoreCurrentMonth() {
        const savedMonth = localStorage.getItem('currentMonth');
        const savedYear = localStorage.getItem('currentYear');
        
        if (savedMonth !== null && savedYear !== null) {
            this.currentMonth = parseInt(savedMonth, 10);
            this.currentYear = parseInt(savedYear, 10);
        }
    }
};

// 中间层队列系统
const reorderQueue = {
    operations: [],
    isProcessing: false,
    listeners: [], // 监听器列表
    
    // 添加监听器
    addListener(callback) {
        this.listeners.push(callback);
    },
    
    // 移除监听器
    removeListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    },
    
    // 通知监听器
    notifyListeners(event, data) {
        this.listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (error) {
                // 监听器执行失败: error
            }
        });
    },
    
    // 添加排序操作到队列
    addOperation(operation) {
        this.operations.push({
            ...operation,
            timestamp: Date.now(),
            id: utils.generateId()
        });
        
        // 保存队列到本地存储
        this.saveQueue();
        
        // 通知监听器有新操作添加
        this.notifyListeners('operationAdded', { operation });
        
        // 如果没有正在处理的操作，开始处理队列
        if (!this.isProcessing) {
            this.processQueue();
        }
    },
    
    // 处理队列中的操作
    async processQueue() {
        if (this.operations.length === 0) {
            this.isProcessing = false;
            this.notifyListeners('queueEmpty', {});
            return;
        }
        
        this.isProcessing = true;
        this.notifyListeners('processingStarted', {});
        this.showIndicator();
        
        while (this.operations.length > 0) {
            const operation = this.operations.shift();
            
            try {
                await this.executeOperation(operation);
                this.notifyListeners('operationCompleted', { operation });
            } catch (error) {
                this.notifyListeners('operationFailed', { operation, error });
                
                // 如果是网络错误，将操作重新加入队列末尾进行重试
                if (error.message && error.message.includes('network')) {
                    this.operations.push(operation);
                    
                    // 等待一段时间后重试
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            // 保存更新后的队列
            this.saveQueue();
        }
        
        this.isProcessing = false;
        this.notifyListeners('processingCompleted', {});
        this.hideIndicator();
    },
    
    // 执行单个排序操作
    async executeOperation(operation) {
        switch (operation.type) {
            case 'reorder-goals':
                const response = await api.updateGoalOrder(operation.data.goalIds);
                
                // 使用后端返回的最新数据更新本地数据
                if (response && response.data) {
                    appData.goals = response.data;
                }
                break;
            default:
                // 未知的操作类型
        }
    },
    
    // 保存队列到本地存储
    saveQueue() {
        try {
            localStorage.setItem('reorderQueue', JSON.stringify(this.operations));
        } catch (error) {
            // 保存队列到本地存储失败
        }
    },
    
    // 从本地存储加载队列
    loadQueue() {
        try {
            const savedQueue = localStorage.getItem('reorderQueue');
            if (savedQueue) {
                this.operations = JSON.parse(savedQueue);
                
                // 如果有待处理的操作，恢复处理
                if (this.operations.length > 0 && !this.isProcessing) {
                    this.processQueue();
                }
                
                // 通知监听器队列已加载
                this.notifyListeners('queueLoaded', { operations: this.operations });
            }
        } catch (error) {
            this.operations = [];
        }
    },
    
    // 显示队列处理指示器
    showIndicator() {
        // 移除已存在的指示器
        this.hideIndicator();
        
        const indicator = document.createElement('div');
        indicator.id = 'queue-indicator';
        indicator.className = 'queue-indicator';
        indicator.innerHTML = `
            <div class="queue-spinner"></div>
            <div class="queue-text">正在同步排序...</div>
        `;
        
        // 添加样式
        const style = document.createElement('style');
        style.id = 'queue-indicator-style';
        style.textContent = `
            .queue-indicator {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background-color: white;
                padding: 12px 16px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                display: flex;
                align-items: center;
                z-index: 1000;
                font-size: 14px;
            }
            .queue-spinner {
                width: 16px;
                height: 16px;
                border: 2px solid #f3f3f3;
                border-top: 2px solid var(--primary-color);
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-right: 8px;
            }
            .queue-text {
                color: #333;
                font-weight: 500;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(indicator);
    },
    
    // 隐藏队列处理指示器
    hideIndicator() {
        const indicator = document.getElementById('queue-indicator');
        const style = document.getElementById('queue-indicator-style');
        
        if (indicator) {
            indicator.parentNode.removeChild(indicator);
        }
        
        if (style) {
            style.parentNode.removeChild(style);
        }
    },
    
    // 清空队列
    clearQueue() {
        this.operations = [];
        this.saveQueue();
        this.hideIndicator();
    }
};

// 拖拽辅助函数
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.goal-card:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// DOM元素引用
const elements = {
    // 认证相关元素
    authContainer: document.getElementById('auth-container'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    showRegisterLink: document.getElementById('switch-to-register'),
    showLoginLink: document.getElementById('switch-to-login'),
    appContainer: document.getElementById('app-container'),
    logoutBtn: document.getElementById('logout-btn'),
    userWelcome: document.getElementById('user-welcome'),
    usernameDisplay: document.getElementById('username-display'),
    userSettingsBtn: document.getElementById('user-settings-btn'),
    
    // 日历元素
    calendarDays: document.getElementById('calendar-days'),
    currentMonthYear: document.getElementById('current-month-year'),
    prevMonth: document.getElementById('prev-month'),
    nextMonth: document.getElementById('next-month'),
    todayBtn: document.getElementById('today-btn'),
    
    // 目标元素
    goalsContainer: document.getElementById('goals-container'),
    addGoalBtn: document.getElementById('add-goal-btn'),
    
    // 统计元素
    totalTasks: document.getElementById('total-tasks'),
    completedTasks: document.getElementById('completed-tasks'),
    completionRate: document.getElementById('completion-rate'),
    currentStreak: document.getElementById('current-streak'),
    
    // 模态框元素
    dayModal: document.getElementById('day-modal'),
    goalModal: document.getElementById('goal-modal'),
    heatmapModal: document.getElementById('heatmap-modal'),
    taskInputModal: document.getElementById('task-input-modal'),
    userSettingsModal: document.getElementById('user-settings-modal'),
    
    // 日格编辑元素
    modalDateTitle: document.getElementById('modal-date-title'),
    dailySummary: document.getElementById('daily-summary'),
    tasksList: document.getElementById('tasks-list'),
    addTaskBtn: document.getElementById('add-task-btn'),
    saveDayBtn: document.getElementById('save-day-btn'),
    cancelDayBtn: document.getElementById('cancel-day-btn'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    
    // 目标编辑元素
    goalModalTitle: document.getElementById('goal-modal-title'),
    goalName: document.getElementById('goal-name'),
    goalDate: document.getElementById('goal-date'),
    goalColor: document.getElementById('goal-color'),
    saveGoalBtn: document.getElementById('save-goal-btn'),
    cancelGoalBtn: document.getElementById('cancel-goal-btn'),
    closeGoalModalBtn: document.getElementById('close-goal-modal-btn'),
    
    // 折线图元素
    heatmapToggle: document.getElementById('heatmap-toggle'),
    chartContainer: document.getElementById('chart-container'),
    chartCanvas: document.getElementById('task-chart'),
    chartType: document.getElementById('chart-type'),
    
    // 下拉菜单元素
    functionsMenuBtn: document.getElementById('functions-menu-btn'),
    functionsDropdown: document.getElementById('functions-dropdown'),
    chartPeriod: document.getElementById('chart-period'),
    chartGoal: document.getElementById('chart-goal'),
    avgCompletion: document.getElementById('avg-completion'),
    maxCompletion: document.getElementById('max-completion'),
    minCompletion: document.getElementById('min-completion'),
    closeHeatmapBtn: document.getElementById('close-heatmap-btn'),
    
    // 任务输入元素
    taskTitle: document.getElementById('task-title'),
    taskInput: document.getElementById('task-input'),
    saveTaskBtn: document.getElementById('save-task-btn'),
    cancelTaskBtn: document.getElementById('cancel-task-btn'),
    closeTaskModalBtn: document.getElementById('close-task-modal-btn'),
    taskInputModalTitle: document.querySelector('#task-input-modal .modal-header h3'),
    
    // 批量任务输入模态框元素
    batchTaskInputModal: document.getElementById('batch-task-input-modal'),
    closeBatchTaskModalBtn: document.getElementById('close-batch-task-modal-btn'),
    batchTaskTitle: document.getElementById('batch-task-title'),
    batchTaskInput: document.getElementById('batch-task-input'),
    saveBatchTaskBtn: document.getElementById('save-batch-task-btn'),
    cancelBatchTaskBtn: document.getElementById('cancel-batch-task-btn'),
    batchTaskModalTitle: document.getElementById('batch-task-modal-title'),
    
    // 用户设置元素
    closeSettingsModalBtn: document.getElementById('close-settings-modal-btn'),
    themeSelect: document.getElementById('theme-select'),
    showWeekends: document.getElementById('show-weekends'),
    startWeekMonday: document.getElementById('start-week-monday'),
    enableNotifications: document.getElementById('enable-notifications'),
    notificationTime: document.getElementById('notification-time'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    cancelSettingsBtn: document.getElementById('cancel-settings-btn'),
    
    // 认证表单元素
    loginEmail: document.getElementById('login-email'),
    loginPassword: document.getElementById('login-password'),
    loginBtn: document.getElementById('login-btn'),
    registerUsername: document.getElementById('register-username'),
    registerEmail: document.getElementById('register-email'),
    registerPassword: document.getElementById('register-password'),
    registerBtn: document.getElementById('register-btn'),
    
    // 批量添加任务元素
    openBatchAddModalBtn: document.getElementById('open-batch-add-modal-btn'),
    batchAddTaskModal: document.getElementById('batch-add-task-modal'),
    closeBatchAddModalBtn: document.getElementById('close-batch-add-modal-btn'),
    batchStartDate: document.getElementById('batch-start-date'),
    batchEndDate: document.getElementById('batch-end-date'),
    batchTasksList: document.getElementById('batch-tasks-list'),
    batchAddTaskBtn: document.getElementById('batch-add-task-btn'),
    batchClearExisting: document.getElementById('batch-clear-existing'),
    batchAddSaveBtn: document.getElementById('batch-add-save-btn'),
    batchAddCancelBtn: document.getElementById('batch-add-cancel-btn'),
    batchPreviewContent: document.getElementById('batch-preview-content'),
    selectedDatesList: document.getElementById('selected-dates-list'),
    miniCalendar: document.getElementById('mini-calendar'),
    weekdaysStartDate: document.getElementById('weekdays-start-date'),
    weekdaysEndDate: document.getElementById('weekdays-end-date'),
    
    // 确认对话框元素
    confirmDialog: document.getElementById('confirm-dialog'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmMessage: document.getElementById('confirm-message'),
    confirmOkBtn: document.getElementById('confirm-ok-btn'),
    confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
    closeConfirmBtn: document.getElementById('close-confirm-btn'),
    
    // 月份选择器元素
    monthPickerModal: document.getElementById('month-picker-modal'),
    closeMonthPickerBtn: document.getElementById('close-month-picker-btn'),
    yearInput: document.getElementById('year-input'),
    yearDecrement: document.getElementById('year-decrement'),
    yearIncrement: document.getElementById('year-increment'),
    monthsGrid: document.querySelector('.months-grid'),
    monthPickerTodayBtn: document.getElementById('month-picker-today-btn'),
    monthPickerCancelBtn: document.getElementById('month-picker-cancel-btn'),
    
    // 备注搜索元素
        openNotesSearchBtn: document.getElementById('open-notes-search-btn'),
        notesSearchModal: document.getElementById('notes-search-modal'),
        closeNotesSearchBtn: document.getElementById('close-notes-search-btn'),
        closeNotesSearchFooterBtn: document.getElementById('close-notes-search-footer-btn'),
        notesSearchInput: document.getElementById('notes-search-input'),
        searchResultsContainer: document.getElementById('search-results-container')
};

// 数据缓存管理
const dataCache = {
    // 存储已加载的月份数据
    monthDataCache: new Map(),
    
    // 检查月份是否已缓存
    isMonthCached(year, month) {
        const key = `${year}-${month}`;
        return this.monthDataCache.has(key);
    },
    
    // 获取缓存的月份数据
    getCachedMonthData(year, month) {
        const key = `${year}-${month}`;
        return this.monthDataCache.get(key) || null;
    },
    
    // 缓存月份数据
    cacheMonthData(year, month, data) {
        const key = `${year}-${month}`;
        this.monthDataCache.set(key, data);
    },
    
    // 清除指定月份的缓存
    clearMonthCache(year, month) {
        const key = `${year}-${month}`;
        this.monthDataCache.delete(key);
    },
    
    // 清除所有缓存
    clearAllCache() {
        this.monthDataCache.clear();
    }
};
const utils = {
    // 解析日期字符串为 Date 对象（避免时区问题）
    parseDate(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') {
            return null;
        }
        
        // 支持 YYYY-MM-DD 和 YYYY-MM-DDTHH:MM 格式
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
        if (!match) {
            return null;
        }
        
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const day = parseInt(match[3], 10);
        
        // 验证日期是否有效
        if (!this.isValidDate(year, month, day)) {
            return null;
        }
        
        // 如果有时间部分，包含时间
        if (match[4] !== undefined && match[5] !== undefined) {
            const hours = parseInt(match[4], 10);
            const minutes = parseInt(match[5], 10);
            return new Date(year, month, day, hours, minutes);
        }
        
        return new Date(year, month, day);
    },
    
    // 格式化日期为 YYYY-MM-DD
    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },
    
    // 格式化日期为 YYYY-MM-DDTHH:MM
    formatDateTime(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    },
    
    // 获取月份名称
    getMonthName(monthIndex) {
        const months = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
        return months[monthIndex];
    },
    
    // 获取月份天数
    getDaysInMonth(year, month) {
        return new Date(year, month + 1, 0).getDate();
    },
    
    // 获取月份第一天是星期几
    getFirstDayOfMonth(year, month) {
        return new Date(year, month, 1).getDay();
    },
    
    // 验证日期是否有效（特别处理31日的情况）
    isValidDate(year, month, day) {
        // 创建日期对象
        const date = new Date(year, month, day);
        // 检查日期是否有效（防止出现2月31日等情况）
        return date.getFullYear() === year && 
               date.getMonth() === month && 
               date.getDate() === day;
    },
    
    // 获取安全的日期范围，确保包含所有有效的月份日期
    getSafeDateRange(year, month) {
        const firstDay = new Date(year, month, 1);
        const daysInMonth = this.getDaysInMonth(year, month);
        const lastDay = new Date(year, month, daysInMonth);
        
        return {
            startDate: this.formatDate(firstDay),
            endDate: this.formatDate(lastDay),
            daysInMonth: daysInMonth
        };
    },
    
    // 获取日期范围内的所有日期（不可变方式）
    getDateRange(startDate, endDate) {
        const dates = [];
        const current = new Date(startDate);
        const end = new Date(endDate);
        
        while (current <= end) {
            dates.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        
        return dates;
    },
    
    // 生成唯一ID
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },
    
    // 计算倒计时
    calculateCountdown(targetDate) {
        const now = new Date();
        const target = utils.parseDate(targetDate);
        if (!target) {
            return { expired: true, text: '无效日期' };
        }
        const diff = target - now;
        
        if (diff <= 0) {
            return { expired: true, text: '已过期' };
        }
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        let text = '';
        if (days > 0) text += `${days}天 `;
        if (hours > 0) text += `${hours}小时 `;
        if (minutes > 0) text += `${minutes}分钟 `;
        text += `${seconds}秒`;
        
        return { expired: false, text };
    },
    
    // 计算完成率
    calculateCompletionRate(tasks) {
        if (!tasks || tasks.length === 0) return 0;
        const completed = tasks.filter(task => task.completed).length;
        return Math.round((completed / tasks.length) * 100);
    },
    
    // 计算连续天数
    calculateStreak() {
        let streak = 0;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        let checkDate = new Date(yesterday);
        
        for (let i = 0; i < 365; i++) {
            const dateStr = utils.formatDate(checkDate);
            
            if (appData.dailyPlans[dateStr] && appData.dailyPlans[dateStr].tasks) {
                const tasks = appData.dailyPlans[dateStr].tasks;
                if (tasks.length > 0 && tasks.every(task => task.completed)) {
                    streak++;
                } else {
                    break;
                }
            } else {
                break;
            }
            
            // 移动到前一天
            checkDate.setDate(checkDate.getDate() - 1);
        }
        
        return streak;
    }
};

// 确认对话框功能
const confirmDialog = {
    callback: null,
    
    // 打开确认对话框
    open(title, message, onConfirm) {
        this.callback = onConfirm;
        elements.confirmTitle.textContent = title;
        elements.confirmMessage.textContent = message;
        elements.confirmDialog.style.display = 'flex';
    },
    
    // 关闭确认对话框
    close() {
        elements.confirmDialog.style.display = 'none';
        this.callback = null;
    },
    
    // 确认操作
    confirm() {
        if (typeof this.callback === 'function') {
            this.callback();
        }
        this.close();
    }
};

// 确认按钮事件
elements.confirmOkBtn.addEventListener('click', () => confirmDialog.confirm());

// 取消按钮事件
elements.confirmCancelBtn.addEventListener('click', () => confirmDialog.close());
const calendar = {
    // 渲染日历
    render() {
        const { currentMonth, currentYear } = appData;
        const firstDay = utils.getFirstDayOfMonth(currentYear, currentMonth);
        const daysInMonth = utils.getDaysInMonth(currentYear, currentMonth);
        
        // 更新月份年份显示
        elements.currentMonthYear.textContent = `${currentYear}年 ${utils.getMonthName(currentMonth)}`;
        
        // 更新星期标题
        this.updateWeekdayHeaders();
        
        // 清空日历
        elements.calendarDays.innerHTML = '';
        
        const showWeekends = appData.settings.showWeekends;
        const startWeekMonday = appData.settings.startWeekMonday;
        
        // 计算第一天前的空白格子数
        let emptyDays = firstDay;
        if (startWeekMonday) {
            emptyDays = (firstDay === 0) ? 6 : firstDay - 1;
        }
        
        // 如果隐藏周末，需要重新计算空白格子（排除周末）
        if (!showWeekends) {
            emptyDays = this.calculateEmptyDaysExcludingWeekends(currentYear, currentMonth, startWeekMonday);
        }
        
        // 添加空白格子，直到当月第一天
        for (let i = 0; i < emptyDays; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.classList.add('calendar-day', 'empty-day');
            elements.calendarDays.appendChild(emptyDay);
        }
        
        // 添加当月日期
        for (let day = 1; day <= daysInMonth; day++) {
            // 验证日期是否有效（特别处理31日的情况）
            if (!utils.isValidDate(currentYear, currentMonth, day)) {
                console.warn(`Invalid date detected: ${currentYear}-${currentMonth + 1}-${day}, skipping`);
                continue;
            }
            
            const date = new Date(currentYear, currentMonth, day);
            const dayElement = calendar.createDayElement(day, date);
            if (dayElement) {
                elements.calendarDays.appendChild(dayElement);
            }
        }
        
        // 更新统计
        stats.update();
    },
    
    // 计算隐藏周末时的空白格子数
    calculateEmptyDaysExcludingWeekends(year, month, startWeekMonday) {
        const firstDay = new Date(year, month, 1).getDay();
        let adjustedFirstDay = firstDay;
        
        if (startWeekMonday) {
            adjustedFirstDay = (firstDay === 0) ? 6 : firstDay - 1;
        }
        
        // 计算在隐藏周末的情况下，第一天前有多少个工作日
        let emptyDays = 0;
        for (let i = 0; i < adjustedFirstDay; i++) {
            let checkDay;
            if (startWeekMonday) {
                // 周一为起始：i=0 是周一，i=5 是周六，i=6 是周日
                checkDay = i === 5 ? 6 : (i === 6 ? 0 : i + 1);
            } else {
                // 周日为起始：i=0 是周日，i=6 是周六
                checkDay = i;
            }
            
            // 如果不是周末（0=周日，6=周六），则计入空白格子
            if (checkDay !== 0 && checkDay !== 6) {
                emptyDays++;
            }
        }
        
        return emptyDays;
    },
    
    // 更新星期标题
    updateWeekdayHeaders() {
        const weekdayHeaders = document.querySelector('.weekday-headers');
        weekdayHeaders.innerHTML = '';
        
        let weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        
        // 如果设置为周一作为一周的开始，则调整星期顺序
        if (appData.settings.startWeekMonday) {
            weekdays = ['一', '二', '三', '四', '五', '六', '日'];
        }
        
        // 如果设置为不显示周末，则只显示工作日
        if (!appData.settings.showWeekends) {
            if (appData.settings.startWeekMonday) {
                weekdays = ['一', '二', '三', '四', '五'];
            } else {
                weekdays = ['一', '二', '三', '四', '五'];
            }
        }
        
        weekdays.forEach(day => {
            const dayHeader = document.createElement('div');
            dayHeader.classList.add('weekday-header');
            dayHeader.textContent = day;
            weekdayHeaders.appendChild(dayHeader);
        });
    },
    
    // 创建日期元素
    createDayElement(day, date) {
        // 检查是否是周末
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        // 如果设置为不显示周末且当前日期是周末，则不创建元素
        if (!appData.settings.showWeekends && isWeekend) {
            return null;
        }
        
        const dayElement = document.createElement('div');
        dayElement.classList.add('calendar-day');
        
        // 如果是周末，添加周末样式
        if (isWeekend) {
            dayElement.classList.add('weekend');
        }
        
        // 获取日期字符串
        const dateStr = utils.formatDate(date);
        
        // 检查是否有任务
        const hasTasks = appData.dailyPlans[dateStr] && 
                         appData.dailyPlans[dateStr].tasks && 
                         appData.dailyPlans[dateStr].tasks.length > 0;
        
        // 检查是否有备注
        const hasSummary = appData.dailyPlans[dateStr] && 
                           appData.dailyPlans[dateStr].summary && 
                           appData.dailyPlans[dateStr].summary.trim() !== '';
        
        // 检查是否是过期日期
        const today = new Date();
        today.setHours(0, 0, 0, 0); // 设置为当天的开始时间
        const isPastDate = date < today;
        
        // 检查过往日期的任务是否全部完成
        let allTasksCompleted = false;
        
        if (isPastDate && hasTasks) {
            // 检查是否全部完成
            allTasksCompleted = appData.dailyPlans[dateStr].tasks.every(task => task.completed === true);
        }
        
        // 只有有任务的情况下才添加has-content相关类
        if (hasTasks) {
            if (isPastDate) {
                // 过往日期的任务逻辑
                if (allTasksCompleted) {
                    dayElement.classList.add('has-content-past-completed');
                } else {
                    dayElement.classList.add('has-content-past-incomplete');
                }
            } else {
                // 当日和未来日期，有任务就添加has-content类
                dayElement.classList.add('has-content');
            }
        }
        
        // 检查是否是今天
        if (date.toDateString() === today.toDateString()) {
            dayElement.classList.add('today');
        }
        
        // 日期数字
        const dayNumber = document.createElement('div');
        dayNumber.classList.add('day-number');
        dayNumber.textContent = day;
        dayElement.appendChild(dayNumber);
        
        // 如果是今天，添加圆点标记
        if (date.toDateString() === today.toDateString()) {
            const todayDot = document.createElement('div');
            todayDot.classList.add('today-dot');
            dayNumber.appendChild(todayDot);
        }
        
        // 显示目标标记
        appData.goals.forEach(goal => {
            const goalDate = utils.parseDate(goal.date);
            if (goalDate && goalDate.toDateString() === date.toDateString()) {
                const marker = document.createElement('div');
                marker.classList.add('goal-marker');
                marker.style.backgroundColor = goal.color;
                dayElement.appendChild(marker);
            }
        });
        
        // 显示备注标记
        if (hasSummary) {
            const summaryMarker = document.createElement('div');
            summaryMarker.classList.add('summary-marker');
            summaryMarker.innerHTML = '<i class="ri-file-text-line"></i>';
            dayElement.appendChild(summaryMarker);
            
            // 如果同时有目标标记，调整目标标记的位置
            const goalMarker = dayElement.querySelector('.goal-marker');
            if (goalMarker) {
                goalMarker.style.right = '2rem';
            }
        }
        
        // 显示任务预览
        if (appData.dailyPlans[dateStr] && appData.dailyPlans[dateStr].tasks) {
            const tasksContainer = document.createElement('div');
            tasksContainer.classList.add('day-tasks');
            
            const tasks = appData.dailyPlans[dateStr].tasks;
            const maxDisplay = 3; // 最多显示3个任务
            
            for (let i = 0; i < Math.min(tasks.length, maxDisplay); i++) {
                const taskItem = document.createElement('div');
                taskItem.classList.add('day-task-item');
                if (tasks[i].completed) {
                    taskItem.classList.add('completed');
                }
                taskItem.textContent = tasks[i].title;
                tasksContainer.appendChild(taskItem);
            }
            
            if (tasks.length > maxDisplay) {
                const moreItem = document.createElement('div');
                moreItem.classList.add('day-task-item');
                moreItem.textContent = `...还有${tasks.length - maxDisplay}项`;
                tasksContainer.appendChild(moreItem);
            }
            
            dayElement.appendChild(tasksContainer);
        }
        
        // 添加点击事件
        dayElement.addEventListener('click', () => {
            appData.selectedDate = date;
            dayModal.open(dateStr);
        });
        
        return dayElement;
    },
    
    // 切换到上个月
    prevMonth() {
        appData.currentMonth--;
        if (appData.currentMonth < 0) {
            appData.currentMonth = 11;
            appData.currentYear--;
        }
        
        // 保存当前月份状态
        appData.saveCurrentMonth();
        
        loadDays().then(() => {
            calendar.render();
        });
    },
    
    // 切换到下个月
    nextMonth() {
        appData.currentMonth++;
        if (appData.currentMonth > 11) {
            appData.currentMonth = 0;
            appData.currentYear++;
        }
        
        // 保存当前月份状态
        appData.saveCurrentMonth();
        
        loadDays().then(() => {
            calendar.render();
        });
    },
    
    // 跳转到本月
    goToCurrentMonth() {
        const today = new Date();
        appData.currentMonth = today.getMonth();
        appData.currentYear = today.getFullYear();
        
        // 保存当前月份状态
        appData.saveCurrentMonth();
        
        loadDays().then(() => {
            calendar.render();
        });
    }
};

// 目标管理功能
const goals = {
    // 渲染目标列表
    render() {
        elements.goalsContainer.innerHTML = '';
        
        if (appData.goals.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.classList.add('empty-message');
            emptyMessage.textContent = '暂无目标，点击上方按钮添加';
            elements.goalsContainer.appendChild(emptyMessage);
            return;
        }
        
        // 按order字段排序，如果没有order字段则按创建时间排序
        const sortedGoals = [...appData.goals].sort((a, b) => {
            // 确保order字段是数字类型
            const aOrder = a.order !== undefined ? parseInt(a.order) : 999999;
            const bOrder = b.order !== undefined ? parseInt(b.order) : 999999;
            
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            
            // 如果order相同或都没有order，按创建时间排序
            return new Date(a.createdAt) - new Date(b.createdAt);
        });
        
        sortedGoals.forEach(goal => {
            const goalCard = goals.createGoalCard(goal);
            elements.goalsContainer.appendChild(goalCard);
        });
        
        // 更新日历以显示目标标记
        calendar.render();
    },
    
    // 强制重新渲染并重新绑定事件
    forceRender() {
        this.render();
        // 重新启动倒计时以确保事件绑定正确
        countdown.stopTimer();
        countdown.startTimer();
    },
    
    // 创建目标卡片
    createGoalCard(goal) {
        const goalCard = document.createElement('div');
        goalCard.classList.add('goal-card');
        goalCard.style.borderLeftColor = goal.color;
        goalCard.draggable = true;
        goalCard.dataset.goalId = goal.id;
        
        const countdownResult = utils.calculateCountdown(goal.date);
        
        goalCard.innerHTML = `
            <div class="goal-header">
                <div class="goal-name">${goal.name}</div>
                <div class="goal-actions">
                    <button class="btn btn-icon btn-sm edit-goal" data-id="${goal.id}">
                        <i class="ri-edit-line"></i>
                    </button>
                    <button class="btn btn-icon btn-sm delete-goal" data-id="${goal.id}">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                </div>
            </div>
            <div class="goal-date">目标日期: ${new Date(goal.date).toLocaleString('zh-CN')}</div>
            <div class="goal-countdown ${countdownResult.expired ? 'expired' : ''}">
                ${countdownResult.expired ? '已过期' : '剩余: ' + countdownResult.text}
            </div>
        `;
        
        // 添加编辑事件
        goalCard.querySelector('.edit-goal').addEventListener('click', (e) => {
            e.stopPropagation();
            goalModal.open(goal.id);
        });
        
        // 添加删除事件
        goalCard.querySelector('.delete-goal').addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDialog.open(
                '删除目标',
                '确定要删除这个目标吗？此操作不可撤销。',
                () => goals.remove(goal.id)
            );
        });
        
        // 添加拖拽事件 - 使用更可靠的实现
        goalCard.addEventListener('dragstart', (e) => {
            // 设置拖拽数据
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', goalCard.outerHTML);
            e.dataTransfer.setData('text/plain', goal.id);
            
            // 添加拖拽样式
            goalCard.classList.add('dragging');
            
            // 暂停倒计时，避免拖拽时重新渲染
            countdown.pauseTimer();
            
            // 存储拖拽开始时的位置信息
            goalCard.dataset.dragStartY = e.clientY.toString();
        });
        
        goalCard.addEventListener('dragend', () => {
            // 移除拖拽样式
            goalCard.classList.remove('dragging');
            
            // 清理所有拖拽相关的样式
            document.querySelectorAll('.goal-card').forEach(card => {
                card.classList.remove('drag-over');
                card.style.transform = '';
            });
            
            // 恢复倒计时
            countdown.resumeTimer();
        });
        
        goalCard.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const draggingCard = document.querySelector('.dragging');
            if (!draggingCard || draggingCard === goalCard) return;
            
            // 清理所有卡片的悬停效果
            document.querySelectorAll('.goal-card').forEach(card => {
                card.classList.remove('drag-over');
            });
            
            // 添加当前悬停效果
            goalCard.classList.add('drag-over');
            
            // 计算拖拽位置
            const rect = goalCard.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const container = elements.goalsContainer;
            
            // 根据鼠标位置决定插入位置
            if (e.clientY < midpoint) {
                // 插入到当前卡片之前
                if (goalCard.previousElementSibling !== draggingCard) {
                    container.insertBefore(draggingCard, goalCard);
                }
            } else {
                // 插入到当前卡片之后
                if (goalCard.nextElementSibling !== draggingCard) {
                    container.insertBefore(draggingCard, goalCard.nextElementSibling);
                }
            }
        });
        
        goalCard.addEventListener('dragleave', () => {
            goalCard.classList.remove('drag-over');
        });
        
        goalCard.addEventListener('drop', (e) => {
            e.preventDefault();
            goalCard.classList.remove('drag-over');
            
            // 更新目标顺序
            goals.updateGoalOrder();
        });
        
        return goalCard;
    },
    
    // 添加目标
    add(goalData) {
        // 设置新目标的order为当前目标的数量
        const newGoalData = {
            ...goalData,
            order: appData.goals.length
        };
        
        api.createGoal(newGoalData)
            .then(response => {
                const newGoal = response.data;
                appData.goals.push(newGoal);
                
                // 清除所有缓存，因为新目标可能影响多个月份的显示
                dataCache.clearAllCache();
                
                goals.forceRender();
                
                // 启动倒计时更新
                if (!countdownTimer) {
                    countdown.startTimer();
                }
            })
            .catch(error => {
                const handled = window.ErrorHandler ? 
                    window.ErrorHandler.handle(error, '添加目标') : 
                    { message: error.message || '未知错误' };
                alert(handled.message || '添加失败');
            });
    },
    
    // 更新目标
    update(goalId, goalData) {
        api.updateGoal(goalId, goalData)
            .then(response => {
                const updatedGoal = response.data;
                const index = appData.goals.findIndex(goal => goal.id === goalId);
                if (index !== -1) {
                    appData.goals[index] = updatedGoal;
                    
                    // 清除所有缓存，因为目标更新可能影响多个月份的显示
                    dataCache.clearAllCache();
                    
                    goals.forceRender();
                }
            })
            .catch(error => {
                const handled = window.ErrorHandler ? 
                    window.ErrorHandler.handle(error, '更新目标') : 
                    { message: error.message || '未知错误' };
                alert(handled.message || '更新失败');
            });
    },
    
    // 删除目标
    remove(goalId) {
        api.deleteGoal(goalId)
            .then(response => {
                // 确认删除成功后再从本地数组中移除
                if (response && response.success) {
                    appData.goals = appData.goals.filter(goal => goal.id !== goalId);
                    
                    // 清除所有缓存，因为目标删除可能影响多个月份的显示
                    dataCache.clearAllCache();
                    
                    goals.forceRender();
                    
                    // 如果没有目标了，停止倒计时更新
                    if (appData.goals.length === 0) {
                        countdown.stopTimer();
                    }
                }
            })
            .catch(error => {
                const handled = window.ErrorHandler ? 
                    window.ErrorHandler.handle(error, '删除目标') : 
                    { message: error.message || '未知错误' };
                alert(handled.message || '删除失败');
            });
    },
    
    // 更新目标顺序 - 使用队列系统
    updateGoalOrder() {
        const goalCards = document.querySelectorAll('.goal-card');
        const newOrder = Array.from(goalCards).map(card => card.dataset.goalId);
        
        // 更新目标顺序: newOrder
        
        // 检查顺序是否真的发生了变化
        const currentOrder = appData.goals.map(goal => goal.id.toString());
        const orderChanged = JSON.stringify(currentOrder) !== JSON.stringify(newOrder);
        
        if (!orderChanged) {
            // 顺序未变化，跳过更新
            countdown.resumeTimer();
            return;
        }
        
        // 立即更新本地数据，提供即时反馈
        const updatedGoals = newOrder.map((goalId, index) => {
            const goal = appData.goals.find(g => g.id.toString() === goalId);
            if (goal) {
                return { ...goal, order: index };
            }
            return goal;
        }).filter(Boolean);
        
        appData.goals = updatedGoals;
        
        // 添加排序操作到队列
        reorderQueue.addOperation({
            type: 'reorder-goals',
            data: { goalIds: newOrder }
        });
        
        // 恢复倒计时
        countdown.resumeTimer();
    }
};

// 日格编辑模态框
const dayModal = {
    // 打开模态框
    open(dateStr) {
        const date = utils.parseDate(dateStr);
        if (!date) return;
        elements.modalDateTitle.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
        
        // 加载该日的计划和任务
        const dailyPlan = appData.dailyPlans[dateStr] || { summary: '', tasks: [] };
        elements.dailySummary.value = dailyPlan.summary || '';
        
        // 渲染任务列表（包括待处理的更改）
        taskInputModal.updateUIWithPendingChanges();
        
        // 显示模态框
        elements.dayModal.classList.add('active');
    },
    
    // 关闭模态框
    close() {
        elements.dayModal.classList.remove('active');
        
        // 清空待处理的更改
        appData.pendingTaskChanges.added = [];
        appData.pendingTaskChanges.edited = [];
        appData.pendingTaskChanges.deleted = [];
    },
    
    // 渲染任务列表
    renderTasks(tasks) {
        elements.tasksList.innerHTML = '';
        
        if (tasks.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.classList.add('empty-message');
            emptyMessage.textContent = '暂无任务，点击下方按钮添加';
            elements.tasksList.appendChild(emptyMessage);
            return;
        }
        
        tasks.forEach(task => {
            const taskItem = dayModal.createTaskItem(task);
            elements.tasksList.appendChild(taskItem);
        });
    },
    
    // 创建任务项
    createTaskItem(task) {
        const taskItem = document.createElement('div');
        taskItem.classList.add('task-item');
        if (task.completed) {
            taskItem.classList.add('completed');
        }
        
        taskItem.innerHTML = `
            <div class="task-checkbox ${task.completed ? 'checked' : ''}" data-id="${task.id}">
                ${task.completed ? '<i class="ri-checkbox-circle-fill"></i>' : '<i class="ri-checkbox-blank-circle-line"></i>'}
            </div>
            <div class="task-text">${task.title}</div>
            <div class="task-actions">
                <button class="btn btn-icon btn-sm edit-task" data-id="${task.id}">
                    <i class="ri-edit-line"></i>
                </button>
                <button class="btn btn-icon btn-sm delete-task" data-id="${task.id}">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </div>
        `;
        
        // 添加切换完成状态事件
        taskItem.querySelector('.task-checkbox').addEventListener('click', async () => {
            const dateStr = utils.formatDate(appData.selectedDate);
            
            let currentCompleted = task.completed;
            
            const existingChange = appData.pendingTaskChanges.edited.find(
                change => change.taskId === task.id && change.dateStr === dateStr
            );
            
            if (existingChange) {
                currentCompleted = existingChange.completed;
            }
            
            const newCompleted = !currentCompleted;
            
            const editChange = {
                taskId: task.id,
                dateStr: dateStr,
                title: task.title,
                description: task.description,
                completed: newCompleted
            };
            
            const existingIndex = appData.pendingTaskChanges.edited.findIndex(
                change => change.taskId === task.id && change.dateStr === dateStr
            );
            
            if (existingIndex !== -1) {
                appData.pendingTaskChanges.edited[existingIndex] = editChange;
            } else {
                appData.pendingTaskChanges.edited.push(editChange);
            }
            
            const checkbox = taskItem.querySelector('.task-checkbox');
            const icon = checkbox.querySelector('i');
            
            if (newCompleted) {
                checkbox.classList.add('checked');
                icon.className = 'ri-checkbox-circle-fill';
                taskItem.classList.add('completed');
            } else {
                checkbox.classList.remove('checked');
                icon.className = 'ri-checkbox-blank-circle-line';
                taskItem.classList.remove('completed');
            }
            
            // 立即保存到后端
            const existingDailyPlan = appData.dailyPlans[dateStr];
            const dailyPlan = existingDailyPlan ? { ...existingDailyPlan } : { date: dateStr, summary: '', tasks: [] };
            dailyPlan.date = dateStr;
            dailyPlan.summary = elements.dailySummary.value;
            
            // 保留原始记录的 id 字段
            if (existingDailyPlan && existingDailyPlan.id) {
                dailyPlan.id = existingDailyPlan.id;
            }
            
            // 确保任务数组是深拷贝
            dailyPlan.tasks = [...(dailyPlan.tasks || [])];
            
            // 应用待处理的更改
            dailyPlan.tasks = dailyPlan.tasks.filter(task => {
                return !appData.pendingTaskChanges.deleted.some(deleted => deleted.taskId === task.id);
            });
            
            appData.pendingTaskChanges.edited.forEach(edit => {
                if (edit.dateStr === dateStr) {
                    const taskIndex = dailyPlan.tasks.findIndex(t => t.id === edit.taskId);
                    if (taskIndex !== -1) {
                        // 只更新明确提供的字段
                        const updates = {};
                        if (edit.title !== undefined) updates.title = edit.title;
                        if (edit.description !== undefined) updates.description = edit.description;
                        if (edit.completed !== undefined) updates.completed = edit.completed;
                        
                        dailyPlan.tasks[taskIndex] = {
                            ...dailyPlan.tasks[taskIndex],
                            ...updates
                        };
                    }
                }
            });
            
            appData.pendingTaskChanges.added.forEach(addition => {
                if (addition.dateStr === dateStr) {
                    const correspondingEdit = appData.pendingTaskChanges.edited.find(
                        edit => edit.taskId === addition.id
                    );
                    
                    dailyPlan.tasks.push({
                        id: addition.id,
                        title: addition.title,
                        description: addition.description,
                        completed: correspondingEdit ? correspondingEdit.completed : addition.completed
                    });
                }
            });
            
            try {
                const response = await api.createOrUpdateDay(dailyPlan);
                const savedDay = response.data;
                
                if (response.message && response.message.includes('deleted due to empty content')) {
                    delete appData.dailyPlans[dateStr];
                } else {
                    appData.dailyPlans[dateStr] = savedDay;
                }
                
                appData.pendingTaskChanges.added = [];
                appData.pendingTaskChanges.edited = [];
                appData.pendingTaskChanges.deleted = [];
                
                const date = utils.parseDate(dateStr);
                if (date) {
                    dataCache.clearMonthCache(date.getFullYear(), date.getMonth());
                }
                
                calendar.render();
                stats.update();
            } catch (error) {
                const handled = window.ErrorHandler ? 
                    window.ErrorHandler.handle(error, '保存日计划') : 
                    { message: error.message || '未知错误' };
                alert(handled.message || '保存失败');
            }
            
        });
        
        // 添加编辑事件
        taskItem.querySelector('.edit-task').addEventListener('click', () => {
            taskInputModal.open(task.id, task);
        });
        
        // 添加删除事件
        taskItem.querySelector('.delete-task').addEventListener('click', () => {
            const dateStr = utils.formatDate(appData.selectedDate);
            
            // 首先检查是否在待处理添加列表中（如果是新添加的任务）
            const addedIndex = appData.pendingTaskChanges.added.findIndex(
                addition => addition.id === task.id && addition.dateStr === dateStr
            );
            
            if (addedIndex !== -1) {
                // 如果是新添加的任务，直接从添加列表中移除
                appData.pendingTaskChanges.added.splice(addedIndex, 1);
            } else {
                // 如果是已存在的任务，添加到待处理删除列表
                const deleteChange = {
                    taskId: task.id,
                    dateStr: dateStr
                };
                
                // 检查是否已经在待处理删除列表中
                const existingIndex = appData.pendingTaskChanges.deleted.findIndex(
                    change => change.taskId === task.id
                );
                
                if (existingIndex === -1) {
                    // 添加新的待处理删除
                    appData.pendingTaskChanges.deleted.push(deleteChange);
                }
            }
            
            // 更新界面显示
            taskInputModal.updateUIWithPendingChanges();
        });
        
        return taskItem;
    },
    
    // 保存日计划
    save() {
        const dateStr = utils.formatDate(appData.selectedDate);
        const summary = elements.dailySummary.value;
        
        // 获取当前任务列表
        const dailyPlan = appData.dailyPlans[dateStr] || { date: dateStr, summary: '', tasks: [] };
        dailyPlan.date = dateStr;
        dailyPlan.summary = summary;
        
        // 应用待处理的更改
        // 1. 应用删除
        dailyPlan.tasks = dailyPlan.tasks.filter(task => {
            return !appData.pendingTaskChanges.deleted.some(deleted => deleted.taskId === task.id);
        });
        
        // 2. 应用编辑
        appData.pendingTaskChanges.edited.forEach(edit => {
            if (edit.dateStr === dateStr) {
                const taskIndex = dailyPlan.tasks.findIndex(t => t.id === edit.taskId);
                if (taskIndex !== -1) {
                    dailyPlan.tasks[taskIndex] = {
                        ...dailyPlan.tasks[taskIndex],
                        title: edit.title,
                        description: edit.description,
                        completed: edit.completed !== undefined ? edit.completed : dailyPlan.tasks[taskIndex].completed
                    };
                }
            }
        });
        
        // 3. 应用添加，同时检查是否有对应的编辑
        appData.pendingTaskChanges.added.forEach(addition => {
            if (addition.dateStr === dateStr) {
                // 检查是否有对应的编辑更改
                const correspondingEdit = appData.pendingTaskChanges.edited.find(
                    edit => edit.taskId === addition.id
                );
                
                dailyPlan.tasks.push({
                    id: addition.id,
                    title: addition.title,
                    description: addition.description,
                    completed: correspondingEdit ? correspondingEdit.completed : addition.completed
                });
            }
        });
        
        // 使用API保存
        api.createOrUpdateDay(dailyPlan)
            .then(response => {
                const savedDay = response.data;
                
                // 检查是否删除了条目
                if (response.message && response.message.includes('deleted due to empty content')) {
                    // 从应用数据中删除该日期的条目
                    delete appData.dailyPlans[dateStr];
                    // 清空表单
                    elements.dailySummary.value = '';
                    elements.tasksList.innerHTML = '';
                } else {
                    // 更新应用数据
                    appData.dailyPlans[dateStr] = savedDay;
                }
                
                // 清空待处理的更改
                appData.pendingTaskChanges.added = [];
                appData.pendingTaskChanges.edited = [];
                appData.pendingTaskChanges.deleted = [];
                
                // 清除相关月份的缓存，因为数据已更新
                const date = new Date(dateStr);
                dataCache.clearMonthCache(date.getFullYear(), date.getMonth());
                
                // 保存操作完成
                // 保存日计划数据
                
                // 更新界面
                calendar.render();
                stats.update();
                
                dayModal.close();
            })
            .catch(error => {
                const handled = window.ErrorHandler ? 
                    window.ErrorHandler.handle(error, '保存日计划') : 
                    { message: error.message || '未知错误' };
                alert(handled.message || '保存失败');
            });
    }
};

// 目标编辑模态框
const goalModal = {
    // 打开模态框
    open(goalId = null) {
        appData.editingGoalId = goalId;
        
        if (goalId) {
            // 编辑模式
            const goal = appData.goals.find(g => g.id === goalId);
            if (goal) {
                elements.goalModalTitle.textContent = '编辑目标';
                elements.goalName.value = goal.name;
                elements.goalDate.value = goal.date;
                elements.goalColor.value = goal.color;
                
                // 设置颜色选择器
                document.querySelectorAll('.color-option').forEach(option => {
                    option.classList.remove('selected');
                    if (option.dataset.color === goal.color) {
                        option.classList.add('selected');
                    }
                });
            }
        } else {
            // 新建模式
            elements.goalModalTitle.textContent = '新目标';
            elements.goalName.value = '';
            elements.goalDate.value = utils.formatDateTime(new Date());
            elements.goalColor.value = '#FF6B6B';
            
            // 重置颜色选择器
            document.querySelectorAll('.color-option').forEach(option => {
                option.classList.remove('selected');
                if (option.dataset.color === '#FF6B6B') {
                    option.classList.add('selected');
                }
            });
        }
        
        // 显示模态框
        elements.goalModal.classList.add('active');
    },
    
    // 关闭模态框
    close() {
        elements.goalModal.classList.remove('active');
        appData.editingGoalId = null;
    },
    
    // 保存目标
    save() {
        const title = elements.goalName.value.trim();
        const date = elements.goalDate.value;
        const color = elements.goalColor.value;
        
        if (!title || !date) {
            alert('请填写完整的目标信息');
            return;
        }
        
        const goalData = { title, date, color };
        
        if (appData.editingGoalId) {
            // 更新现有目标
            goals.update(appData.editingGoalId, goalData);
        } else {
            // 添加新目标
            goals.add(goalData);
        }
        
        goalModal.close();
    }
};

// 任务输入模态框
const taskInputModal = {
    // 当前编辑的任务ID
    editingTaskId: null,
    
    // 打开模态框
    open(taskId = null, taskData = null) {
        this.editingTaskId = taskId;
        
        if (taskId && taskData) {
            // 编辑模式
            elements.taskInputModalTitle.textContent = '编辑任务';
            elements.saveTaskBtn.textContent = '更新';
            
            // 如果任务数据包含标题和描述
            if (taskData.title && taskData.description !== undefined) {
                elements.taskTitle.value = taskData.title;
                elements.taskInput.value = taskData.description;
            } else {
                // 兼容旧格式，将整个文本作为标题
                elements.taskTitle.value = taskData.title || '';
                elements.taskInput.value = '';
            }
        } else {
            // 新建模式
            elements.taskInputModalTitle.textContent = '添加任务';
            elements.saveTaskBtn.textContent = '添加';
            elements.taskTitle.value = '';
            elements.taskInput.value = '';
        }
        
        // 显示模态框
        elements.taskInputModal.classList.add('active');
        elements.taskTitle.focus();
    },
    
    // 关闭模态框
    close() {
        elements.taskInputModal.classList.remove('active');
        this.editingTaskId = null;
    },
    
    // 保存任务
    save() {
        const title = elements.taskTitle.value.trim();
        const description = elements.taskInput.value.trim();
        
        if (!title) {
            alert('请输入任务标题');
            return;
        }
        
        const dateStr = utils.formatDate(appData.selectedDate);
        
        if (this.editingTaskId) {
            // 更新现有任务 - 添加到待处理编辑列表
            const editChange = {
                taskId: this.editingTaskId,
                dateStr: dateStr,
                title: title,
                description: description
            };
            
            // 检查是否已经在待处理编辑列表中
            const existingIndex = appData.pendingTaskChanges.edited.findIndex(
                change => change.taskId === this.editingTaskId
            );
            
            if (existingIndex !== -1) {
                // 更新现有的待处理编辑
                appData.pendingTaskChanges.edited[existingIndex] = editChange;
            } else {
                // 添加新的待处理编辑
                appData.pendingTaskChanges.edited.push(editChange);
            }
        } else {
            // 添加新任务 - 添加到待处理添加列表
            const addChange = {
                id: utils.generateId(),
                dateStr: dateStr,
                title: title,
                description: description,
                completed: false
            };
            
            appData.pendingTaskChanges.added.push(addChange);
        }
        
        // 更新界面显示（但不保存到后端）
        this.updateUIWithPendingChanges();
        
        // 关闭模态框
        taskInputModal.close();
    },
    
    // 更新界面显示待处理的更改
    updateUIWithPendingChanges() {
        const dateStr = utils.formatDate(appData.selectedDate);
        const dailyPlan = appData.dailyPlans[dateStr] || { date: dateStr, summary: '', tasks: [] };
        
        // 创建任务列表的副本
        let tasks = [...dailyPlan.tasks];
        
        // 应用待处理的删除
        tasks = tasks.filter(task => {
            return !appData.pendingTaskChanges.deleted.some(deleted => deleted.taskId === task.id);
        });
        
        // 应用待处理的编辑
        appData.pendingTaskChanges.edited.forEach(edit => {
            if (edit.dateStr === dateStr) {
                const taskIndex = tasks.findIndex(t => t.id === edit.taskId);
                if (taskIndex !== -1) {
                    tasks[taskIndex] = {
                        ...tasks[taskIndex],
                        title: edit.title,
                        description: edit.description,
                        completed: edit.completed !== undefined ? edit.completed : tasks[taskIndex].completed
                    };
                }
            }
        });
        
        // 应用待处理的添加
        appData.pendingTaskChanges.added.forEach(addition => {
            if (addition.dateStr === dateStr) {
                // 检查是否有对应的编辑更改
                const correspondingEdit = appData.pendingTaskChanges.edited.find(
                    edit => edit.taskId === addition.id
                );
                
                tasks.push({
                    id: addition.id,
                    title: addition.title,
                    description: addition.description,
                    completed: correspondingEdit ? correspondingEdit.completed : addition.completed
                });
            }
        });
        
        // 更新界面
        dayModal.renderTasks(tasks);
    }
};

// 折线图功能
const chart = {
    chartInstance: null,
    
    // 打开折线图
    open() {
        // 检查用户是否已登录
        if (!appData.isAuthenticated) {
            alert('请先登录后再查看折线图');
            return;
        }
        
        // 折线图现在只显示任务完成情况，不依赖目标
        chart.render();
        elements.heatmapModal.classList.add('active');
    },
    
    // 关闭折线图
    close() {
        elements.heatmapModal.classList.remove('active');
    },
    
    // 渲染折线图
    render() {
        // 获取选中的参数
        const chartType = elements.chartType.value;
        const period = elements.chartPeriod.value;
        
        // 准备数据
        const { labels, datasets } = chart.prepareData(period);
        
        // 销毁旧图表
        if (chart.chartInstance) {
            chart.chartInstance.destroy();
        }
        
        // 创建新图表
        const ctx = elements.chartCanvas.getContext('2d');
        chart.chartInstance = new Chart(ctx, {
            type: chartType,
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: '完成率 (%)'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: chart.getPeriodLabel(period)
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.dataset.label}: ${context.parsed.y}%`;
                            }
                        }
                    }
                }
            }
        });
        
        // 更新统计数据
        chart.updateSummary(datasets);
    },
    
    // 准备图表数据
    prepareData(period) {
        const now = new Date();
        let startDate, endDate, labels;
        
        // 根据时间范围确定日期范围
        switch (period) {
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                labels = Array.from({ length: endDate.getDate() }, (_, i) => i + 1);
                break;
            case 'quarter':
                const quarter = Math.floor(now.getMonth() / 3);
                startDate = new Date(now.getFullYear(), quarter * 3, 1);
                endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0);
                labels = [];
                const quarterDays = utils.getDateRange(startDate, endDate);
                quarterDays.forEach(d => {
                    labels.push(d.getDate());
                });
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31);
                labels = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
                break;
        }
        
        // 计算所有任务的整体完成情况，不与目标关联
        const data = chart.calculateOverallTaskData(startDate, endDate, period);
        
        // 创建单一数据集
        const datasets = [{
            label: '任务完成率',
            data: data,
            borderColor: '#3498db',
            backgroundColor: 'rgba(52, 152, 219, 0.1)',
            fill: false,
            tension: 0.3
        }];
        
        return { labels, datasets };
    },
    
    // 计算所有任务的整体完成情况
    calculateOverallTaskData(startDate, endDate, period) {
        const data = [];
        
        if (period === 'year') {
            // 按月计算
            for (let month = 0; month < 12; month++) {
                const monthStart = new Date(startDate.getFullYear(), month, 1);
                const monthEnd = new Date(startDate.getFullYear(), month, utils.getDaysInMonth(startDate.getFullYear(), month));
                data.push(chart.calculateOverallCompletionRateForPeriod(monthStart, monthEnd));
            }
        } else {
            // 按天计算（使用不可变方式）
            const days = utils.getDateRange(startDate, endDate);
            days.forEach(d => {
                const dateStr = utils.formatDate(d);
                const dayData = chart.calculateOverallCompletionRateForDay(dateStr);
                data.push(dayData);
            });
        }
        
        return data;
    },
    
    // 计算特定日期的整体完成率
    calculateOverallCompletionRateForDay(dateStr) {
        if (!appData.dailyPlans[dateStr] || !appData.dailyPlans[dateStr].tasks) {
            return 0;
        }
        
        const tasks = appData.dailyPlans[dateStr].tasks;
        if (tasks.length === 0) {
            return 0;
        }
        
        return utils.calculateCompletionRate(tasks);
    },
    
    // 计算特定时间段的整体完成率
    calculateOverallCompletionRateForPeriod(startDate, endDate) {
        let totalTasks = 0;
        let completedTasks = 0;
        
        const days = utils.getDateRange(startDate, endDate);
        days.forEach(d => {
            const dateStr = utils.formatDate(d);
            if (appData.dailyPlans[dateStr] && appData.dailyPlans[dateStr].tasks) {
                const tasks = appData.dailyPlans[dateStr].tasks;
                totalTasks += tasks.length;
                completedTasks += tasks.filter(task => task.completed).length;
            }
        });
        
        return totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    },
    
    // 更新统计数据
    updateSummary(datasets) {
        if (datasets.length === 0) {
            elements.avgCompletion.textContent = '0%';
            elements.maxCompletion.textContent = '0%';
            elements.minCompletion.textContent = '0%';
            return;
        }
        
        // 合并所有数据集
        const allData = datasets.flatMap(dataset => dataset.data);
        const validData = allData.filter(value => value > 0);
        
        if (validData.length === 0) {
            elements.avgCompletion.textContent = '0%';
            elements.maxCompletion.textContent = '0%';
            elements.minCompletion.textContent = '0%';
            return;
        }
        
        const avg = Math.round(validData.reduce((sum, value) => sum + value, 0) / validData.length);
        const max = Math.max(...validData);
        const min = Math.min(...validData);
        
        elements.avgCompletion.textContent = `${avg}%`;
        elements.maxCompletion.textContent = `${max}%`;
        elements.minCompletion.textContent = `${min}%`;
    },
    
    // 获取时间范围标签
    getPeriodLabel(period) {
        switch (period) {
            case 'month': return '日期';
            case 'quarter': return '日期';
            case 'year': return '月份';
            default: return '';
        }
    },
    
    // 十六进制颜色转RGBA
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },
    
    // 更新目标选项
    updateGoalOptions() {
        elements.chartGoal.innerHTML = '<option value="all">所有目标</option>';
        
        appData.goals.forEach(goal => {
            const option = document.createElement('option');
            option.value = goal.id;
            option.textContent = goal.title;
            elements.chartGoal.appendChild(option);
        });
    }
};

// 用户设置功能
const userSettings = {
    // 打开设置模态框
    open() {
        // 重新加载用户设置，确保获取最新的设置
        this.load();
        
        // 加载当前设置到表单
        elements.themeSelect.value = appData.settings.theme;
        elements.showWeekends.checked = appData.settings.showWeekends;
        elements.startWeekMonday.checked = appData.settings.startWeekMonday;
        elements.enableNotifications.checked = appData.settings.enableNotifications;
        elements.notificationTime.value = appData.settings.notificationTime;
        
        // 显示模态框 - 只添加active类，不直接设置display
        elements.userSettingsModal.classList.add('active');
        // 用户设置模态框已打开
    },
    
    // 关闭设置模态框
    close() {
        // 用户设置关闭函数被调用
        // 关闭前模态框类名:
        
        // 只移除active类，让CSS控制显示
        if (elements.userSettingsModal) {
            elements.userSettingsModal.classList.remove('active');
        }
        
        // 备用方法：直接通过ID获取并关闭
        const modal = document.getElementById('user-settings-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    },
    
    // 保存设置
    save() {
        // 从表单获取设置
        const newSettings = {
            theme: elements.themeSelect.value,
            showWeekends: elements.showWeekends.checked,
            startWeekMonday: elements.startWeekMonday.checked,
            enableNotifications: elements.enableNotifications.checked,
            notificationTime: elements.notificationTime.value
        };
        
        // 更新应用数据
        appData.settings = { ...appData.settings, ...newSettings };
        
        // 应用主题
        this.applyTheme(appData.settings.theme);
        
        // 保存设置到本地存储，与用户ID关联
        if (appData.user && appData.user.id) {
            const settingsKey = `userSettings_${appData.user.id}`;
            localStorage.setItem(settingsKey, JSON.stringify(appData.settings));
            // 设置已保存到 localStorage，键名:
        } else {
            // 如果用户未登录，使用默认键名
            localStorage.setItem('userSettings', JSON.stringify(appData.settings));
            // 设置已保存到 localStorage，使用默认键名
        }
        
        // 重新渲染日历以应用设置
        calendar.render();
        
        // 显示保存成功的视觉反馈并延迟关闭模态框
        this.showSaveFeedbackAndClose();
    },
    
    // 显示保存成功的反馈并关闭模态框
    showSaveFeedbackAndClose() {
        const saveBtn = elements.saveSettingsBtn;
        const originalText = saveBtn.textContent;
        const originalClasses = saveBtn.className;
        
        // 更改按钮文本和样式
        saveBtn.textContent = '已保存 ✓';
        saveBtn.className = 'btn btn-success';
        saveBtn.disabled = true;
        
        // 800ms后恢复按钮状态并关闭模态框
        setTimeout(() => {
            // 恢复按钮状态
            saveBtn.textContent = originalText;
            saveBtn.className = originalClasses;
            saveBtn.disabled = false;
            
            // 关闭模态框
            // 尝试关闭用户设置模态框
            
            // 只移除active类，让CSS控制显示
            if (elements.userSettingsModal) {
                elements.userSettingsModal.classList.remove('active');
            }
            
            // 备用方法：直接通过ID获取并关闭
            const modal = document.getElementById('user-settings-modal');
            if (modal) {
                modal.classList.remove('active');
            }
        }, 800);
    },
    
    // 应用主题
    applyTheme(theme) {
        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            appContainer.classList.remove('theme-blue', 'theme-green');
            
            if (theme !== 'default') {
                appContainer.classList.add(`theme-${theme}`);
            }
        }
    },
    
    // 加载设置
    load() {
        // 根据用户ID加载对应的设置
        let settingsKey = 'userSettings'; // 默认键名
        
        if (appData.user && appData.user.id) {
            settingsKey = `userSettings_${appData.user.id}`;
        }
        
        const savedSettings = localStorage.getItem(settingsKey);
        if (savedSettings) {
            try {
                const parsedSettings = JSON.parse(savedSettings);
                // 更新应用数据
                appData.settings = { ...appData.settings, ...parsedSettings };
                // 应用主题
                this.applyTheme(appData.settings.theme);
                // 用户设置已加载，键名:
            } catch (error) {
                // 用户设置加载失败，使用默认设置
                // 加载用户设置失败: error
            }
        } else {
            // 没有找到保存的用户设置，键名:
        }
    }
};

// 统计功能
const stats = {
    // 更新统计数据
    update() {
        const { currentMonth, currentYear } = appData;
        
        // 计算当月第一天和最后一天
        const firstDay = new Date(currentYear, currentMonth, 1);
        const lastDay = new Date(currentYear, currentMonth + 1, 0);
        
        let totalTasks = 0;
        let completedTasks = 0;
        
        // 遍历当月所有日期
        for (let day = 1; day <= lastDay.getDate(); day++) {
            const date = new Date(currentYear, currentMonth, day);
            const dateStr = utils.formatDate(date);
            
            if (appData.dailyPlans[dateStr] && appData.dailyPlans[dateStr].tasks) {
                const tasks = appData.dailyPlans[dateStr].tasks;
                totalTasks += tasks.length;
                completedTasks += tasks.filter(task => task.completed).length;
            }
        }
        
        // 更新统计显示
        elements.totalTasks.textContent = totalTasks;
        elements.completedTasks.textContent = completedTasks;
        
        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        elements.completionRate.textContent = `${completionRate}%`;
        
        // 更新连续天数
        const streak = utils.calculateStreak();
        elements.currentStreak.textContent = streak;
    }
};

// 倒计时更新
let countdownTimer = null;
const countdown = {
    // 启动倒计时更新
    startTimer() {
        if (countdownTimer) return;
        
        countdownTimer = setInterval(() => {
            // 只更新倒计时文本，不重新渲染整个目标列表
            this.updateCountdownText();
        }, 1000);
    },
    
    // 更新倒计时文本，不重新渲染整个列表
    updateCountdownText() {
        const goalCards = document.querySelectorAll('.goal-card');
        goalCards.forEach(card => {
            const goalId = card.dataset.goalId;
            const goal = appData.goals.find(g => g.id.toString() === goalId);
            
            if (goal) {
                const countdownResult = utils.calculateCountdown(goal.date);
                const countdownElement = card.querySelector('.goal-countdown');
                if (countdownElement) {
                    countdownElement.className = `goal-countdown ${countdownResult.expired ? 'expired' : ''}`;
                    countdownElement.textContent = countdownResult.expired ? '已过期' : '剩余: ' + countdownResult.text;
                }
            }
        });
    },
    
    // 暂停倒计时更新
    pauseTimer() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    },
    
    // 恢复倒计时更新
    resumeTimer() {
        if (!countdownTimer && appData.goals.length > 0) {
            countdownTimer = setInterval(() => {
                this.updateCountdownText();
            }, 1000);
        }
    },
    
    // 停止倒计时更新
    stopTimer() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    }
};

    // 检查认证状态
function checkAuthStatus() {
    const token = localStorage.getItem('token');
    if (token) {
        // 验证token有效性
        api.getMe()
            .then(response => {
                const user = response.data;
                appData.user = user;
                appData.isAuthenticated = true;
                
                // 加载用户特定的设置
                userSettings.load();
                
                // 显示用户名
                if (user && user.username) {
                    const userWelcome = document.getElementById('user-welcome');
                    const usernameDisplay = document.getElementById('username-display');
                    
                    if (userWelcome && usernameDisplay) {
                        usernameDisplay.textContent = user.username;
                        userWelcome.style.display = 'flex';
                    }
                }
                
                showApp();
            })
            .catch(error => {
                localStorage.removeItem('token');
                showAuth();
            });
    } else {
        showAuth();
    }
}

// 显示认证界面
function showAuth() {
    elements.authContainer.style.display = 'flex';
    elements.appContainer.style.display = 'none';
    
    // 加载默认设置
    userSettings.load();
}

// 显示应用界面
function showApp() {
    elements.authContainer.style.display = 'none';
    elements.appContainer.style.display = 'flex';
    
    // 恢复当前月份状态
    appData.restoreCurrentMonth();
    
    // 显示用户名
    if (appData.user && appData.user.username) {
        const userWelcome = document.getElementById('user-welcome');
        const usernameDisplay = document.getElementById('username-display');
        
        if (userWelcome && usernameDisplay) {
            usernameDisplay.textContent = appData.user.username;
            userWelcome.style.display = 'flex';
        }
    }
    
    // 重新加载用户设置
    userSettings.load();
    
    // 检查是否有队列操作正在处理
    const hasQueueOperations = reorderQueue.operations.length > 0 || reorderQueue.isProcessing;
    
    // 加载数据
    loadData().then(() => {
        // 如果有队列操作，等待队列处理完成
        if (hasQueueOperations) {
            // 添加监听器，等待队列处理完成
            const queueListener = (event, data) => {
                if (event === 'processingCompleted' || event === 'queueEmpty') {
                    // 移除监听器
                    reorderQueue.removeListener(queueListener);
                    
                    // 队列处理完成后，重新加载数据以确保最新状态
                    loadData().then(() => {
                        // 渲染界面
                        calendar.render();
                        goals.forceRender();
                        
                        // 启动倒计时更新
                        if (appData.goals.length > 0) {
                            countdown.startTimer();
                        }
                    });
                }
            };
            
            // 添加监听器
            reorderQueue.addListener(queueListener);
        } else {
            // 没有队列操作，直接渲染界面
            calendar.render();
            goals.forceRender();
            
            // 启动倒计时更新
            if (appData.goals.length > 0) {
                countdown.startTimer();
            }
        }
    });
}

// 加载目标数据
function loadGoals() {
    return api.getGoals()
        .then(response => {
            appData.goals = response.data || [];
        })
        .catch(error => {
            appData.goals = [];
        });
}

// 加载日计划数据
function loadDays() {
    const dateRange = utils.getSafeDateRange(appData.currentYear, appData.currentMonth);
    const startDate = dateRange.startDate;
    const endDate = dateRange.endDate;
    
    return api.getDays(startDate, endDate)
        .then(response => {
            const days = response.data || [];
            days.forEach(day => {
                appData.dailyPlans[day.date] = day;
            });
        })
        .catch(error => {
            if (window.ErrorHandler) {
                window.ErrorHandler.handle(error, '加载日计划', { silent: true });
            } else {
                console.error('加载日计划失败:', error);
            }
        });
}

// 加载数据（初始加载时使用）
function loadData() {
    return Promise.all([loadGoals(), loadDays()]);
}

// 绑定事件
function bindEvents() {
    // Binding events...
    // Login form:
    // Register form:
    
    // 认证相关事件
    elements.showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        elements.loginForm.style.display = 'none';
        elements.registerForm.style.display = 'block';
    });
    
    elements.showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        elements.registerForm.style.display = 'none';
        elements.loginForm.style.display = 'block';
    });
    
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.registerForm.addEventListener('submit', handleRegister);
    elements.logoutBtn.addEventListener('click', handleLogout);
    
    // 用户设置
    elements.userSettingsBtn.addEventListener('click', () => userSettings.open());
    elements.closeSettingsModalBtn.addEventListener('click', () => userSettings.close());
    elements.saveSettingsBtn.addEventListener('click', () => userSettings.save());
    elements.cancelSettingsBtn.addEventListener('click', () => userSettings.close());
    
    // Event listeners added
    
    // 日历导航
    elements.prevMonth.addEventListener('click', calendar.prevMonth);
    elements.nextMonth.addEventListener('click', calendar.nextMonth);
    elements.todayBtn.addEventListener('click', calendar.goToCurrentMonth);
    
    // 目标管理
    elements.addGoalBtn.addEventListener('click', () => goalModal.open());
    
    // 日格编辑模态框
    elements.closeModalBtn.addEventListener('click', dayModal.close);
    elements.cancelDayBtn.addEventListener('click', dayModal.close);
    elements.saveDayBtn.addEventListener('click', dayModal.save);
    elements.addTaskBtn.addEventListener('click', () => taskInputModal.open());
    
    // 目标编辑模态框
    elements.closeGoalModalBtn.addEventListener('click', goalModal.close);
    elements.cancelGoalBtn.addEventListener('click', goalModal.close);
    elements.saveGoalBtn.addEventListener('click', goalModal.save);
    
    // 颜色选择器
    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            elements.goalColor.value = option.dataset.color;
        });
    });
    
    // 下拉菜单事件监听
    elements.functionsMenuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        elements.functionsDropdown.classList.toggle('show');
    });
    
    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown') && !e.target.closest('.modal')) {
            elements.functionsDropdown.classList.remove('show');
        }
    });
    
    // 折线图
    elements.heatmapToggle.addEventListener('click', (e) => {
        e.preventDefault();
        chart.open();
        elements.functionsDropdown.classList.remove('show');
    });
    elements.closeHeatmapBtn.addEventListener('click', chart.close);
    
    // 备注搜索
    elements.openNotesSearchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        notesSearch.open();
        elements.functionsDropdown.classList.remove('show');
    });
    elements.closeNotesSearchBtn.addEventListener('click', () => notesSearch.close());
    elements.closeNotesSearchFooterBtn.addEventListener('click', () => notesSearch.close());
    
    // 添加实时搜索功能 - 使用防抖避免频繁请求
    let searchTimeout;
    elements.notesSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            notesSearch.search();
        }, 300); // 300毫秒的延迟
    });
    
    // 图表控件事件监听
    elements.chartType.addEventListener('change', chart.render);
    elements.chartPeriod.addEventListener('change', chart.render);
    
    // 任务输入模态框
    elements.closeTaskModalBtn.addEventListener('click', taskInputModal.close);
    elements.cancelTaskBtn.addEventListener('click', taskInputModal.close);
    elements.saveTaskBtn.addEventListener('click', () => taskInputModal.save());
    
    // 任务输入框回车事件
    elements.taskTitle.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            elements.taskInput.focus();
        }
    });
    
    elements.taskInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            taskInputModal.save();
        }
    });
    
    // 批量添加任务事件监听
    elements.openBatchAddModalBtn.addEventListener('click', (e) => {
        e.preventDefault();
        batchAddTask.open();
        elements.functionsDropdown.classList.remove('show');
    });
    elements.closeBatchAddModalBtn.addEventListener('click', () => batchAddTask.close());
    elements.batchAddCancelBtn.addEventListener('click', () => batchAddTask.close());
    elements.batchAddSaveBtn.addEventListener('click', () => batchAddTask.save());
    
    // 批量任务输入模态框事件
    elements.saveBatchTaskBtn.addEventListener('click', () => batchTaskInputModal.save());
    elements.cancelBatchTaskBtn.addEventListener('click', () => batchTaskInputModal.close());
    elements.closeBatchTaskModalBtn.addEventListener('click', () => batchTaskInputModal.close());
    
    // 标题输入框按Enter键跳转到描述输入框
    elements.batchTaskTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            elements.batchTaskInput.focus();
        }
    });
    
    // 批量添加任务表单变化事件
    elements.batchStartDate.addEventListener('change', () => batchAddTask.updatePreview());
    elements.batchEndDate.addEventListener('change', () => batchAddTask.updatePreview());
    elements.weekdaysStartDate.addEventListener('change', () => batchAddTask.updatePreview());
    elements.weekdaysEndDate.addEventListener('change', () => batchAddTask.updatePreview());
    elements.batchClearExisting.addEventListener('change', () => batchAddTask.updatePreview());
    
    // 确认对话框事件
    elements.closeConfirmBtn.addEventListener('click', () => confirmDialog.close());
    
    // 批量添加任务按钮事件
    elements.batchAddTaskBtn.addEventListener('click', () => {
        batchTaskInputModal.open();
    });
    
    // 日期选择方法切换事件
    document.querySelectorAll('input[name="date-method"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            batchAddTask.toggleDateMethod(e.target.value);
        });
    });
    
    // 工作日复选框变化事件
    document.querySelectorAll('input[name="weekday"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => batchAddTask.updatePreview());
    });
    
    // 月份选择器事件
    elements.currentMonthYear.addEventListener('click', () => {
        monthPicker.open();
    });
    
    elements.closeMonthPickerBtn.addEventListener('click', () => {
        monthPicker.close();
    });
    
    elements.monthPickerCancelBtn.addEventListener('click', () => {
        monthPicker.close();
    });
    
    elements.yearDecrement.addEventListener('click', () => {
        monthPicker.changeYear(-1);
    });
    
    elements.yearIncrement.addEventListener('click', () => {
        monthPicker.changeYear(1);
    });
    
    elements.yearInput.addEventListener('change', () => {
        monthPicker.updateYearInput();
    });
    
    elements.monthPickerTodayBtn.addEventListener('click', () => {
        monthPicker.goToCurrentMonth();
    });
}

// 认证相关处理函数
function handleLogin(e) {
    e.preventDefault();
    
    const email = elements.loginEmail.value;
    const password = elements.loginPassword.value;
    
    // Email:, Password:
    
    if (!email || !password) {
        alert('请输入邮箱和密码');
        return;
    }
    
    api.login({ email, password })
        .then(data => {
            // Login successful:
            localStorage.setItem('token', data.token);
            appData.user = data.user;
            appData.isAuthenticated = true;
            
            // 重置设置为默认值
            appData.settings = {
                theme: 'default',
                showWeekends: true,
                startWeekMonday: false,
                enableNotifications: false,
                notificationTime: '09:00'
            };
            
            // 加载用户特定的设置
            userSettings.load();
            
            // 显示欢迎消息
            alert(`欢迎回来，${data.user.username}！`);
            showApp();
        })
        .catch(error => {
            const handled = window.ErrorHandler ? 
                window.ErrorHandler.handle(error, '登录') : 
                { message: error.message || '未知错误' };
            alert(handled.message || '登录失败');
        });
}

function handleRegister(e) {
    e.preventDefault();
    
    const username = elements.registerUsername.value;
    const email = elements.registerEmail.value;
    const password = elements.registerPassword.value;
    
    if (!username || !email || !password) {
        alert('请填写所有必填字段');
        return;
    }
    
    if (password.length < 6) {
        alert('密码长度至少为6位');
        return;
    }
    
    api.register({ username, email, password })
        .then(data => {
            // Register successful:
            localStorage.setItem('token', data.token);
            appData.user = data.user;
            appData.isAuthenticated = true;
            // 显示欢迎消息
            alert(`欢迎加入，${data.user.username}！`);
            showApp();
        })
        .catch(error => {
            const handled = window.ErrorHandler ? 
                window.ErrorHandler.handle(error, '注册') : 
                { message: error.message || '未知错误' };
            alert(handled.message || '注册失败');
        });
}

function handleLogout(e) {
    e.preventDefault();
    localStorage.removeItem('token');
    appData.user = null;
    appData.isAuthenticated = false;
    
    // 重置设置为默认值
    appData.settings = {
        theme: 'default',
        showWeekends: true,
        startWeekMonday: false,
        enableNotifications: false,
        notificationTime: '09:00'
    };
    
    // 应用默认主题
    userSettings.applyTheme(appData.settings.theme);
    
    // 隐藏用户名显示区域
    const userWelcome = document.getElementById('user-welcome');
    if (userWelcome) {
        userWelcome.style.display = 'none';
    }
    
    // 确保显示登录表单，而不是注册表单
    elements.loginForm.style.display = 'block';
    elements.registerForm.style.display = 'none';
    
    showAuth();
}

// 批量任务输入模态框
const batchTaskInputModal = {
    // 当前编辑的任务ID
    editingTaskId: null,
    
    // 打开模态框
    open(taskId = null, taskData = null) {
        this.editingTaskId = taskId;
        
        if (taskId && taskData) {
            // 编辑模式
            elements.batchTaskModalTitle.textContent = '编辑任务';
            
            // 如果任务数据包含标题和描述
            if (taskData.title && taskData.description !== undefined) {
                elements.batchTaskTitle.value = taskData.title;
                elements.batchTaskInput.value = taskData.description;
            } else {
                // 兼容旧格式，将整个文本作为标题
                elements.batchTaskTitle.value = taskData.title || '';
                elements.batchTaskInput.value = '';
            }
        } else {
            // 新建模式
            elements.batchTaskModalTitle.textContent = '添加任务';
            elements.batchTaskTitle.value = '';
            elements.batchTaskInput.value = '';
        }
        
        // 显示模态框
        elements.batchTaskInputModal.classList.add('active');
        elements.batchTaskTitle.focus();
    },
    
    // 关闭模态框
    close() {
        elements.batchTaskInputModal.classList.remove('active');
        this.editingTaskId = null;
    },
    
    // 保存任务
    save() {
        const title = elements.batchTaskTitle.value.trim();
        const description = elements.batchTaskInput.value.trim();
        
        if (!title) {
            alert('请输入任务标题');
            return;
        }
        
        // 创建任务对象
        const taskData = {
            title: title,
            description: description
        };
        
        if (this.editingTaskId) {
            // 编辑模式
            const task = batchAddTask.tasks.find(t => t.id === this.editingTaskId);
            if (task) {
                task.title = taskData.title;
                task.description = taskData.description;
                batchAddTask.renderTasks();
                batchAddTask.updatePreview();
            }
        } else {
            // 新建模式
            batchAddTask.addTask(taskData);
        }
        
        this.close();
    }
};

// 批量添加任务功能
const batchAddTask = {
    selectedDates: [],
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    tasks: [],
    debounceTimer: null,
    previewLimit: 50, // 存储任务列表
    
    // 打开批量添加任务模态框
    open() {
        // 重置表单
        this.resetForm();
        
        // 设置默认日期：起始日期为今天，结束日期为月末最后一天
        const today = new Date();
        const todayStr = utils.formatDate(today);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const lastDayStr = utils.formatDate(lastDay);
        
        elements.batchStartDate.value = todayStr;
        elements.batchEndDate.value = lastDayStr;
        elements.weekdaysStartDate.value = todayStr;
        elements.weekdaysEndDate.value = lastDayStr;
        
        // 生成迷你日历
        this.renderMiniCalendar();
        
        // 显示模态框
        elements.batchAddTaskModal.classList.add('active');
    },
    
    // 关闭模态框
    close() {
        elements.batchAddTaskModal.classList.remove('active');
    },
    
    // 重置表单
    resetForm() {
        this.tasks = [];
        this.renderTasks();
        elements.batchClearExisting.checked = false;
        this.selectedDates = [];
        
        // 重置日期选择方法为范围选择
        document.querySelector('input[name="date-method"][value="range"]').checked = true;
        this.toggleDateMethod('range');
        
        // 清空预览
        elements.batchPreviewContent.innerHTML = '<p>请先选择日期和输入任务内容</p>';
    },
    
    // 渲染任务列表
    renderTasks() {
        elements.batchTasksList.innerHTML = '';
        
        if (this.tasks.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.classList.add('empty-message');
            emptyMessage.textContent = '暂无任务，点击下方按钮添加';
            elements.batchTasksList.appendChild(emptyMessage);
            return;
        }
        
        this.tasks.forEach(task => {
            const taskItem = this.createTaskItem(task);
            elements.batchTasksList.appendChild(taskItem);
        });
    },
    
    // 创建任务项
    createTaskItem(task) {
        const taskItem = document.createElement('div');
        taskItem.classList.add('task-item');
        
        // 只显示任务标题
        let taskDisplay = task.title;
        
        taskItem.innerHTML = `
            <div class="task-text">${taskDisplay}</div>
            <div class="task-actions">
                <button class="btn btn-icon btn-sm edit-batch-task" data-id="${task.id}">
                    <i class="ri-edit-line"></i>
                </button>
                <button class="btn btn-icon btn-sm delete-batch-task" data-id="${task.id}">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </div>
        `;
        
        // 编辑任务事件
        taskItem.querySelector('.edit-batch-task').addEventListener('click', () => {
            this.editTask(task.id);
        });
        
        // 删除任务事件
        taskItem.querySelector('.delete-batch-task').addEventListener('click', () => {
            this.deleteTask(task.id);
        });
        
        return taskItem;
    },
    
    // 添加任务
    addTask(taskData) {
        const task = {
            id: utils.generateId(),
            title: taskData.title,
            description: taskData.description
        };
        
        this.tasks.push(task);
        this.renderTasks();
        this.updatePreview().catch(err => {
            // 预览更新失败不影响主流程，忽略错误
        });
    },
    
    // 编辑任务
    editTask(id) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        
        // 使用自定义模态框代替prompt
        batchTaskInputModal.open(id, task);
    },
    
    // 删除任务
    deleteTask(id) {
        if (!confirm('确定要删除这个任务吗？')) return;
        
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.renderTasks();
        this.updatePreview().catch(err => {
            // 预览更新失败不影响主流程，忽略错误
        });
    },
    toggleDateMethod(method) {
        // 隐藏所有日期选择容器
        document.querySelectorAll('.date-range-inputs').forEach(el => {
            if (!el.closest('.weekdays-selection')) {
                el.style.display = 'none';
            }
        });
        document.querySelector('.specific-dates-container').style.display = 'none';
        document.querySelector('.weekdays-selection').style.display = 'none';
        
        // 显示选中的日期选择容器
        switch (method) {
            case 'range':
                document.querySelector('.date-selection-method:not(.weekdays-selection) .date-range-inputs').style.display = 'flex';
                break;
            case 'specific':
                document.querySelector('.specific-dates-container').style.display = 'flex';
                break;
            case 'weekdays':
                document.querySelector('.weekdays-selection').style.display = 'block';
                document.querySelector('.weekdays-selection .date-range-inputs').style.display = 'flex';
                break;
        }
        
        this.updatePreview().catch(err => {
            // 预览更新失败不影响主流程，忽略错误
        });
    },
    
    // 渲染迷你日历
    renderMiniCalendar() {
        let firstDay = new Date(this.currentYear, this.currentMonth, 1).getDay();
        const daysInMonth = utils.getDaysInMonth(this.currentYear, this.currentMonth);
        const daysInPrevMonth = this.currentMonth === 0 ? 
            utils.getDaysInMonth(this.currentYear - 1, 11) : 
            utils.getDaysInMonth(this.currentYear, this.currentMonth - 1);
        
        // 计算上个月和下个月的年份和月份
        const prevMonthYear = this.currentMonth === 0 ? this.currentYear - 1 : this.currentYear;
        const prevMonth = this.currentMonth === 0 ? 11 : this.currentMonth - 1;
        const nextMonthYear = this.currentMonth === 11 ? this.currentYear + 1 : this.currentYear;
        const nextMonth = this.currentMonth === 11 ? 0 : this.currentMonth + 1;
        
        // 如果设置为周一作为一周的开始，则调整 firstDay
        if (appData.settings.startWeekMonday) {
            firstDay = (firstDay === 0) ? 6 : firstDay - 1;
        }
        
        let html = '';
        
        // 上一个月按钮
        html += `<div class="mini-calendar-nav">
            <button id="prev-month-mini" class="btn btn-sm"><i class="ri-arrow-left-s-line"></i></button>
            <span id="mini-calendar-title">${utils.getMonthName(this.currentMonth)} ${this.currentYear}</span>
            <button id="next-month-mini" class="btn btn-sm"><i class="ri-arrow-right-s-line"></i></button>
        </div>`;
        
        // 星期标题（根据设置调整）
        let weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        if (appData.settings.startWeekMonday) {
            weekDays = ['一', '二', '三', '四', '五', '六', '日'];
        }
        html += '<div class="mini-calendar-grid">';
        weekDays.forEach(day => {
            html += `<div class="mini-calendar-weekday">${day}</div>`;
        });
        
        // 上个月的日期
        for (let i = firstDay - 1; i >= 0; i--) {
            const day = daysInPrevMonth - i;
            const dateStr = `${prevMonthYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            html += `<div class="mini-calendar-day other-month" data-date="${dateStr}">${day}</div>`;
        }
        
        // 当前月的日期
        for (let day = 1; day <= daysInMonth; day++) {
            const date = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = this.isToday(this.currentYear, this.currentMonth, day);
            const isSelected = this.selectedDates.includes(date);
            
            html += `<div class="mini-calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${date}">${day}</div>`;
        }
        
        // 下个月的日期
        const totalCells = firstDay + daysInMonth;
        const nextMonthDays = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let day = 1; day <= nextMonthDays; day++) {
            const dateStr = `${nextMonthYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            html += `<div class="mini-calendar-day other-month" data-date="${dateStr}">${day}</div>`;
        }
        
        html += '</div>';
        elements.miniCalendar.innerHTML = html;
        
        // 添加事件监听器
        document.getElementById('prev-month-mini').addEventListener('click', () => {
            this.currentMonth--;
            if (this.currentMonth < 0) {
                this.currentMonth = 11;
                this.currentYear--;
            }
            this.renderMiniCalendar();
        });
        
        document.getElementById('next-month-mini').addEventListener('click', () => {
            this.currentMonth++;
            if (this.currentMonth > 11) {
                this.currentMonth = 0;
                this.currentYear++;
            }
            this.renderMiniCalendar();
        });
        
        // 添加迷你日历标题点击事件
        document.getElementById('mini-calendar-title').addEventListener('click', () => {
            // 设置月份选择器的当前年月
            monthPicker.selectedYear = this.currentYear;
            monthPicker.selectedMonth = this.currentMonth;
            monthPicker.open('mini-calendar'); // 传递来源参数
        });
        
        // 添加日期点击事件
        elements.miniCalendar.querySelectorAll('.mini-calendar-day:not(.other-month)').forEach(dayEl => {
            dayEl.addEventListener('click', () => {
                const date = dayEl.dataset.date;
                this.toggleDateSelection(date);
            });
        });
    },
    
    // 检查是否为今天
    isToday(year, month, day) {
        const today = new Date();
        return year === today.getFullYear() && 
               month === today.getMonth() && 
               day === today.getDate();
    },
    
    // 切换日期选择
    toggleDateSelection(date) {
        const index = this.selectedDates.indexOf(date);
        if (index > -1) {
            this.selectedDates.splice(index, 1);
        } else {
            this.selectedDates.push(date);
        }
        
        // 更新UI
        this.renderMiniCalendar();
        this.updateSelectedDatesList();
        this.updatePreview().catch(err => {
            // 预览更新失败不影响主流程，忽略错误
        });
    },
    
    // 更新已选择日期列表
    updateSelectedDatesList() {
        if (this.selectedDates.length === 0) {
            elements.selectedDatesList.innerHTML = '<p>尚未选择日期</p>';
            return;
        }
        
        let html = '';
        this.selectedDates.sort().forEach(date => {
            html += `<div class="selected-date-chip">
                ${date}
                <span class="remove-date" data-date="${date}">×</span>
            </div>`;
        });
        
        elements.selectedDatesList.innerHTML = html;
        
        // 添加移除日期事件
        elements.selectedDatesList.querySelectorAll('.remove-date').forEach(btn => {
            btn.addEventListener('click', () => {
                const date = btn.dataset.date;
                this.toggleDateSelection(date);
            });
        });
    },
    
    // 获取选中的日期列表
    getSelectedDates() {
        const method = document.querySelector('input[name="date-method"]:checked').value;
        let dates = [];
        
        switch (method) {
            case 'range':
                const startDateStr = elements.batchStartDate.value;
                const endDateStr = elements.batchEndDate.value;
                
                if (!startDateStr || !endDateStr) {
                    return dates;
                }
                
                const startDate = utils.parseDate(startDateStr);
                const endDate = utils.parseDate(endDateStr);
                
                if (startDate && endDate && startDate <= endDate) {
                    const currentDate = new Date(startDate);
                    while (currentDate <= endDate) {
                        dates.push(utils.formatDate(currentDate));
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
                break;
                
            case 'specific':
                dates = [...this.selectedDates];
                break;
                
            case 'weekdays':
                const weekdaysStartStr = elements.weekdaysStartDate.value;
                const weekdaysEndStr = elements.weekdaysEndDate.value;
                
                if (!weekdaysStartStr || !weekdaysEndStr) {
                    return dates;
                }
                
                const weekdaysStart = utils.parseDate(weekdaysStartStr);
                const weekdaysEnd = utils.parseDate(weekdaysEndStr);
                const checkedWeekdays = Array.from(document.querySelectorAll('input[name="weekday"]:checked'))
                    .map(cb => parseInt(cb.value));
                
                if (weekdaysStart && weekdaysEnd && weekdaysStart <= weekdaysEnd) {
                    const currentDate = new Date(weekdaysStart);
                    while (currentDate <= weekdaysEnd) {
                        if (checkedWeekdays.includes(currentDate.getDay())) {
                            dates.push(utils.formatDate(currentDate));
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
                break;
        }
        
        return dates;
    },
    
    // 更新预览（带防抖）
    updatePreview() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        return new Promise((resolve) => {
            this.debounceTimer = setTimeout(() => {
                this._doUpdatePreview().then(resolve).catch(resolve);
            }, 300);
        });
    },
    
    // 实际执行预览更新
    async _doUpdatePreview() {
        const dates = this.getSelectedDates();
        const clearExisting = elements.batchClearExisting.checked;
        
        if (this.tasks.length === 0 && !clearExisting) {
            elements.batchPreviewContent.innerHTML = '<p>请先选择日期和添加任务内容，或选择清除现有任务</p>';
            return;
        }
        
        if (dates.length === 0) {
            elements.batchPreviewContent.innerHTML = '<p>请先选择日期</p>';
            return;
        }
        
        let html = `<p>将对 <strong>${dates.length}</strong> 个日期进行以下操作：</p>`;
        
        if (clearExisting) {
            html += '<div class="preview-operation"><i class="ri-delete-bin-line"></i> 清除这些日期的现有任务</div>';
        }
        if (this.tasks.length > 0) {
            html += `<div class="preview-operation"><i class="ri-add-line"></i> 添加 <strong>${this.tasks.length}</strong> 个新任务</div>`;
        }
        
        const previewDates = dates.slice(0, 3);
        html += '<div class="preview-date-group">';
        html += '<h5>预览日期:</h5>';
        html += '<ul class="preview-task-list">';
        previewDates.forEach(date => {
            html += `<li>${date}</li>`;
        });
        if (dates.length > 3) {
            html += `<li>... 还有 ${dates.length - 3} 个日期</li>`;
        }
        html += '</ul></div>';
        
        if (clearExisting) {
            html += '<div class="preview-date-group">';
            html += '<h5><i class="ri-delete-bin-line"></i> 将被清除的任务:</h5>';
            
            if (dates.length > 0) {
                if (dates.length > this.previewLimit) {
                    html += `<p class="preview-note">日期数量较多（${dates.length}个），仅预览前${this.previewLimit}个日期的任务</p>`;
                }
                
                const datesToCheck = dates.slice(0, this.previewLimit);
                
                try {
                    html += '<div class="preview-loading">加载中...</div>';
                    elements.batchPreviewContent.innerHTML = html;
                    
                    const allTasks = [];
                    const allDatesWithTasks = [];
                    
                    const startDate = datesToCheck[0];
                    const endDate = datesToCheck[datesToCheck.length - 1];
                    
                    let existingDays = [];
                    try {
                        const response = await api.getDays(startDate, endDate);
                        existingDays = response.data || [];
                    } catch (error) {
                        console.error('获取现有数据失败:', error);
                    }
                    
                    const existingDaysMap = new Map();
                    existingDays.forEach(day => {
                        existingDaysMap.set(day.date, day);
                    });
                    
                    datesToCheck.forEach(date => {
                        const dayData = existingDaysMap.get(date);
                        if (dayData && dayData.tasks && dayData.tasks.length > 0) {
                            allDatesWithTasks.push(date);
                            dayData.tasks.forEach(task => {
                                allTasks.push({
                                    date: date,
                                    title: task.title
                                });
                            });
                        }
                    });
                    
                    html = `<p>将对 <strong>${dates.length}</strong> 个日期进行以下操作：</p>`;
                    
                    if (clearExisting) {
                        html += '<div class="preview-operation"><i class="ri-delete-bin-line"></i> 清除这些日期的现有任务</div>';
                    }
                    if (this.tasks.length > 0) {
                        html += `<div class="preview-operation"><i class="ri-add-line"></i> 添加 <strong>${this.tasks.length}</strong> 个新任务</div>`;
                    }
                    
                    html += '<div class="preview-date-group">';
                    html += '<h5>预览日期:</h5>';
                    html += '<ul class="preview-task-list">';
                    previewDates.forEach(date => {
                        html += `<li>${date}</li>`;
                    });
                    if (dates.length > 3) {
                        html += `<li>... 还有 ${dates.length - 3} 个日期</li>`;
                    }
                    html += '</ul></div>';
                    
                    if (clearExisting) {
                        html += '<div class="preview-date-group">';
                        html += '<h5><i class="ri-delete-bin-line"></i> 将被清除的任务:</h5>';
                        
                        if (dates.length > this.previewLimit) {
                            html += `<p class="preview-note">日期数量较多（${dates.length}个），仅预览前${this.previewLimit}个日期的任务</p>`;
                        }
                        
                        if (allTasks.length > 0) {
                            const tasksByTitle = {};
                            allTasks.forEach(task => {
                                if (!tasksByTitle[task.title]) {
                                    tasksByTitle[task.title] = [];
                                }
                                tasksByTitle[task.title].push(task.date);
                            });
                            
                            html += '<ul class="preview-task-list removed-tasks">';
                            const taskTitles = Object.keys(tasksByTitle);
                            const displayTasks = taskTitles.slice(0, 3);
                            
                            displayTasks.forEach(title => {
                                const taskDates = tasksByTitle[title];
                                const dateStr = taskDates.length > 3 
                                    ? `(共${taskDates.length}个日期)`
                                    : `(${taskDates.join(', ')})`;
                                html += `<li>${title} <span class="task-date">${dateStr}</span></li>`;
                            });
                            
                            if (taskTitles.length > 3) {
                                html += `<li>... 还有 ${taskTitles.length - 3} 个任务</li>`;
                            }
                            
                            html += '</ul>';
                            
                            const totalNote = dates.length > this.previewLimit 
                                ? `* 在前${this.previewLimit}个日期中找到 ${allDatesWithTasks.length} 个日期的 ${allTasks.length} 个任务将被清除`
                                : `* 共找到 ${allDatesWithTasks.length} 个日期的 ${allTasks.length} 个任务将被清除`;
                            html += `<p class="preview-note">${totalNote}</p>`;
                        } else {
                            html += '<p class="preview-note">所选日期暂无任务</p>';
                        }
                        html += '</div>';
                    }
                } catch (error) {
                    html = `<p>将对 <strong>${dates.length}</strong> 个日期进行以下操作：</p>`;
                    
                    if (clearExisting) {
                        html += '<div class="preview-operation"><i class="ri-delete-bin-line"></i> 清除这些日期的现有任务</div>';
                    }
                    if (this.tasks.length > 0) {
                        html += `<div class="preview-operation"><i class="ri-add-line"></i> 添加 <strong>${this.tasks.length}</strong> 个新任务</div>`;
                    }
                    
                    html += '<div class="preview-date-group">';
                    html += '<h5><i class="ri-delete-bin-line"></i> 将被清除的任务:</h5>';
                    html += '<p class="preview-note">无法获取现有任务信息</p>';
                    html += '</div>';
                }
            } else {
                html += '<p class="preview-note">请先选择日期</p>';
                html += '</div>';
            }
        }
        
        if (this.tasks.length > 0) {
            html += '<div class="preview-date-group">';
            html += '<h5><i class="ri-add-line"></i> 将添加的新任务:</h5>';
            html += '<ul class="preview-task-list new-tasks">';
            this.tasks.forEach(task => {
                html += `<li>${task.title}</li>`;
            });
            html += '</ul></div>';
        }
        
        elements.batchPreviewContent.innerHTML = html;
    },
    
    // 保存批量任务
    async save() {
        const clearExisting = elements.batchClearExisting.checked;
        const dates = this.getSelectedDates();
        
        // 验证输入
        if (this.tasks.length === 0 && !clearExisting) {
            alert('请添加至少一个任务或选择清除现有任务');
            return;
        }
        
        if (dates.length === 0) {
            alert('请选择至少一个日期');
            return;
        }
        
        // 构建确认消息
        let confirmMessage = `确定要对 ${dates.length} 个日期进行以下操作吗？\n`;
        if (clearExisting) {
            confirmMessage += `- 清除这些日期的现有任务\n`;
        }
        if (this.tasks.length > 0) {
            confirmMessage += `- 添加 ${this.tasks.length} 个新任务`;
        }
        
        // 使用自定义确认对话框
        confirmDialog.open(
            '确认批量操作',
            confirmMessage,
            () => this.executeBatchOperation(clearExisting, dates)
        );
    },
    
    // 执行批量操作
    async executeBatchOperation(clearExisting, dates) {
        const saveButton = elements.batchAddSaveBtn;
        const originalText = saveButton.textContent;
        saveButton.textContent = '保存中...';
        saveButton.disabled = true;
        
        try {
            const sortedDates = dates.sort();
            const startDate = sortedDates[0];
            const endDate = sortedDates[sortedDates.length - 1];
            
            let existingDays = [];
            try {
                const response = await api.getDays(startDate, endDate);
                existingDays = response.data || [];
            } catch (error) {
                console.error('获取现有数据失败:', error);
            }
            
            const batchRequests = [];
            const existingDaysMap = new Map();
            existingDays.forEach(day => {
                existingDaysMap.set(day.date, day);
            });
            
            for (const date of sortedDates) {
                let dailyPlan = existingDaysMap.get(date);
                
                if (!dailyPlan) {
                    dailyPlan = {
                        date: date,
                        summary: '',
                        tasks: []
                    };
                } else {
                    dailyPlan = { ...dailyPlan };
                }
                
                if (!dailyPlan.tasks || !Array.isArray(dailyPlan.tasks)) {
                    dailyPlan.tasks = [];
                }
                
                if (clearExisting) {
                    dailyPlan.tasks = [];
                }
                
                if (this.tasks.length > 0) {
                    dailyPlan.tasks = [];
                    this.tasks.forEach(task => {
                        dailyPlan.tasks.push({
                            id: utils.generateId(),
                            title: task.title,
                            description: task.description,
                            completed: false
                        });
                    });
                }
                
                const isSummaryEmpty = !dailyPlan.summary || dailyPlan.summary.trim() === '';
                const areTasksEmpty = !dailyPlan.tasks || dailyPlan.tasks.length === 0;
                
                // 对于批量清除操作，始终发送所有选中的日期
                // 对于批量添加操作，只发送有内容的日期
                if (clearExisting || !isSummaryEmpty || !areTasksEmpty) {
                    batchRequests.push(dailyPlan);
                }
            }
            
            if (batchRequests.length === 0) {
                alert('没有需要更新的数据');
                return;
            }
            
            const response = await api.batchUpdateDays(batchRequests);
            
            response.data.forEach(day => {
                appData.dailyPlans[day.date] = day;
            });
            
            if (clearExisting) {
                sortedDates.forEach(date => {
                    if (!appData.dailyPlans[date]) {
                        appData.dailyPlans[date] = {
                            date: date,
                            summary: '',
                            tasks: []
                        };
                    } else {
                        appData.dailyPlans[date].tasks = [];
                        if (!response.data.find(d => d.date === date)) {
                            appData.dailyPlans[date].summary = '';
                        }
                    }
                });
            }
            
            calendar.render();
            this.close();
            
            let successMessage = `成功对 ${dates.length} 个日期进行了操作：\n`;
            if (clearExisting) {
                successMessage += `- 清除了现有任务\n`;
            }
            if (this.tasks.length > 0) {
                successMessage += `- 添加了 ${this.tasks.length} 个新任务`;
            }
            alert(successMessage);
            
        } catch (error) {
            console.error('批量操作失败:', error);
            alert('批量添加任务失败: ' + (error.message || '未知错误'));
        } finally {
            saveButton.textContent = originalText;
            saveButton.disabled = false;
        }
    }
};

// 月份选择器功能
const monthPicker = {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    selectedYear: new Date().getFullYear(),
    selectedMonth: new Date().getMonth(),
    
    // 打开月份选择器
    open(source = 'main-calendar') {
        this.source = source;
        this.generateMonthButtons();
        elements.monthPickerModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    },
    
    // 关闭月份选择器
    close() {
        elements.monthPickerModal.style.display = 'none';
        document.body.style.overflow = '';
        
        // 根据来源更新不同的日历
        if (this.source === 'mini-calendar') {
            // 更新迷你日历
            batchAddTask.currentYear = this.selectedYear;
            batchAddTask.currentMonth = this.selectedMonth;
            batchAddTask.renderMiniCalendar();
        } else {
            // 更新主日历
            appData.currentYear = this.selectedYear;
            appData.currentMonth = this.selectedMonth;
            calendar.render();
            loadDays();
        }
    },
    
    // 生成月份按钮
    generateMonthButtons() {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        
        // 设置年份输入框的值
        elements.yearInput.value = this.selectedYear;
        
        // 清空月份网格
        elements.monthsGrid.innerHTML = '';
        
        // 生成12个月份按钮
        for (let i = 0; i < 12; i++) {
            const monthBtn = document.createElement('button');
            monthBtn.className = `month-btn ${i === currentMonth && this.selectedYear === currentYear ? 'current' : ''} ${i === this.selectedMonth ? 'selected' : ''}`;
            monthBtn.textContent = utils.getMonthName(i);
            monthBtn.dataset.month = i;
            
            monthBtn.addEventListener('click', () => {
                this.selectMonth(i);
            });
            
            elements.monthsGrid.appendChild(monthBtn);
        }
    },
    
    // 选择月份
    selectMonth(month) {
        this.selectedMonth = month;
        this.selectedYear = parseInt(elements.yearInput.value);
        
        // 更新appData的当前月份
        appData.currentYear = this.selectedYear;
        appData.currentMonth = this.selectedMonth;
        
        // 保存当前月份状态
        appData.saveCurrentMonth();
        
        this.updateCalendar();
        this.close();
    },
    
    // 更新年份输入框
    updateYearInput() {
        const year = parseInt(elements.yearInput.value);
        if (!isNaN(year) && year >= 2020 && year <= 2100) {
            this.selectedYear = year;
            
            // 更新appData的当前年份
            appData.currentYear = this.selectedYear;
            
            // 保存当前月份状态
            appData.saveCurrentMonth();
            
            this.generateMonthButtons();
        }
    },
    
    // 改变年份
    changeYear(delta) {
        const newYear = this.selectedYear + delta;
        if (newYear >= 2020 && newYear <= 2100) {
            this.selectedYear = newYear;
            
            // 更新appData的当前年份
            appData.currentYear = this.selectedYear;
            
            // 保存当前月份状态
            appData.saveCurrentMonth();
            
            this.generateMonthButtons();
        }
    },
    
    // 跳转到本月
    goToCurrentMonth() {
        const today = new Date();
        this.selectedYear = today.getFullYear();
        this.selectedMonth = today.getMonth();
        
        // 更新appData的当前月份
        appData.currentYear = this.selectedYear;
        appData.currentMonth = this.selectedMonth;
        
        // 保存当前月份状态
        appData.saveCurrentMonth();
        
        this.updateCalendar();
        this.close();
    },
    
    // 更新日历
    updateCalendar() {
        // 更新当前显示的年月
        appData.currentYear = this.selectedYear;
        appData.currentMonth = this.selectedMonth;
        calendar.currentDate = new Date(this.selectedYear, this.selectedMonth, 1);
        
        // 保存当前月份状态
        appData.saveCurrentMonth();
        
        // 重新渲染日历
        calendar.render();
        
        // 重新加载日计划数据
        loadDays();
    }
};

// 备注搜索功能
const notesSearch = {
    // 打开搜索模态框
    open() {
        elements.notesSearchModal.classList.add('active');
        elements.notesSearchInput.focus();
    },
    
    // 关闭搜索模态框
    close() {
        elements.notesSearchModal.classList.remove('active');
        elements.notesSearchInput.value = '';
        notesSearch.clearResults();
    },
    
    // 清空搜索结果
    clearResults() {
        elements.searchResultsContainer.innerHTML = '<div class="no-results">请输入关键字开始搜索</div>';
    },
    
    // 执行搜索
    async search() {
        const keyword = elements.notesSearchInput.value.trim();
        
        if (!keyword) {
            elements.searchResultsContainer.innerHTML = '<div class="no-results">请输入搜索关键字</div>';
            return;
        }
        
        // 显示加载状态
        elements.searchResultsContainer.innerHTML = '<div class="search-loading">搜索中...</div>';
        
        try {
            const response = await api.searchNotes(keyword);
            
            notesSearch.displayResults(response.data);
        } catch (error) {
            elements.searchResultsContainer.innerHTML = `<div class="no-results">搜索失败: ${error.message}</div>`;
        }
    },
    
    // 显示搜索结果
    displayResults(results) {
        if (!results || results.length === 0) {
            elements.searchResultsContainer.innerHTML = '<div class="no-results">没有找到匹配的结果</div>';
            return;
        }
        
        let html = '';
        results.forEach(result => {
            // 格式化日期显示
            const date = new Date(result.date);
            const formattedDate = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
            
            // 高亮匹配的关键字
            let content = result.content;
            const keyword = elements.notesSearchInput.value.trim();
            if (keyword) {
                // 将关键字拆分成单个词，去除空格和空字符串
                const keywords = keyword.toLowerCase()
                  .split(/\s+/)  // 按空格拆分
                  .filter(word => word.length > 0);  // 过滤掉空字符串
                
                // 为每个关键字创建高亮
                keywords.forEach(keyword => {
                    const regex = new RegExp(`(${keyword})`, 'gi');
                    content = content.replace(regex, '<span class="search-result-highlight">$1</span>');
                });
            }
            
            html += `
                <div class="search-result-item" data-date="${result.date}">
                    <div class="search-result-date">${formattedDate}</div>
                    <div class="search-result-content">${content}</div>
                </div>
            `;
        });
        
        elements.searchResultsContainer.innerHTML = html;
        
        // 添加结果项点击事件
        document.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', async () => {
                const date = item.dataset.date;
                await notesSearch.openDateInCalendar(date);
            });
        });
    },
    
    // 在日历中打开选中的日期
    async openDateInCalendar(dateStr) {
        const date = utils.parseDate(dateStr);
        if (!date) return;
        appData.selectedDate = date;
        
        // 切换到日期所在的月份
        appData.currentMonth = date.getMonth();
        appData.currentYear = date.getFullYear();
        
        // 加载该月份的数据
        await this.loadMonthData(date.getFullYear(), date.getMonth());
        
        // 重新渲染日历
        calendar.render();
        
        // 打开日期编辑模态框
        dayModal.open(dateStr);
        
        // 关闭搜索模态框
        this.close();
    },
    
    // 加载指定月份的数据
    async loadMonthData(year, month) {
        // 检查缓存中是否已有该月份数据
        if (dataCache.isMonthCached(year, month)) {
            const cachedData = dataCache.getCachedMonthData(year, month);
            
            // 将缓存数据加载到应用数据中
            cachedData.forEach(day => {
                appData.dailyPlans[day.date] = day;
            });
            return;
        }
        
        // 使用getSafeDateRange确保正确处理月末日期（包括31日）
        const dateRange = utils.getSafeDateRange(year, month);
        const startDate = dateRange.startDate;
        const endDate = dateRange.endDate;
        
        try {
            const response = await api.getDays(startDate, endDate);
            const days = response.data || [];
            
            // 将数据加载到应用数据中
            days.forEach(day => {
                appData.dailyPlans[day.date] = day;
            });
            
            // 缓存该月份数据
            dataCache.cacheMonthData(year, month, days);
        } catch (error) {
            // 加载月份数据失败: error
        }
    }
};

// 初始化应用
function init() {
    // Initializing app...
    
    // 恢复当前月份状态
    appData.restoreCurrentMonth();
    
    // 首先加载队列系统
    reorderQueue.loadQueue();
    
    // 检查认证状态
    checkAuthStatus();
    
    // 绑定事件
    bindEvents();
    
    // App initialized
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);