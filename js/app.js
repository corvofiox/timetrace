// 应用常量
const CONSTANTS = {
    MAX_TASK_DISPLAY: 3,
    MIN_YEAR: 1900,
    MAX_YEAR: 2100,
    SAVE_FEEDBACK_DELAY: 800
};

let countdownTimer = null;

// 确保 ErrorHandler 可用（备用机制）
if (typeof window !== 'undefined' && !window.ErrorHandler) {
    window.ErrorHandler = {
        handle: function(error, context, options) {
            console.error(`[${context}] 错误:`, error);
            if (!options || !options.silent) {
                const message = error && error.message ? error.message : '操作失败，请稍后重试';
                alert(message);
            }
            return { code: 'UNKNOWN', message: error && error.message, handled: true };
        },
        handleAndAlert: function(error, context, fallbackMessage) {
            const message = (error && error.message) || fallbackMessage || '操作失败，请稍后重试';
            console.error(`[${context}] 错误:`, error);
            alert(message);
        }
    };
}

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
        try {
            localStorage.setItem('currentMonth', this.currentMonth);
            localStorage.setItem('currentYear', this.currentYear);
        } catch (e) {
            console.error('保存月份到 localStorage 失败:', e);
        }
    },
    
    // 从本地存储恢复当前月份
    restoreCurrentMonth() {
        const savedMonth = localStorage.getItem('currentMonth');
        const savedYear = localStorage.getItem('currentYear');

        if (savedMonth !== null && savedYear !== null) {
            const month = parseInt(savedMonth, 10);
            const year = parseInt(savedYear, 10);

            // 验证数据有效性
            if (!isNaN(month) && month >= 0 && month <= 11 &&
                !isNaN(year) && year >= CONSTANTS.MIN_YEAR && year <= CONSTANTS.MAX_YEAR) {
                this.currentMonth = month;
                this.currentYear = year;
            }
        }
    }
};

// 中间层队列系统
const reorderQueue = {
    operations: [],
    isProcessing: false,
    listeners: [], // 监听器列表
    maxRetries: 5,
    
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
                
                // 网络/超时错误可重试：api.js 抛出的网络错误带 errorCode=NETWORK_ERROR/TIMEOUT，
                // 兼容旧格式的 message 关键词判定
                const isRetryable = error && (
                    error.errorCode === 'NETWORK_ERROR' ||
                    error.errorCode === 'TIMEOUT' ||
                    (error.message && (
                        error.message.includes('network') ||
                        error.message.includes('Network') ||
                        error.message.includes('Failed to fetch')
                    ))
                );
                
                if (isRetryable) {
                    operation._retries = (operation._retries || 0) + 1;
                    if (operation._retries <= this.maxRetries) {
                        this.operations.push(operation);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        ErrorHandler.handleAndAlert(error, '目标排序保存', `目标排序保存失败，已重试${this.maxRetries}次，请刷新页面后重试`);
                    }
                } else {
                    // 非网络错误也需提示用户
                    ErrorHandler.handleAndAlert(error, '目标排序保存', '目标排序保存失败，请刷新页面后重试');
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
        const epochAtStart = sessionEpoch;
        switch (operation.type) {
            case 'reorder-goals':
                const response = await api.updateGoalOrder(operation.data.goalIds);
                
                // 会话已切换（登出/换用户）：丢弃旧用户的写回，防止跨用户数据串写（C-8）
                if (sessionEpoch !== epochAtStart) return;
                
                // 使用后端返回的最新数据更新本地数据
                if (response && response.data) {
                    appData.goals = response.data;
                }
                goals.forceRender();
                break;
            default:
                // 未知的操作类型
        }
    },
    
    // 队列持久化 key：按用户隔离，避免用户 A 的遗留队列在用户 B 登录时执行（404 弹错）
    _getQueueKey() {
        const userId = appData.user && appData.user.id;
        return userId ? `reorderQueue-${userId}` : null;
    },
    
    // 保存队列到本地存储
    saveQueue() {
        const key = this._getQueueKey();
        if (!key) return; // 未登录不持久化
        try {
            localStorage.setItem(key, JSON.stringify(this.operations));
        } catch (error) {
            // 保存队列到本地存储失败
        }
    },
    
    // 从本地存储加载队列
    loadQueue() {
        const key = this._getQueueKey();
        if (!key) return; // 未登录/用户未知时不加载，避免执行上一个用户的队列
        try {
            const savedQueue = localStorage.getItem(key);
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
    chartCanvas: document.getElementById('task-chart'),
    chartType: document.getElementById('chart-type'),
    
    // 下拉菜单元素
    functionsMenuBtn: document.getElementById('functions-menu-btn'),
    functionsDropdown: document.getElementById('functions-dropdown'),
    chartPeriod: document.getElementById('chart-period'),
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
    registerUsername: document.getElementById('register-username'),
    registerEmail: document.getElementById('register-email'),
    registerPassword: document.getElementById('register-password'),
    
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
// 日计划保存队列：按日期隔离并串行执行。
// - 每个日期最多保留一个排队操作，新操作替换旧操作，连点不会产生重复请求
// - 入队时捕获日期与摘要快照，执行时从最新 appData + pending 重建任务数据，
//   保证排队期间的新变更不会丢失，也不会错写其他日期
// - 保存成功后不清空 pending（重建模型天然累积所有变更且幂等），
//   pending 仅在模态框关闭（放弃编辑）时清理
const queuedDaySaves = new Map();
let daySaveQueueRunning = false;
// 当前正在执行保存的日期（从队列取出后仍在处理中，供 close() 判断）
let daySaveCurrentDate = null;
// 当前有在途保存请求的日期集合（drainDaySaveQueue 正在执行中的日期）。
// 冲刷（flushQueuedDaySaves）时跳过这些日期，避免 keepalive 全量替换请求
// 与在途保存乱序到达、旧内容晚到覆盖新冲刷导致最后一次变更丢失（C-17）
const daySaveInFlightDates = new Set();

// 会话代际：登出时递增。异步回调（排队保存/月份加载/统计）完成后检查代际，
// 不一致说明已切换用户，丢弃写回，避免旧用户数据串到新会话（C-8）
let sessionEpoch = 0;

// 捕获某日期当前待应用的 pending 条目（按对象引用快照）
function capturePendingForDate(dateStr) {
    const pending = appData.pendingTaskChanges;
    return {
        added: pending.added.filter(a => a.dateStr === dateStr),
        edited: pending.edited.filter(e => e.dateStr === dateStr),
        deleted: pending.deleted.filter(d => d.dateStr === dateStr)
    };
}

// 仅移除"本次保存真正应用过"的条目（按引用匹配）：保存执行期间新产生的
// 编辑/新增/删除不会被误删，幂等重建逻辑不受影响；已应用条目及时清理防止无界累积（C-18）
function clearPendingForDate(dateStr, captured) {
    if (!captured) return;
    const pending = appData.pendingTaskChanges;
    pending.added = pending.added.filter(a => a.dateStr !== dateStr || !captured.added.includes(a));
    pending.edited = pending.edited.filter(e => e.dateStr !== dateStr || !captured.edited.includes(e));
    pending.deleted = pending.deleted.filter(d => d.dateStr !== dateStr || !captured.deleted.includes(d));
}

function queueDaySave(dateStr, summarySnapshot, operationBuilder) {
    queuedDaySaves.set(dateStr, { summarySnapshot, operationBuilder });
    drainDaySaveQueue();
}

// R2F-5: 解析 JWT 的 exp 声明为毫秒时间戳（base64url 解码）。
// 解析失败返回 null（视为未过期，不做预判拦截）
function getTokenExpiryMs(token) {
    try {
        const payloadPart = String(token).split('.')[1];
        if (!payloadPart) return null;
        const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(base64));
        return payload && typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch (e) {
        return null;
    }
}

// 页面卸载前用 keepalive fetch 尽力冲刷排队/未保存的日计划保存（C-17）。
// 覆盖：排队中的保存（queuedDaySaves）+ 仍挂着未保存变更的日期（pending），
// 包括正在执行中的保存（其变更仍在 pending 中，可完整重建）。
function flushQueuedDaySaves() {
    try {
        const dates = new Set(queuedDaySaves.keys());
        const pending = appData.pendingTaskChanges;
        pending.added.forEach(a => dates.add(a.dateStr));
        pending.edited.forEach(e => dates.add(e.dateStr));
        pending.deleted.forEach(d => dates.add(d.dateStr));
        // C-17：跳过正在执行保存的日期（其数据已在在途请求中），避免 keepalive
        // 全量冲刷与在途单条保存乱序到达，旧内容晚到覆盖新冲刷导致最后一次变更丢失
        daySaveInFlightDates.forEach(dateStr => dates.delete(dateStr));

        if (dates.size === 0) return true;

        const token = api.getToken();
        if (!token) return true; // 未登录无需冲刷

        // R2F-5: 同步预检 keepalive 冲刷是否必然失败——fetch 结果无法在
        // beforeunload 里同步等待，只能预判：
        // a) 断网：keepalive fetch 必失败；
        // b) access token 已过期（JWT exp）：服务端必回 401。
        // 任一命中则返回 false，让浏览器弹原生未保存确认兜底，避免静默丢数据
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            console.warn('[日计划保存] 离线状态，keepalive 冲刷不可用，交由浏览器原生确认兜底');
            return false;
        }
        const tokenExpMs = getTokenExpiryMs(token);
        if (tokenExpMs !== null && Date.now() >= tokenExpMs) {
            console.warn('[日计划保存] access token 已过期，keepalive 冲刷将 401，交由浏览器原生确认兜底');
            return false;
        }

        const payload = [];
        const selectedDateStr = appData.selectedDate ? utils.formatDate(appData.selectedDate) : null;
        dates.forEach(dateStr => {
            const existing = appData.dailyPlans[dateStr];
            const dailyPlan = existing ? { ...existing } : { date: dateStr, summary: '', tasks: [] };
            dailyPlan.date = dateStr;
            const queuedItem = queuedDaySaves.get(dateStr);
            if (queuedItem && queuedItem.summarySnapshot !== undefined) {
                dailyPlan.summary = queuedItem.summarySnapshot;
            } else if (dateStr === selectedDateStr) {
                dailyPlan.summary = elements.dailySummary.value || '';
            } else {
                dailyPlan.summary = (existing && existing.summary) || '';
            }
            dailyPlan.tasks = applyPendingChanges(dailyPlan.tasks || [], dateStr);
            payload.push(dailyPlan);
        });

        if (payload.length === 0) return true;

        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        // keepalive: 页面卸载后请求仍会继续发送，且支持自定义 headers（sendBeacon 不支持）
        fetch(`${api.baseURL}/days/batch`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ days: payload }),
            keepalive: true
        }).catch(() => {});
        return true;
    } catch (error) {
        console.error('[日计划保存] 卸载前冲刷失败:', error);
        return false;
    }
}

async function drainDaySaveQueue() {
    if (daySaveQueueRunning) return;
    daySaveQueueRunning = true;
    try {
        while (queuedDaySaves.size > 0) {
            const operations = Array.from(queuedDaySaves.entries());
            queuedDaySaves.clear();
            for (const [dateStr, item] of operations) {
                daySaveCurrentDate = dateStr;
                daySaveInFlightDates.add(dateStr);
                try {
                    await item.operationBuilder(dateStr, item.summarySnapshot);
                } catch (error) {
                    console.error('[日计划保存] 队列操作失败:', error);
                } finally {
                    daySaveCurrentDate = null;
                    daySaveInFlightDates.delete(dateStr);
                }
            }
        }
    } finally {
        daySaveQueueRunning = false;
    }
}

// 将待处理的变更应用到任务列表
function applyPendingChanges(tasks, dateStr) {
    const pending = appData.pendingTaskChanges;
    tasks = tasks || [];
    
    // 1. 过滤已删除（按日期隔离，避免跨日期误删）
    tasks = tasks.filter(task => {
        return !pending.deleted.some(deleted => deleted.taskId === task.id && deleted.dateStr === dateStr);
    });
    
    // 2. 应用编辑
    pending.edited.forEach(edit => {
        if (edit.dateStr === dateStr) {
            const idx = tasks.findIndex(t => t.id === edit.taskId);
            if (idx !== -1) {
                const merged = { ...tasks[idx] };
                if (edit.title !== undefined) merged.title = edit.title;
                if (edit.description !== undefined) merged.description = edit.description;
                if (edit.completed !== undefined) merged.completed = edit.completed;
                tasks[idx] = merged;
            }
        }
    });
    
    // 3. 添加新任务（幂等去重：任务已在列表中（已保存过）则不重复添加）
    pending.added.forEach(addition => {
        if (addition.dateStr === dateStr && !tasks.some(t => t.id === addition.id)) {
            const correspondingEdit = pending.edited.find(edit => edit.taskId === addition.id);
            tasks.push({
                id: addition.id,
                title: correspondingEdit && correspondingEdit.title !== undefined ? correspondingEdit.title : addition.title,
                description: correspondingEdit && correspondingEdit.description !== undefined ? correspondingEdit.description : addition.description,
                completed: correspondingEdit ? correspondingEdit.completed : addition.completed
            });
        }
    });
    
    return tasks;
}

const utils = {
    // HTML转义函数，防止XSS攻击
    // R2F-1: 数字等非字符串值先 String() 转换再转义（数字 5 → '5'），
    // null/undefined 返回 ''；避免 goal.id（数字）被转成空串导致 data-id="" 按钮失效
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        if (typeof text !== 'string') text = String(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // 转义正则表达式特殊字符
    escapeRegex(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

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
    
    // 计算连续天数（跨月份时自动加载缺失数据，避免统计被清零）
    async calculateStreak() {
        const epochAtStart = sessionEpoch;
        let streak = 0;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        let checkDate = new Date(yesterday);
        // 已尝试加载过的月份，避免重复请求
        const loadedMonths = new Set();
        
        for (let i = 0; i < 365; i++) {
            const dateStr = utils.formatDate(checkDate);
            const monthKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}`;
            
            let dayData = appData.dailyPlans[dateStr];
            
            // 日期缺失且所在月份尚未缓存/加载：先拉取该月数据再判断
            if (!dayData && !dataCache.isMonthCached(checkDate.getFullYear(), checkDate.getMonth()) && !loadedMonths.has(monthKey)) {
                loadedMonths.add(monthKey);
                try {
                    const range = utils.getSafeDateRange(checkDate.getFullYear(), checkDate.getMonth());
                    const response = await api.getDays(range.startDate, range.endDate);
                    // 登出/换用户后停止统计并丢弃写回
                    if (sessionEpoch !== epochAtStart) return 0;
                    const days = response.data || [];
                    days.forEach(day => {
                        appData.dailyPlans[day.date] = day;
                    });
                    dataCache.cacheMonthData(checkDate.getFullYear(), checkDate.getMonth(), days);
                    dayData = appData.dailyPlans[dateStr];
                } catch (error) {
                    // 加载失败，保守停止统计
                    break;
                }
            }
            
            if (dayData && dayData.tasks && dayData.tasks.length > 0 && dayData.tasks.every(task => task.completed)) {
                streak++;
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
    // 星期标题缓存，避免每次 render 都重建 DOM
    _lastWeekdayConfig: null,

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
        
        // 预计算目标按日期的映射，避免O(days × goals)循环
        const goalsByDate = new Map();
        appData.goals.forEach(goal => {
            const goalDate = utils.parseDate(goal.date);
            if (goalDate) {
                const key = goalDate.toDateString();
                if (!goalsByDate.has(key)) goalsByDate.set(key, []);
                goalsByDate.get(key).push(goal);
            }
        });

        // 使用 DocumentFragment 批量插入，减少 DOM 重排
        const fragment = document.createDocumentFragment();

        // 添加空白格子，直到当月第一天
        for (let i = 0; i < emptyDays; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.classList.add('calendar-day', 'empty-day');
            fragment.appendChild(emptyDay);
        }

        // 添加当月日期
        for (let day = 1; day <= daysInMonth; day++) {
            // 验证日期是否有效（特别处理31日的情况）
            if (!utils.isValidDate(currentYear, currentMonth, day)) {
                console.warn(`Invalid date detected: ${currentYear}-${currentMonth + 1}-${day}, skipping`);
                continue;
            }

            const date = new Date(currentYear, currentMonth, day);
            const dayElement = calendar.createDayElement(day, date, goalsByDate);
            if (dayElement) {
                fragment.appendChild(dayElement);
            }
        }

        elements.calendarDays.appendChild(fragment);

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
        if (!weekdayHeaders) return;

        const configKey = `${appData.settings.startWeekMonday}-${appData.settings.showWeekends}`;
        if (this._lastWeekdayConfig === configKey) return;
        this._lastWeekdayConfig = configKey;

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

        const fragment = document.createDocumentFragment();
        weekdays.forEach(day => {
            const dayHeader = document.createElement('div');
            dayHeader.classList.add('weekday-header');
            dayHeader.textContent = day;
            fragment.appendChild(dayHeader);
        });
        weekdayHeaders.appendChild(fragment);
    },
    
    // 创建日期元素
    createDayElement(day, date, goalsByDate) {
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
        
        // 显示目标标记（使用预计算的goalsByDate Map，避免O(n×m)循环）
        const dayGoals = goalsByDate.get(date.toDateString());
        if (dayGoals) {
            dayGoals.forEach(goal => {
                const marker = document.createElement('div');
                marker.classList.add('goal-marker');
                marker.style.backgroundColor = goal.color;
                dayElement.appendChild(marker);
            });
        }
        
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
            const maxDisplay = CONSTANTS.MAX_TASK_DISPLAY;

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
        // 达到最早月份（1900年1月）后不再回退，避免 loadDays 被后端 400 拒绝
        if (appData.currentMonth === 0 && appData.currentYear <= CONSTANTS.MIN_YEAR) {
            return;
        }
        appData.currentMonth--;
        if (appData.currentMonth < 0) {
            appData.currentMonth = 11;
            appData.currentYear--;
        }

        // 保存当前月份状态
        appData.saveCurrentMonth();

        loadDays().then(() => {
            calendar.render();
        }).catch(error => {
            console.error('加载日计划失败:', error);
            if (window.ErrorHandler) {
                window.ErrorHandler.handle(error, '加载日计划', { silent: true });
            }
        });
    },

    // 切换到下个月
    nextMonth() {
        // 达到最晚月份（2100年12月）后不再前进
        if (appData.currentMonth === 11 && appData.currentYear >= CONSTANTS.MAX_YEAR) {
            return;
        }
        appData.currentMonth++;
        if (appData.currentMonth > 11) {
            appData.currentMonth = 0;
            appData.currentYear++;
        }

        // 保存当前月份状态
        appData.saveCurrentMonth();

        loadDays().then(() => {
            calendar.render();
        }).catch(error => {
            console.error('加载日计划失败:', error);
            if (window.ErrorHandler) {
                window.ErrorHandler.handle(error, '加载日计划', { silent: true });
            }
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
        }).catch(error => {
            console.error('加载日计划失败:', error);
            if (window.ErrorHandler) {
                window.ErrorHandler.handle(error, '加载日计划', { silent: true });
            }
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
        
        const safeName = utils.escapeHtml(goal.title);
        const safeGoalId = utils.escapeHtml(goal.id);
        const parsedDate = utils.parseDate(goal.date);
        const displayDate = parsedDate ? parsedDate : (goal.date || '');
        const safeDate = utils.escapeHtml(typeof displayDate === 'string' ? displayDate : displayDate.toLocaleString('zh-CN'));
        const safeCountdown = utils.escapeHtml(countdownResult.text);

        goalCard.innerHTML = `
            <div class="goal-header">
                <div class="goal-name">${safeName}</div>
                <div class="goal-actions">
                    <button class="btn btn-icon btn-sm edit-goal" data-id="${safeGoalId}">
                        <i class="ri-edit-line"></i>
                    </button>
                    <button class="btn btn-icon btn-sm delete-goal" data-id="${safeGoalId}">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                </div>
            </div>
            <div class="goal-date">目标日期: ${safeDate}</div>
            <div class="goal-countdown ${countdownResult.expired ? 'expired' : ''}">
                ${countdownResult.expired ? '已过期' : '剩余: ' + safeCountdown}
            </div>
        `;

        // 编辑和删除事件通过事件委托处理，不在此处绑定
        
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
        // 计算最大 order + 1：删除目标产生空洞后，直接使用 goals.length 可能与现有 order 重复
        const maxOrder = appData.goals.reduce((max, goal) => {
            const order = parseInt(goal.order, 10);
            return Number.isFinite(order) ? Math.max(max, order) : max;
        }, -1);
        const newGoalData = {
            ...goalData,
            order: maxOrder + 1
        };
        
        const epochAtStart = sessionEpoch;
        return api.createGoal(newGoalData)
            .then(response => {
                // 会话已切换（登出/换用户）：丢弃旧用户的写回，防止跨用户数据串写（C-8）
                if (sessionEpoch !== epochAtStart) return response;
                const newGoal = response.data;
                appData.goals.push(newGoal);
                
                // 清除所有缓存，因为新目标可能影响多个月份的显示
                dataCache.clearAllCache();
                
                goals.forceRender();
                
                // 启动倒计时更新
                if (!countdownTimer) {
                    countdown.startTimer();
                }
                return response;
            })
            .catch(error => {
                // 会话已切换（登出/换用户）：旧会话的失败提示不打扰新会话（与 update/remove 对称）
                if (sessionEpoch !== epochAtStart) return;
                const handled = window.ErrorHandler ? 
                    window.ErrorHandler.handle(error, '添加目标') : 
                    { message: error.message || '未知错误' };
                alert(handled.message || '添加失败');
                throw error;
            });
    },
    
    // 更新目标
    update(goalId, goalData) {
        const epochAtStart = sessionEpoch;
        return api.updateGoal(goalId, goalData)
            .then(response => {
                // 会话已切换（登出/换用户）：丢弃旧用户的写回，防止跨用户数据串写（C-8）
                if (sessionEpoch !== epochAtStart) return response;
                const updatedGoal = response.data;
                // R2F-1: goal.id 为数字、goalId 来自 dataset（字符串），String 归一化避免失配
                const index = appData.goals.findIndex(goal => String(goal.id) === String(goalId));
                if (index !== -1) {
                    appData.goals[index] = updatedGoal;
                    
                    // 清除所有缓存，因为目标更新可能影响多个月份的显示
                    dataCache.clearAllCache();
                    
                    goals.forceRender();
                }
                return response;
            })
            .catch(error => {
                // 会话已切换（登出/换用户）：旧会话的失败提示不打扰新会话
                if (sessionEpoch !== epochAtStart) return;
                const handled = window.ErrorHandler ? 
                    window.ErrorHandler.handle(error, '更新目标') : 
                    { message: error.message || '未知错误' };
                alert(handled.message || '更新失败');
                throw error;
            });
    },
    
    // 删除目标
    remove(goalId) {
        const epochAtStart = sessionEpoch;
        api.deleteGoal(goalId)
            .then(response => {
                // 会话已切换（登出/换用户）：丢弃旧会话的删除回写，防止影响新会话数据（C-8）
                if (sessionEpoch !== epochAtStart) return;
                // 确认删除成功后再从本地数组中移除
                if (response && response.success) {
                    // R2F-1: goal.id 为数字、goalId 来自 dataset（字符串），String 归一化避免删除后残留
                    appData.goals = appData.goals.filter(goal => String(goal.id) !== String(goalId));
                    
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
                // 会话已切换：旧会话的失败提示不打扰新会话
                if (sessionEpoch !== epochAtStart) return;
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
        
        // 加载该日的计划和任务（兼容 tasks/timeEntries 缺失或非数组的旧数据）
        // 拷贝后再处理，不直接修改 appData 引用，保持只读打开语义
        const rawPlan = appData.dailyPlans[dateStr] || { summary: '', tasks: [] };
        const dailyPlan = {
            ...rawPlan,
            tasks: Array.isArray(rawPlan.tasks) ? rawPlan.tasks : []
        };
        elements.dailySummary.value = dailyPlan.summary || '';
        
        // 渲染任务列表（包括待处理的更改）
        taskInputModal.updateUIWithPendingChanges();
        
        // 显示模态框
        elements.dayModal.classList.add('active');
    },
    
    // 关闭模态框
    close() {
        // R2F-4: 未保存变更按"当前日期自身"判断，而非"任一日期保存在途"整体跳过：
        // 否则日期 D 摘要编辑未保存、恰逢日期 E 保存在途时关闭 D 会静默丢失编辑。
        // pending 条目按 dateStr 归属，仅统计当前日期的条目
        const dateStr = utils.formatDate(appData.selectedDate);
        const pending = appData.pendingTaskChanges;
        const hasUnsavedChanges =
            pending.added.some(a => a.dateStr === dateStr) ||
            pending.edited.some(e => e.dateStr === dateStr) ||
            pending.deleted.some(d => d.dateStr === dateStr);
        
        // F-9（C-27 同源）：检测 summary 的未保存编辑——与最近一次已保存值
        // （若有排队中的保存则以排队快照为基准）不同即为未保存
        const queuedItem = queuedDaySaves.get(dateStr);
        let summaryBaseline;
        if (queuedItem && queuedItem.summarySnapshot !== undefined) {
            summaryBaseline = queuedItem.summarySnapshot;
        } else {
            const savedPlan = appData.dailyPlans[dateStr];
            summaryBaseline = (savedPlan && savedPlan.summary) || '';
        }
        const hasUnsavedSummary = elements.dailySummary.value !== summaryBaseline;

        // 仅当当前日期自身无排队/在途保存时才弹确认（该日期数据已被排队快照捕获）；
        // 其他日期的保存在途不再阻塞本日期的关闭确认
        const saveInFlightForThisDate = queuedDaySaves.has(dateStr) || daySaveCurrentDate === dateStr;

        // R8-minor: 在途/排队期间用户继续输入了新摘要（textarea 与快照/已存值不同）时，
        // 重入队当前值为最新快照再关闭——否则 saveInFlight 分支直接 forceClose 会静默丢弃新输入
        // （用户手动关闭与保存完成自动关闭两条路径同样适用；保存完成后 baseline 与新值一致，
        // 不会产生多余重入队；forceClose 不清 textarea，无空值覆盖风险）
        if (saveInFlightForThisDate && hasUnsavedSummary) {
            dayModal.save();
        }

        if ((hasUnsavedChanges || hasUnsavedSummary) && !saveInFlightForThisDate) {
            const unsavedParts = [];
            if (hasUnsavedChanges) unsavedParts.push('任务更改（新增/编辑/删除）');
            if (hasUnsavedSummary) unsavedParts.push('摘要编辑');
            confirmDialog.open(
                '有未保存的更改',
                `当前有未保存的${unsavedParts.join('和')}。关闭后将丢失这些更改，确定关闭吗？`,
                () => dayModal.forceClose()
            );
            return;
        }
        // R9-N1: 不能用 this.forceClose() —— close 以裸引用绑定在 X/取消按钮
        // （addEventListener('click', dayModal.close)），事件触发时 this 是按钮元素，
        // this.forceClose 不存在 → TypeError → 模态框无未保存变更时无法关闭（卡死）
        dayModal.forceClose();
    },

    // 直接关闭（不弹确认，登出/已保存时使用）
    forceClose() {
        elements.dayModal.classList.remove('active');
        
        // pending 为全局共享：只要仍有任何日期的排队/执行中的保存，
        // 就不能清空，否则该日期排队操作执行时会读到空 pending，
        // 导致其新增/勾选的变更（服务端也未保存）静默丢失。
        // 代价：A 日排队时关闭 B 日模态框，B 的未保存编辑也会保留，
        // 这是全局 pending 模型的设计限制，比丢数据安全。
        if (queuedDaySaves.size === 0 && daySaveCurrentDate === null) {
            appData.pendingTaskChanges.added = [];
            appData.pendingTaskChanges.edited = [];
            appData.pendingTaskChanges.deleted = [];
        }
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

        const safeTitle = utils.escapeHtml(task.title);
        // data-id 必须转义：task.id 可被直接写入数据库，未转义插值是存储型 XSS 向量
        const safeTaskId = utils.escapeHtml(task.id);

        taskItem.innerHTML = `
            <div class="task-checkbox ${task.completed ? 'checked' : ''}" data-id="${safeTaskId}">
                ${task.completed ? '<i class="ri-checkbox-circle-fill"></i>' : '<i class="ri-checkbox-blank-circle-line"></i>'}
            </div>
            <div class="task-text">${safeTitle}</div>
            <div class="task-actions">
                <button class="btn btn-icon btn-sm edit-task" data-id="${safeTaskId}">
                    <i class="ri-edit-line"></i>
                </button>
                <button class="btn btn-icon btn-sm delete-task" data-id="${safeTaskId}">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </div>
        `;
        
        // 任务项的事件通过事件委托在 tasksList 上统一处理
        
        return taskItem;
    },
    
    // 保存日计划
    save() {
        const dateStr = utils.formatDate(appData.selectedDate);
        const summary = elements.dailySummary.value;
        
        // 入队时捕获日期与摘要；执行时从最新 appData + pending 重建任务数据，
        // 避免排队期间切换日期错写、或新变更丢失
        queueDaySave(dateStr, summary, async (saveDateStr, summarySnapshot) => {
            const epochAtStart = sessionEpoch;
            try {
                const existing = appData.dailyPlans[saveDateStr];
                const dailyPlan = existing ? { ...existing } : { date: saveDateStr, summary: '', tasks: [] };
                dailyPlan.date = saveDateStr;
                dailyPlan.summary = summarySnapshot;
                dailyPlan.tasks = applyPendingChanges(dailyPlan.tasks || [], saveDateStr);
                // 捕获本次保存实际应用的 pending 条目（保存执行期间新产生的编辑不会被误清）
                const applied = capturePendingForDate(saveDateStr);
                
                // 使用API保存
                const response = await api.createOrUpdateDay(dailyPlan);
                
                // 登出后旧会话的写回一律丢弃，避免旧用户数据串到新会话
                if (sessionEpoch !== epochAtStart) return;
                
                // 检查是否删除了条目
                if (response && response.message && response.message.includes('已删除')) {
                    // 从应用数据中删除该日期的条目
                    delete appData.dailyPlans[saveDateStr];
                    // 仅当当前仍显示该日期时才清空表单，避免清掉其他日期的展示内容
                    if (utils.formatDate(appData.selectedDate) === saveDateStr) {
                        elements.dailySummary.value = '';
                        elements.tasksList.innerHTML = '';
                    }
                } else if (response && response.data) {
                    // 更新应用数据
                    appData.dailyPlans[saveDateStr] = response.data;
                }
                
                // 保存成功：清理本次已应用的 pending 条目，防止无界累积
                clearPendingForDate(saveDateStr, applied);
                
                // 清除相关月份的缓存，因为数据已更新
                const date = utils.parseDate(saveDateStr);
                if (date) {
                    dataCache.clearMonthCache(date.getFullYear(), date.getMonth());
                }
                
                // 更新界面
                calendar.render();
                stats.update();
                
                // 仅当保存的仍是当前展示日期时关闭模态框，
                // 避免排队期间用户已切换日期导致其编辑被意外关闭
                if (utils.formatDate(appData.selectedDate) === saveDateStr) {
                    dayModal.close();
                }
            } catch (error) {
                // R2F-6: 保存 in-flight 时登出（401→强制登出）：旧会话失败提示不打扰新会话
                if (sessionEpoch !== epochAtStart) return;
                ErrorHandler.handleAndAlert(error, '保存日计划', '保存失败');
            }
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
            // R2F-1: goal.id 为数字、goalId 来自 dataset（字符串），String 归一化避免编辑表单空载
            const goal = appData.goals.find(g => String(g.id) === String(goalId));
            if (goal) {
                elements.goalModalTitle.textContent = '编辑目标';
                elements.goalName.value = goal.title;
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
        this._saving = false;
        elements.goalModal.classList.remove('active');
        appData.editingGoalId = null;
    },
    
    // 保存目标
    save() {
        if (this._saving) return;
        this._saving = true;
        
        const title = elements.goalName.value.trim();
        const date = elements.goalDate.value;
        const color = elements.goalColor.value;
        
        if (!title || !date) {
            this._saving = false;
            alert('请填写完整的目标信息');
            return;
        }
        
        const goalData = { title, date, color };
        
        let savePromise;
        if (appData.editingGoalId) {
            // 更新现有目标
            savePromise = goals.update(appData.editingGoalId, goalData);
        } else {
            // 添加新目标
            savePromise = goals.add(goalData);
        }
        
        savePromise
            .then(() => {
                this._saving = false;
                goalModal.close();
            })
            .catch(() => {
                this._saving = false;
            });
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
        this._saving = false;
        elements.taskInputModal.classList.remove('active');
        this.editingTaskId = null;
    },
    
    // 保存任务
    save() {
        if (this._saving) return;
        this._saving = true;
        
        const title = elements.taskTitle.value.trim();
        const description = elements.taskInput.value.trim();
        
        if (!title) {
            this._saving = false;
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
                // 保留已有的 completed 等字段，只更新标题/描述，避免覆盖复选框切换的状态
                const existingChange = appData.pendingTaskChanges.edited[existingIndex];
                appData.pendingTaskChanges.edited[existingIndex] = {
                    ...existingChange,
                    title: title,
                    description: description
                };
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
        const tasks = applyPendingChanges([...(dailyPlan.tasks || [])], dateStr);
        
        // 更新界面
        dayModal.renderTasks(tasks);
    }
};

// 折线图功能
const chart = {
    chartInstance: null,
    // 渲染序号：快速切换图表类型/范围时，旧请求的渲染结果直接丢弃
    _renderSeq: 0,
    // 月份加载 Promise 缓存：并发渲染共享同一加载，避免重复拉取
    _monthLoadPromises: null,
    
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
    async render() {
        const seq = ++chart._renderSeq;
        // 获取选中的参数
        const chartType = elements.chartType.value;
        const period = elements.chartPeriod.value;
        
        // 年/季视图可能跨越未加载的月份：先拉取缺失数据，避免图表大量显示 0
        try {
            await chart.ensureRangeLoaded(period);
        } catch (error) {
            console.error('加载图表范围数据失败:', error);
        }
        
        // 等待期间用户可能已切换图表类型/范围：旧请求直接丢弃，避免覆盖新图表
        if (seq !== chart._renderSeq) return;
        
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
    
    // 确保视图范围内的所有月份数据已加载（缺失的月份逐个拉取并缓存）
    async ensureRangeLoaded(period) {
        const now = new Date();
        let startDate, endDate;
        
        switch (period) {
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'quarter':
                const quarter = Math.floor(now.getMonth() / 3);
                startDate = new Date(now.getFullYear(), quarter * 3, 1);
                endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31);
                break;
            default:
                return;
        }
        
        const missingMonths = [];
        const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        while (cursor <= endDate) {
            if (!dataCache.isMonthCached(cursor.getFullYear(), cursor.getMonth())) {
                missingMonths.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
            }
            cursor.setMonth(cursor.getMonth() + 1);
        }
        
        // 并发去重：同一月份多个渲染请求共享同一个加载 Promise，避免重复拉取
        if (!chart._monthLoadPromises) chart._monthLoadPromises = new Map();
        await Promise.all(missingMonths.map(async ({ year, month }) => {
            const key = `${year}-${month}`;
            if (chart._monthLoadPromises.has(key)) {
                return chart._monthLoadPromises.get(key);
            }
            const loadPromise = (async () => {
                const epochAtStart = sessionEpoch;
                const range = utils.getSafeDateRange(year, month);
                const response = await api.getDays(range.startDate, range.endDate);
                // 登出/换用户后丢弃旧会话的加载结果
                if (sessionEpoch !== epochAtStart) return;
                const days = response.data || [];
                days.forEach(day => {
                    appData.dailyPlans[day.date] = day;
                });
                dataCache.cacheMonthData(year, month, days);
            })().catch(error => {
                console.error(`加载月份数据失败 ${year}-${month}:`, error);
            });
            chart._monthLoadPromises.set(key, loadPromise);
            loadPromise.finally(() => {
                if (chart._monthLoadPromises) chart._monthLoadPromises.delete(key);
            });
            return loadPromise;
        }));
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
        try {
            if (appData.user && appData.user.id) {
                const settingsKey = `userSettings_${appData.user.id}`;
                localStorage.setItem(settingsKey, JSON.stringify(appData.settings));
            } else {
                // 如果用户未登录，使用默认键名
                localStorage.setItem('userSettings', JSON.stringify(appData.settings));
            }
        } catch (e) {
            console.error('保存设置到 localStorage 失败:', e);
        }
        
        // 设置变更后清除星期标题缓存，确保重新生成
        calendar._lastWeekdayConfig = null;

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

        // 延迟后恢复按钮状态并关闭模态框
        setTimeout(() => {
            // 恢复按钮状态
            saveBtn.textContent = originalText;
            saveBtn.className = originalClasses;
            saveBtn.disabled = false;
            
            userSettings.close();
        }, CONSTANTS.SAVE_FEEDBACK_DELAY);
    },
    
    // 应用主题
    applyTheme(theme) {
        if (elements.appContainer) {
            elements.appContainer.classList.remove('theme-blue', 'theme-green');
            
            if (theme !== 'default') {
                elements.appContainer.classList.add(`theme-${theme}`);
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
    // 连续天数计算序号：快速连续渲染时丢弃过期计算结果，避免旧值覆盖新值
    _streakSeq: 0,
    
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
        
        // 更新连续天数（异步：跨月时自动加载缺失数据后再统计）
        const streakSeq = ++stats._streakSeq;
        utils.calculateStreak().then(streak => {
            // 丢弃过期结果：交错返回的旧计算可能覆盖新值
            if (streakSeq !== stats._streakSeq) return;
            elements.currentStreak.textContent = streak;
        }).catch(error => {
            console.error('计算连续天数失败:', error);
        });
    }
};

// 倒计时更新
const countdown = {
    _boundHandleVisibility: null,

    // 启动倒计时更新
    startTimer() {
        if (countdownTimer) return;

        countdownTimer = setInterval(() => {
            // 只更新倒计时文本，不重新渲染整个目标列表
            this.updateCountdownText();
        }, 1000);

        // 使用 Page Visibility API 优化性能
        if (!this._boundHandleVisibility) {
            this._boundHandleVisibility = () => this.handleVisibilityChange();
        }
        document.addEventListener('visibilitychange', this._boundHandleVisibility);
    },

    // 处理页面可见性变化
    handleVisibilityChange() {
        if (document.hidden) {
            // 页面隐藏时暂停倒计时以节省资源
            this.pauseTimer();
        } else {
            // 页面显示时恢复倒计时
            if (appData.goals.length > 0) {
                this.startTimer();
            }
        }
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
        if (this._boundHandleVisibility) {
            document.removeEventListener('visibilitychange', this._boundHandleVisibility);
            // 置空引用，使后续 startTimer 能重新绑定监听
            this._boundHandleVisibility = null;
        }
    }
};

// 页面卸载时清理资源
window.addEventListener('beforeunload', (e) => {
    countdown.stopTimer();
    // C-26: 保留 reorderQueue（已持久化到 localStorage，下次打开由 loadQueue 续传），不再清空

    // C-17: 尽力用 keepalive fetch 冲刷排队中的日计划保存，避免刷新/关页时静默丢弃
    const flushed = flushQueuedDaySaves();
    const pending = appData.pendingTaskChanges;
    const hasUnsavedData =
        queuedDaySaves.size > 0 ||
        daySaveCurrentDate !== null ||
        pending.added.length > 0 ||
        pending.edited.length > 0 ||
        pending.deleted.length > 0;
    if (!flushed && hasUnsavedData) {
        // 冲刷不可用（如网络层异常）：弹原生提示告知有未保存数据
        e.preventDefault();
        e.returnValue = '';
    }
});

    // 检查认证状态
function checkAuthStatus() {
    const token = localStorage.getItem('token');
    if (token) {
        // 验证token有效性
        api.auth.getMe()
            .then(response => {
                const user = response.data;
                appData.user = user;
                appData.isAuthenticated = true;
                
                // 加载用户特定的设置
                userSettings.load();
                
                // 显示用户名
                if (user && user.username) {
                    const userWelcome = elements.userWelcome;
                    const usernameDisplay = elements.usernameDisplay;
                    
                    if (userWelcome && usernameDisplay) {
                        usernameDisplay.textContent = user.username;
                        userWelcome.style.display = 'flex';
                    }
                }
                
                showApp();
            })
            .catch(error => {
                api.removeTokens();
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

// 关闭所有已打开的模态框（登出时使用，避免 day-modal/goal-modal 等悬浮在登录页上）
function closeAllModals() {
    dayModal.forceClose();
    goalModal.close();
    chart.close();
    taskInputModal.close();
    batchTaskInputModal.close();
    batchAddTask.close();
    userSettings.close();
    notesSearch.close();
    monthPicker.close();
    confirmDialog.close();
    document.body.style.overflow = '';
}

// 显示应用界面
function showApp() {
    elements.authContainer.style.display = 'none';
    elements.appContainer.style.display = 'flex';
    
    // 恢复当前月份状态
    appData.restoreCurrentMonth();
    
    // 显示用户名
    if (appData.user && appData.user.username) {
        const userWelcome = elements.userWelcome;
        const usernameDisplay = elements.usernameDisplay;
        
        if (userWelcome && usernameDisplay) {
            usernameDisplay.textContent = appData.user.username;
            userWelcome.style.display = 'flex';
        }
    }
    
    // 重新加载用户设置
    userSettings.load();
    
    // 加载当前用户的排序队列（按用户隔离的 key），未完成的排序操作续传
    reorderQueue.loadQueue();
    
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
                        // 渲染界面（forceRender 内部已包含 calendar.render）
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
            // 没有队列操作，直接渲染界面（forceRender 内部已包含 calendar.render）
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
    const epochAtStart = sessionEpoch;
    return api.getGoals()
        .then(response => {
            // 会话已切换（登出/换用户）：丢弃旧用户的加载结果，防止残留数据串到新会话（C-8）
            if (sessionEpoch !== epochAtStart) return;
            appData.goals = response.data || [];
        })
        .catch(error => {
            // 登出后旧会话的失败回写一律丢弃，避免清掉新会话已加载的目标
            if (sessionEpoch !== epochAtStart) return;
            appData.goals = [];
        });
}

// 加载日计划数据
function loadDays() {
    const epochAtStart = sessionEpoch;
    const year = appData.currentYear;
    const month = appData.currentMonth;
    
    if (dataCache.isMonthCached(year, month)) {
        const cachedData = dataCache.getCachedMonthData(year, month);
        cachedData.forEach(day => {
            appData.dailyPlans[day.date] = day;
        });
        return Promise.resolve();
    }
    
    const dateRange = utils.getSafeDateRange(year, month);
    const startDate = dateRange.startDate;
    const endDate = dateRange.endDate;
    
    return api.getDays(startDate, endDate)
        .then(response => {
            // 会话已切换（登出/换用户）：丢弃旧用户的加载结果，防止残留数据串到新会话
            if (sessionEpoch !== epochAtStart) return;
            const days = response.data || [];
            days.forEach(day => {
                appData.dailyPlans[day.date] = day;
            });
            dataCache.cacheMonthData(year, month, days);
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

    // 使用事件委托处理目标列表的编辑和删除按钮
    elements.goalsContainer.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-goal');
        const deleteBtn = e.target.closest('.delete-goal');

        if (editBtn) {
            e.stopPropagation();
            const goalId = editBtn.dataset.id;
            goalModal.open(goalId);
            return;
        }

        if (deleteBtn) {
            e.stopPropagation();
            const goalId = deleteBtn.dataset.id;
            confirmDialog.open(
                '删除目标',
                '确定要删除这个目标吗？此操作不可撤销。',
                () => goals.remove(goalId)
            );
            return;
        }
    });

    // 使用事件委托处理任务列表的点击事件
    elements.tasksList.addEventListener('click', async (e) => {
        const checkbox = e.target.closest('.task-checkbox');
        const editBtn = e.target.closest('.edit-task');
        const deleteBtn = e.target.closest('.delete-task');

        if (checkbox) {
            const taskId = checkbox.dataset.id;
            const dateStr = utils.formatDate(appData.selectedDate);
            const taskItem = checkbox.closest('.task-item');

            // 查找任务数据（兼容 tasks 缺失的旧数据）
            const dailyPlan = appData.dailyPlans[dateStr] || { tasks: [] };
            let task = (dailyPlan.tasks || []).find(t => t.id === taskId);

            // 尚未保存的新增任务不在 dailyPlan.tasks 中：从 pending.added 兜底，
            // 避免 title/description 写成空串后覆盖新增任务原标题
            if (!task) {
                task = appData.pendingTaskChanges.added.find(
                    addition => addition.id === taskId && addition.dateStr === dateStr
                );
            }

            // 检查待处理编辑
            let currentCompleted = task ? task.completed : false;
            const existingChange = appData.pendingTaskChanges.edited.find(
                change => change.taskId === taskId && change.dateStr === dateStr
            );
            // 仅当编辑条目显式设置过 completed 时才采用（标题/描述编辑不含 completed 字段）
            if (existingChange && existingChange.completed !== undefined) {
                currentCompleted = existingChange.completed;
            }

            const newCompleted = !currentCompleted;

            const editChange = {
                taskId: taskId,
                dateStr: dateStr,
                title: task ? task.title : '',
                description: task ? task.description : '',
                completed: newCompleted
            };

            const existingIndex = appData.pendingTaskChanges.edited.findIndex(
                change => change.taskId === taskId && change.dateStr === dateStr
            );

            if (existingIndex !== -1) {
                // 整体替换前合并保留已有编辑的 title/description：
                // 否则未保存的标题/描述编辑会被复选框路径静默回滚
                const previousChange = appData.pendingTaskChanges.edited[existingIndex];
                appData.pendingTaskChanges.edited[existingIndex] = {
                    ...editChange,
                    title: previousChange.title !== undefined ? previousChange.title : editChange.title,
                    description: previousChange.description !== undefined ? previousChange.description : editChange.description
                };
            } else {
                appData.pendingTaskChanges.edited.push(editChange);
            }

            // 更新UI
            const icon = checkbox.querySelector('i');
            if (newCompleted) {
                checkbox.classList.add('checked');
                if (icon) icon.className = 'ri-checkbox-circle-fill';
                taskItem.classList.add('completed');
            } else {
                checkbox.classList.remove('checked');
                if (icon) icon.className = 'ri-checkbox-blank-circle-line';
                taskItem.classList.remove('completed');
            }

            // 入队时捕获日期与摘要，执行时从最新 appData + pending 重建任务数据：
            // 排队期间切换日期不会错写其他日期，新勾选/编辑的变更也不会丢失
            queueDaySave(dateStr, elements.dailySummary.value, async (saveDateStr, summarySnapshot) => {
                const epochAtStart = sessionEpoch;
                try {
                    const existingDailyPlan = appData.dailyPlans[saveDateStr];
                    const dailyPlanToSave = existingDailyPlan ? { ...existingDailyPlan } : { date: saveDateStr, summary: '', tasks: [] };
                    dailyPlanToSave.date = saveDateStr;
                    dailyPlanToSave.summary = summarySnapshot;

                    if (existingDailyPlan && existingDailyPlan.id) {
                        dailyPlanToSave.id = existingDailyPlan.id;
                    }

                    dailyPlanToSave.tasks = [...(dailyPlanToSave.tasks || [])];
                    dailyPlanToSave.tasks = applyPendingChanges(dailyPlanToSave.tasks, saveDateStr);
                    // 捕获本次保存实际应用的 pending 条目（保存执行期间新产生的编辑不会被误清）
                    const applied = capturePendingForDate(saveDateStr);

                    const response = await api.createOrUpdateDay(dailyPlanToSave);

                    // 登出后旧会话的写回一律丢弃，避免旧用户数据串到新会话
                    if (sessionEpoch !== epochAtStart) return;

                    if (response && response.message && response.message.includes('已删除')) {
                        delete appData.dailyPlans[saveDateStr];
                    } else if (response && response.data) {
                        appData.dailyPlans[saveDateStr] = response.data;
                    }

                    // 保存成功：清理本次已应用的 pending 条目，防止无界累积
                    clearPendingForDate(saveDateStr, applied);

                    const date = utils.parseDate(saveDateStr);
                    if (date) {
                        dataCache.clearMonthCache(date.getFullYear(), date.getMonth());
                    }

                    calendar.render();
                    stats.update();
                } catch (error) {
                    // R2F-6: 保存 in-flight 时登出（401→强制登出）：旧会话失败提示不打扰新会话
                    if (sessionEpoch !== epochAtStart) return;
                    ErrorHandler.handleAndAlert(error, '保存日计划', '保存失败');
                }
            });

            return;
        }

        if (editBtn) {
            const taskId = editBtn.dataset.id;
            const dateStr = utils.formatDate(appData.selectedDate);
            const dailyPlan = appData.dailyPlans[dateStr] || { tasks: [] };

            // 查找任务（包括待处理更改和尚未保存的新增任务）
            let task = (dailyPlan.tasks || []).find(t => t.id === taskId);
            const pendingEdit = appData.pendingTaskChanges.edited.find(
                change => change.taskId === taskId && change.dateStr === dateStr
            );
            if (pendingEdit) {
                task = { ...task, ...pendingEdit };
            }
            if (!task) {
                task = appData.pendingTaskChanges.added.find(
                    addition => addition.id === taskId && addition.dateStr === dateStr
                );
            }

            if (task) {
                taskInputModal.open(taskId, task);
            }
            return;
        }

        if (deleteBtn) {
            const taskId = deleteBtn.dataset.id;
            const dateStr = utils.formatDate(appData.selectedDate);

            // 首先检查是否在待处理添加列表中
            const addedIndex = appData.pendingTaskChanges.added.findIndex(
                addition => addition.id === taskId && addition.dateStr === dateStr
            );

            if (addedIndex !== -1) {
                appData.pendingTaskChanges.added.splice(addedIndex, 1);
            } else {
                const deleteChange = {
                    taskId: taskId,
                    dateStr: dateStr
                };

                const existingIndex = appData.pendingTaskChanges.deleted.findIndex(
                    change => change.taskId === taskId && change.dateStr === dateStr
                );

                if (existingIndex === -1) {
                    appData.pendingTaskChanges.deleted.push(deleteChange);
                }
            }

            taskInputModal.updateUIWithPendingChanges();
            return;
        }
    });

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
        // R5-5: 携带当前来源——mini-calendar 打开时点"今天"不连带主日历跳月
        monthPicker.goToCurrentMonth(monthPicker.source);
    });
}

// 认证相关处理函数
function handleLogin(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    
    const email = elements.loginEmail.value;
    const password = elements.loginPassword.value;
    
    // Email:, Password:
    
    if (!email || !password) {
        if (submitBtn) submitBtn.disabled = false;
        alert('请输入邮箱和密码');
        return;
    }
    
    api.auth.login({ email, password })
        .then(data => {
            appData.user = data.user;
            appData.isAuthenticated = true;
            
            userSettings.load();
            
            // 显示欢迎消息
            alert(`欢迎回来，${data.user.username}！`);
            showApp();
        })
        .catch(error => {
            if (submitBtn) submitBtn.disabled = false;
            ErrorHandler.handleAndAlert(error, '登录', '登录失败');
        });
}

function handleRegister(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    
    const username = elements.registerUsername.value;
    const email = elements.registerEmail.value;
    const password = elements.registerPassword.value;
    
    if (!username || !email || !password) {
        if (submitBtn) submitBtn.disabled = false;
        alert('请填写所有必填字段');
        return;
    }
    
    if (password.length < 6) {
        if (submitBtn) submitBtn.disabled = false;
        alert('密码长度至少为6位');
        return;
    }
    
    api.auth.register({ username, email, password })
        .then(data => {
            appData.user = data.user;
            appData.isAuthenticated = true;
            // 显示欢迎消息
            alert(`欢迎加入，${data.user.username}！`);
            showApp();
        })
        .catch(error => {
            if (submitBtn) submitBtn.disabled = false;
            ErrorHandler.handleAndAlert(error, '注册', '注册失败');
        });
}

// R2F-2: 主动登出与强制登出（api.js 401→refresh 失败）共用的会话清理。
// 必须递增 sessionEpoch 并清空 pending/reorderQueue/daySaveQueue，
// 否则换账号登录后旧账号 pending 编辑会渲染进新账号、reorderQueue 残留
// 操作会以新账号 token 执行（C-8 同源问题）。
function resetSessionState() {
    // 停止倒计时定时器，避免登出后继续更新界面
    countdown.stopTimer();
    
    // 关闭所有模态框，避免悬浮在登录页上
    closeAllModals();
    
    // 先清空当前用户的重排队列并持久化（此时 appData.user 仍有效，写入正确的用户 key）
    reorderQueue.operations = [];
    reorderQueue.saveQueue();
    reorderQueue.hideIndicator();
    
    // 会话代际递增：丢弃旧会话仍在飞行中的异步写回（排队保存/月份加载结果）
    sessionEpoch++;
    
    appData.user = null;
    appData.isAuthenticated = false;
    
    // 清除应用数据
    appData.goals = [];
    appData.dailyPlans = {};
    dataCache.clearAllCache();
    
    // 清空待处理变更与保存队列，防止旧会话数据串到下次登录
    appData.pendingTaskChanges.added = [];
    appData.pendingTaskChanges.edited = [];
    appData.pendingTaskChanges.deleted = [];
    queuedDaySaves.clear();
    
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
    if (elements.userWelcome) {
        elements.userWelcome.style.display = 'none';
    }
    
    // 确保显示登录表单，而不是注册表单
    elements.loginForm.style.display = 'block';
    elements.registerForm.style.display = 'none';
}

function handleLogout(e) {
    e.preventDefault();
    api.auth.logout();
    resetSessionState();
    showAuth();
}

// R2F-2: 强制登出（api.js 401→refresh 失败时 removeTokens 后派发）：
// 与 handleLogout 走同一套会话清理，避免旧账号状态串入新账号
window.addEventListener('auth:force-logout', () => {
    resetSessionState();
    showAuth();
});

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
    // R2F-3: 切块部分失败后标记重试会话。重试时按(日期,任务标题)对已成功块
    // 写入的任务去重，避免整批重跑导致重复入库；成功后/关闭模态框时复位
    _partialFailure: false,
    
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
        
        // 绑定迷你日历事件委托（一次性绑定）
        this._miniCalendarClickHandler = this.handleMiniCalendarClick.bind(this);
        elements.miniCalendar.addEventListener('click', this._miniCalendarClickHandler);
        
        // 生成迷你日历
        this.renderMiniCalendar();
        
        // 显示模态框
        elements.batchAddTaskModal.classList.add('active');
    },
    
    // 关闭模态框
    close() {
        // R2F-3①: 关闭即结束重试会话
        this._partialFailure = false;
        // 移除迷你日历事件委托
        if (this._miniCalendarClickHandler) {
            elements.miniCalendar.removeEventListener('click', this._miniCalendarClickHandler);
            this._miniCalendarClickHandler = null;
        }
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
        const safeDisplay = utils.escapeHtml(task.title);
        const safeTaskId = utils.escapeHtml(task.id);
        
        taskItem.innerHTML = `
            <div class="task-text">${safeDisplay}</div>
            <div class="task-actions">
                <button class="btn btn-icon btn-sm edit-batch-task" data-id="${safeTaskId}">
                    <i class="ri-edit-line"></i>
                </button>
                <button class="btn btn-icon btn-sm delete-batch-task" data-id="${safeTaskId}">
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
        confirmDialog.open(
            '删除任务',
            '确定要删除这个任务吗？',
            () => {
                this.tasks = this.tasks.filter(t => t.id !== id);
                this.renderTasks();
                this.updatePreview().catch(err => {
                    // 预览更新失败不影响主流程，忽略错误
                });
            }
        );
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
    },

    // 迷你日历事件委托处理器（在batchAddTask.open()中绑定到elements.miniCalendar）
    handleMiniCalendarClick(event) {
        const target = event.target;

        // 上一月按钮
        const prevBtn = target.closest('#prev-month-mini');
        if (prevBtn) {
            this.currentMonth--;
            if (this.currentMonth < 0) {
                this.currentMonth = 11;
                this.currentYear--;
            }
            this.renderMiniCalendar();
            return;
        }

        // 下一月按钮
        const nextBtn = target.closest('#next-month-mini');
        if (nextBtn) {
            this.currentMonth++;
            if (this.currentMonth > 11) {
                this.currentMonth = 0;
                this.currentYear++;
            }
            this.renderMiniCalendar();
            return;
        }

        // 迷你日历标题（月份选择器）
        const title = target.closest('#mini-calendar-title');
        if (title) {
            monthPicker.selectedYear = this.currentYear;
            monthPicker.selectedMonth = this.currentMonth;
            monthPicker.open('mini-calendar');
            return;
        }

        // 日期点击（仅当前月日期）
        const dayEl = target.closest('.mini-calendar-day:not(.other-month)');
        if (dayEl) {
            const date = dayEl.dataset.date;
            this.toggleDateSelection(date);
            return;
        }
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
            const safeDate = utils.escapeHtml(date);
            html += `<div class="selected-date-chip">
                ${safeDate}
                <span class="remove-date" data-date="${safeDate}">×</span>
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
                                const safeTitle = utils.escapeHtml(title);
                                const dateStr = taskDates.length > 3 
                                    ? `(共${taskDates.length}个日期)`
                                    : `(${taskDates.join(', ')})`;
                                html += `<li>${safeTitle} <span class="task-date">${dateStr}</span></li>`;
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
                html += `<li>${utils.escapeHtml(task.title)}</li>`;
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
        const epochAtStart = sessionEpoch;
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
                    this.tasks.forEach(task => {
                        // R2F-3①: 部分失败重试时，服务端已含上次成功块写入的同指纹任务
                        // （getDays 拉到的最新状态），按 (title, description) 指纹计数对齐，
                        // 避免重复 push 入库；R5-6: 计数补差——同指纹任务已存在 N 个、
                        // 本次要添加 M 个时只补 M-N 个，保证各日期数量一致
                        // （同名不同描述的任务指纹不同，不会被误跳过）。
                        // 仅重试会话生效，首次保存/全新操作不受影响
                        if (this._partialFailure) {
                            const fpOf = (t) => t && t.title === task.title &&
                                (t.description || '') === (task.description || '');
                            const existingCount = dailyPlan.tasks.filter(fpOf).length;
                            const toAddCount = this.tasks.filter(t => fpOf(t)).length;
                            if (existingCount >= toAddCount) {
                                return;
                            }
                            for (let k = existingCount; k < toAddCount; k++) {
                                dailyPlan.tasks.push({
                                    id: utils.generateId(),
                                    title: task.title,
                                    description: task.description,
                                    completed: false
                                });
                            }
                            return;
                        }
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
            
            // 分批发送：后端限制单次最多 100 条（MAX_BATCH_SIZE=100），超过则切块
            const MAX_BATCH_SIZE = 100;
            const allResponses = [];
            // R2F-3②: 逐块记录已成功块的日期（后端按块整体事务，块成功=块内日期全部落库），
            // 供部分失败时区分"成功但服务端未返回（清空后为空被删除）"与"真正失败的块"
            const successfulDates = [];
            try {
                for (let i = 0; i < batchRequests.length; i += MAX_BATCH_SIZE) {
                    const chunk = batchRequests.slice(i, i + MAX_BATCH_SIZE);
                    // eslint-disable-next-line no-await-in-loop
                    const response = await api.batchUpdateDays(chunk);
                    allResponses.push(...(response.data || []));
                    successfulDates.push(...chunk.map(d => d.date));
                }
            } catch (error) {
                // C-4 部分失败一致性：某块失败时此前块已写库，先合并已成功块的响应并清缓存，
                // 保证界面与服务器一致（重试不会因界面缺失而重复添加），再提示部分成功或失败原因
                this._partialFailure = true; // R2F-3①: 标记重试会话，重试时按指纹去重
                // R5-4: 纯清除（无新增任务）部分失败时后端删除行且不返回 → allResponses 恒空，
                // 成功判定须纳入 successfulDates，否则已成功清除的日期界面残留旧任务且提示误导
                const hasPartialSuccess = allResponses.length > 0 || (clearExisting && successfulDates.length > 0);
                if (hasPartialSuccess && sessionEpoch === epochAtStart) {
                    allResponses.forEach(day => {
                        appData.dailyPlans[day.date] = day;
                    });
                    // R2F-3②: clearExisting 部分失败时，已成功块的本地清空合并也要执行。
                    // 后端对"清空后为空"的日子会删除行且不返回（allResponses 缺失），
                    // 这些成功日期若不本地清空，界面会残留旧任务；失败块的日期不在
                    // successfulDates 中，保留本地旧数据等待重试
                    if (clearExisting && successfulDates.length > 0) {
                        successfulDates.forEach(date => {
                            if (!appData.dailyPlans[date]) {
                                appData.dailyPlans[date] = {
                                    date: date,
                                    summary: '',
                                    tasks: []
                                };
                            } else if (!allResponses.some(d => d.date === date)) {
                                appData.dailyPlans[date].tasks = [];
                                appData.dailyPlans[date].summary = '';
                            }
                            // 服务端已返回的日子（含清空后新增的任务）以响应为准，不覆盖
                        });
                    }
                    const affectedMonthKeys = new Set();
                    sortedDates.forEach(dateStr => {
                        const date = utils.parseDate(dateStr);
                        if (date) {
                            affectedMonthKeys.add(`${date.getFullYear()}-${date.getMonth()}`);
                        }
                    });
                    affectedMonthKeys.forEach(key => {
                        const parts = key.split('-');
                        dataCache.clearMonthCache(parseInt(parts[0], 10), parseInt(parts[1], 10));
                    });
                    calendar.render();
                    // R5-4: 成功计数用 successfulDates（成功块的日期数），
                    // allResponses 在纯清除场景恒空会低估
                    let partialMsg = `部分日期已保存成功（${successfulDates.length}/${batchRequests.length}），其余失败：${error.message || '未知错误'}。可重试剩余部分。`;
                    if (clearExisting) {
                        partialMsg += ' 已成功清除的日期已生效，失败日期保留原数据。';
                    }
                    alert(partialMsg);
                } else if (sessionEpoch !== epochAtStart) {
                    // 会话已切换：静默，不打扰新会话
                    console.error('批量操作失败（会话已切换）:', error);
                } else {
                    console.error('批量操作失败:', error);
                    alert('批量添加任务失败: ' + (error.message || '未知错误'));
                }
                // 不关闭模态框（保留已选日期与任务供重试），由 finally 恢复按钮
                return;
            }
            
            // 会话已切换（登出/换用户）：丢弃旧会话的批量写回，防止跨用户数据串写（C-8）
            if (sessionEpoch !== epochAtStart) return;
            
            allResponses.forEach(day => {
                appData.dailyPlans[day.date] = day;
            });
            // 清除涉及月份的缓存，避免切走再切回时旧缓存覆盖批量操作结果
            const affectedMonthKeys = new Set();
            sortedDates.forEach(dateStr => {
                const date = utils.parseDate(dateStr);
                if (date) {
                    affectedMonthKeys.add(`${date.getFullYear()}-${date.getMonth()}`);
                }
            });
            affectedMonthKeys.forEach(key => {
                const parts = key.split('-');
                dataCache.clearMonthCache(parseInt(parts[0], 10), parseInt(parts[1], 10));
            });
            
            if (clearExisting) {
                sortedDates.forEach(date => {
                    // 服务端已返回的日子（清空后含新任务）以响应为准，不本地覆盖
                    if (allResponses.some(d => d.date === date)) return;
                    if (!appData.dailyPlans[date]) {
                        appData.dailyPlans[date] = {
                            date: date,
                            summary: '',
                            tasks: []
                        };
                    } else {
                        appData.dailyPlans[date].tasks = [];
                        appData.dailyPlans[date].summary = '';
                    }
                });
            }
            
            calendar.render();
            // R2F-3①: 全部成功，退出重试会话（下次全新操作不做去重）
            this._partialFailure = false;
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
        // 每次打开都用当前状态初始化选中值，避免沿用上次遗留值
        if (source === 'mini-calendar') {
            this.selectedYear = batchAddTask.currentYear;
            this.selectedMonth = batchAddTask.currentMonth;
        } else {
            this.selectedYear = appData.currentYear;
            this.selectedMonth = appData.currentMonth;
        }
        this.generateMonthButtons();
        elements.monthPickerModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    },
    
    // 关闭月份选择器
    close() {
        elements.monthPickerModal.style.display = 'none';
        document.body.style.overflow = '';
        
        if (this.source === 'mini-calendar') {
            // 更新迷你日历（取消时 selected 已初始化为打开时的值，无副作用）
            batchAddTask.currentYear = this.selectedYear;
            batchAddTask.currentMonth = this.selectedMonth;
            batchAddTask.renderMiniCalendar();
        }
        // 主日历：selectMonth/goToCurrentMonth 已提交并渲染；
        // 取消时 selectedYear/Month 未改动 appData，不会把日历跳回旧年月
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
                // R2F-8: 携带来源，迷你日历选月不触发主日历跳月
                this.selectMonth(i, this.source);
            });
            
            elements.monthsGrid.appendChild(monthBtn);
        }
    },
    
    // 年份范围校验并修正显示值（与 CONSTANTS 保持一致）
    clampYear(year) {
        if (!Number.isFinite(year)) return appData.currentYear;
        return Math.min(CONSTANTS.MAX_YEAR, Math.max(CONSTANTS.MIN_YEAR, year));
    },
    
    // 选择月份
    // R2F-8: 新增 source 参数——mini-calendar 来源只更新选择器内部状态并关闭
    // （提交由 close() 写入 batchAddTask.currentYear/Month 并重渲染迷你日历），
    // 不写 appData.currentYear/Month、不触发主日历 loadDays/render，
    // 避免批量添加模态框里选月后关掉、主日历被连带跳月
    selectMonth(month, source) {
        this.selectedMonth = month;
        this.selectedYear = this.clampYear(parseInt(elements.yearInput.value, 10));
        
        if (source === 'mini-calendar') {
            this.close();
            return;
        }
        
        // 更新appData的当前月份（提交）
        appData.currentYear = this.selectedYear;
        appData.currentMonth = this.selectedMonth;
        
        // 保存当前月份状态
        appData.saveCurrentMonth();
        
        this.updateCalendar();
        this.close();
    },
    
    // 更新年份输入框
    updateYearInput() {
        const year = this.clampYear(parseInt(elements.yearInput.value, 10));
        elements.yearInput.value = year;
        this.selectedYear = year;
        
        // 仅更新选择器内状态，不提交 appData（提交发生在 selectMonth/goToCurrentMonth）
        this.generateMonthButtons();
    },
    
    // 改变年份
    changeYear(delta) {
        const newYear = this.clampYear(this.selectedYear + delta);
        this.selectedYear = newYear;
        elements.yearInput.value = newYear;
        
        // 仅更新选择器内状态，不提交 appData
        this.generateMonthButtons();
    },
    
    // 跳转到本月
    // R5-5: 与 selectMonth 对称携带来源——mini-calendar 来源只更新选择器内部状态并关闭
    // （提交由 close() 写入 batchAddTask.currentYear/Month 并重渲染迷你日历），
    // 不写 appData、不触发主日历 loadDays/render，避免批量添加模态框里点"今天"连带主日历跳月
    goToCurrentMonth(source) {
        const today = new Date();
        this.selectedYear = today.getFullYear();
        this.selectedMonth = today.getMonth();
        
        if (source === 'mini-calendar') {
            this.close();
            return;
        }
        
        // 更新appData的当前月份（提交）
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
        
        // 保存当前月份状态
        appData.saveCurrentMonth();
        
        // 先加载日计划数据，再渲染日历，避免新月份显示空白
        loadDays().then(() => {
            calendar.render();
        }).catch(error => {
            console.error('加载日计划失败:', error);
            calendar.render();
        });
    }
};

// 备注搜索功能
const notesSearch = {
    // 搜索请求序号：防抖后慢响应不得覆盖新关键词的结果
    _searchSeq: 0,
    
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
        // 使在途搜索响应失效，避免关闭后结果被写回
        notesSearch._searchSeq++;
    },
    
    // 清空搜索结果
    clearResults() {
        elements.searchResultsContainer.innerHTML = '<div class="no-results">请输入关键字开始搜索</div>';
    },
    
    // 执行搜索
    async search() {
        const seq = ++notesSearch._searchSeq;
        const keyword = elements.notesSearchInput.value.trim();
        
        if (!keyword) {
            elements.searchResultsContainer.innerHTML = '<div class="no-results">请输入搜索关键字</div>';
            return;
        }
        
        if (keyword.length < 2) {
            elements.searchResultsContainer.innerHTML = '<div class="no-results">搜索关键字至少需要2个字符</div>';
            return;
        }
        
        if (keyword.length > 100) {
            elements.searchResultsContainer.innerHTML = '<div class="no-results">搜索关键字不能超过100个字符</div>';
            return;
        }
        
        // 显示加载状态
        elements.searchResultsContainer.innerHTML = '<div class="search-loading">搜索中...</div>';
        
        try {
            const response = await api.searchNotes(keyword);
            
            // 丢弃过期响应：慢响应不得覆盖新关键词/已关闭的结果
            if (seq !== notesSearch._searchSeq) return;
            notesSearch.displayResults(response.data);
        } catch (error) {
            if (seq !== notesSearch._searchSeq) return;
            elements.searchResultsContainer.innerHTML = `<div class="no-results">搜索失败: ${utils.escapeHtml(error.message)}</div>`;
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
            const date = utils.parseDate(result.date);
            if (!date) return;
            const formattedDate = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
            
            let content = utils.escapeHtml(result.content);
            const keyword = elements.notesSearchInput.value.trim();
            if (keyword) {
                const keywords = keyword.toLowerCase()
                  .split(/\s+/)
                  .filter(word => word.length > 0);
                
                keywords.forEach(kw => {
                    const escapedKw = utils.escapeRegex(kw);
                    const regex = new RegExp(`(${escapedKw})`, 'gi');
                    content = content.replace(regex, '<span class="search-result-highlight">$1</span>');
                });
            }
            
            html += `
                <div class="search-result-item" data-date="${utils.escapeHtml(result.date)}">
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
        await loadDays();
        
        // 重新渲染日历
        calendar.render();
        
        // 打开日期编辑模态框
        dayModal.open(dateStr);
        
        // 关闭搜索模态框
        this.close();
    }
};

// 初始化应用
function init() {
    // Initializing app...
    
    // 恢复当前月份状态
    appData.restoreCurrentMonth();
    
    // 检查认证状态（登录后由 showApp 按用户加载排序队列）
    checkAuthStatus();
    
    // 绑定事件
    bindEvents();
    
    // App initialized
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);