(function (global) {
    const TLS_ALLOWED_HOST_SUFFIX = '.tlscontact.com';
    const TLS_PAGE_STATES = {
        NO_SLOTS: 'no_slots',
        LOADING: 'loading',
        CAPTCHA: 'captcha',
        RATE_LIMITED: 'rate_limited',
        AUTH: 'auth',
        WRONG_PAGE: 'wrong_page',
        ERROR: 'error',
        POTENTIAL_SLOTS: 'potential_slots',
        AUTH_ERROR: 'auth_error',
        IDLE: 'idle',
        RUNNING: 'running',
        STOPPED: 'stopped'
    };

    const MONITOR_STATE_TRANSITIONS = {
        [TLS_PAGE_STATES.IDLE]: [TLS_PAGE_STATES.RUNNING, TLS_PAGE_STATES.STOPPED, TLS_PAGE_STATES.ERROR],
        [TLS_PAGE_STATES.STOPPED]: [TLS_PAGE_STATES.RUNNING, TLS_PAGE_STATES.IDLE, TLS_PAGE_STATES.ERROR],
        [TLS_PAGE_STATES.RUNNING]: [
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.AUTH,
            TLS_PAGE_STATES.WRONG_PAGE,
            TLS_PAGE_STATES.NO_SLOTS,
            TLS_PAGE_STATES.CAPTCHA,
            TLS_PAGE_STATES.RATE_LIMITED,
            TLS_PAGE_STATES.POTENTIAL_SLOTS,
            TLS_PAGE_STATES.AUTH_ERROR,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.LOADING]: [
            TLS_PAGE_STATES.RUNNING,
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.AUTH,
            TLS_PAGE_STATES.WRONG_PAGE,
            TLS_PAGE_STATES.NO_SLOTS,
            TLS_PAGE_STATES.CAPTCHA,
            TLS_PAGE_STATES.RATE_LIMITED,
            TLS_PAGE_STATES.POTENTIAL_SLOTS,
            TLS_PAGE_STATES.AUTH_ERROR,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.AUTH]: [
            TLS_PAGE_STATES.RUNNING,
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.AUTH,
            TLS_PAGE_STATES.AUTH_ERROR,
            TLS_PAGE_STATES.WRONG_PAGE,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.AUTH_ERROR]: [
            TLS_PAGE_STATES.RUNNING,
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.AUTH,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.NO_SLOTS]: [
            TLS_PAGE_STATES.RUNNING,
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.NO_SLOTS,
            TLS_PAGE_STATES.CAPTCHA,
            TLS_PAGE_STATES.RATE_LIMITED,
            TLS_PAGE_STATES.POTENTIAL_SLOTS,
            TLS_PAGE_STATES.WRONG_PAGE,
            TLS_PAGE_STATES.AUTH,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.POTENTIAL_SLOTS]: [
            TLS_PAGE_STATES.RUNNING,
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.NO_SLOTS,
            TLS_PAGE_STATES.CAPTCHA,
            TLS_PAGE_STATES.RATE_LIMITED,
            TLS_PAGE_STATES.WRONG_PAGE,
            TLS_PAGE_STATES.AUTH,
            TLS_PAGE_STATES.POTENTIAL_SLOTS,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.CAPTCHA]: [
            TLS_PAGE_STATES.RUNNING,
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.CAPTCHA,
            TLS_PAGE_STATES.AUTH,
            TLS_PAGE_STATES.WRONG_PAGE,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.RATE_LIMITED]: [
            TLS_PAGE_STATES.RUNNING,
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.RATE_LIMITED,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.WRONG_PAGE]: [
            TLS_PAGE_STATES.RUNNING,
            TLS_PAGE_STATES.LOADING,
            TLS_PAGE_STATES.AUTH,
            TLS_PAGE_STATES.WRONG_PAGE,
            TLS_PAGE_STATES.NO_SLOTS,
            TLS_PAGE_STATES.POTENTIAL_SLOTS,
            TLS_PAGE_STATES.STOPPED,
            TLS_PAGE_STATES.ERROR
        ],
        [TLS_PAGE_STATES.ERROR]: Object.values(TLS_PAGE_STATES)
    };

    function normalizeTlsUrlValue(rawValue) {
        if (!rawValue || !String(rawValue).trim()) {
            return { valid: false, value: '', reason: 'URL не указан' };
        }

        try {
            const parsed = new URL(String(rawValue).trim());
            const hostname = parsed.hostname.toLowerCase();
            const isTlsHost = hostname === 'tlscontact.com' || hostname.endsWith(TLS_ALLOWED_HOST_SUFFIX);

            if (parsed.protocol !== 'https:' || !isTlsHost) {
                return {
                    valid: false,
                    value: String(rawValue).trim(),
                    reason: 'Разрешены только HTTPS URL домена tlscontact.com',
                    hostname
                };
            }

            return {
                valid: true,
                value: parsed.toString(),
                hostname
            };
        } catch (error) {
            return { valid: false, value: String(rawValue).trim(), reason: 'Некорректный URL' };
        }
    }

    function normalizePageText(rawText) {
        return (rawText || '')
            .toLowerCase()
            .replace(/[\u2018\u2019\u0060]/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getMonitorStateMeta(state) {
        switch (state) {
            case TLS_PAGE_STATES.POTENTIAL_SLOTS:
                return { label: 'Возможны слоты', tone: 'ok' };
            case TLS_PAGE_STATES.NO_SLOTS:
                return { label: 'Слотов нет', tone: 'warn' };
            case TLS_PAGE_STATES.LOADING:
                return { label: 'Загрузка', tone: 'warn' };
            case TLS_PAGE_STATES.CAPTCHA:
                return { label: 'Нужна CAPTCHA', tone: 'error' };
            case TLS_PAGE_STATES.RATE_LIMITED:
                return { label: 'Rate limit', tone: 'error' };
            case TLS_PAGE_STATES.AUTH:
                return { label: 'Нужен логин', tone: 'warn' };
            case TLS_PAGE_STATES.AUTH_ERROR:
                return { label: 'Ошибка логина', tone: 'error' };
            case TLS_PAGE_STATES.WRONG_PAGE:
                return { label: 'Не та страница', tone: 'warn' };
            case TLS_PAGE_STATES.RUNNING:
                return { label: 'Мониторинг активен', tone: 'ok' };
            case TLS_PAGE_STATES.STOPPED:
                return { label: 'Мониторинг остановлен', tone: 'warn' };
            case TLS_PAGE_STATES.IDLE:
                return { label: 'Ожидание', tone: 'warn' };
            case TLS_PAGE_STATES.ERROR:
            default:
                return { label: 'Ошибка', tone: 'error' };
        }
    }

    function canTransitionMonitorState(previousState, nextState) {
        if (!nextState) {
            return false;
        }

        if (!previousState || previousState === nextState) {
            return true;
        }

        const allowedTransitions = MONITOR_STATE_TRANSITIONS[previousState] || [];
        return allowedTransitions.includes(nextState) || nextState === TLS_PAGE_STATES.ERROR;
    }

    function isTlsLandingPath(pathname) {
        return /^\/[a-z]{2}-[a-z]{2}\/?$/.test(pathname)
            || pathname === '/'
            || pathname.includes('/country/')
            || pathname.includes('/vac/')
            || pathname.includes('/travel-groups');
    }

    function analyzeTlsPageState(options) {
        const {
            pageText,
            url,
            hasBookingUi = null,
            hasCaptchaElement = false,
            hasTlsFooter = null,
            keywordList = [],
            rateLimitKeywords = [],
            captchaKeywords = [],
            errorKeywords = []
        } = options;

        const normalizedText = normalizePageText(pageText);
        const normalizedUrl = (url || '').toLowerCase();

        const matchedRateLimitKeyword = rateLimitKeywords.find((keyword) => normalizedText.includes(keyword));
        if (matchedRateLimitKeyword) {
            return {
                state: TLS_PAGE_STATES.RATE_LIMITED,
                reason: `Rate limit: ${matchedRateLimitKeyword}`,
                textLength: normalizedText.length,
                debugText: normalizedText.substring(0, 200),
                isAuthError: false,
                matchedKeyword: matchedRateLimitKeyword
            };
        }

        const hasNoSlots = keywordList.some((keyword) => normalizedText.includes(normalizePageText(keyword)));
        const hasCaptcha = captchaKeywords.some((keyword) => normalizedText.includes(keyword));
        const hasError = errorKeywords.some((keyword) => normalizedText.includes(keyword) && normalizedText.length < 1000);
        const isAppointmentPage = normalizedUrl.includes('appointment') || normalizedUrl.includes('booking') || normalizedUrl.includes('schedule');
        const isOnAuthUrl = normalizedUrl.includes('auth') || normalizedUrl.includes('login');
        const isLoginPage = normalizedText.includes('login') || normalizedText.includes('sign in') || normalizedText.includes('password');
        let pathname = '';
        try {
            pathname = new URL(url || 'https://invalid.local').pathname.toLowerCase();
        } catch (error) {
            pathname = '';
        }
        const isLandingPage = isTlsLandingPath(pathname);
        const hasDetectedFooter = typeof hasTlsFooter === 'boolean'
            ? hasTlsFooter
            : normalizedText.includes('tlscontact') && normalizedText.includes('all rights reserved');
        const isLoaded = normalizedText.length > 500 && hasDetectedFooter;
        const isAuthError = normalizedText.includes('invalid_grant') || normalizedText.includes('code not valid');
        const hasDetectedBookingUi = typeof hasBookingUi === 'boolean' ? hasBookingUi : true;

        let state = TLS_PAGE_STATES.WRONG_PAGE;
        let reason = 'Проверка завершена без совпадения';

        if (isAuthError) {
            state = TLS_PAGE_STATES.AUTH_ERROR;
            reason = 'Auth Error: invalid_grant';
        } else if (hasNoSlots) {
            state = TLS_PAGE_STATES.NO_SLOTS;
            reason = 'Найдена фраза "нет слотов"';
        } else if (isLandingPage && !isAppointmentPage && !isOnAuthUrl) {
            state = TLS_PAGE_STATES.WRONG_PAGE;
            reason = 'Открыт лендинг TLS вместо страницы записи';
        } else if (hasError) {
            state = TLS_PAGE_STATES.ERROR;
            reason = 'Страница с ошибкой';
        } else if (!isLoaded) {
            state = TLS_PAGE_STATES.LOADING;
            reason = 'Страница не загружена полностью';
        } else if (hasCaptcha || hasCaptchaElement) {
            state = TLS_PAGE_STATES.CAPTCHA;
            reason = 'Требуется ручная CAPTCHA';
        } else if (isOnAuthUrl || (isLoginPage && !isAppointmentPage)) {
            state = TLS_PAGE_STATES.AUTH;
            reason = 'Страница логина';
        } else if (!isAppointmentPage) {
            state = TLS_PAGE_STATES.WRONG_PAGE;
            reason = 'Не на странице appointment';
        } else if (!hasDetectedBookingUi) {
            state = TLS_PAGE_STATES.WRONG_PAGE;
            reason = 'Нет признаков интерфейса записи';
        } else {
            state = TLS_PAGE_STATES.POTENTIAL_SLOTS;
            reason = 'Страница записи изменилась';
        }

        return {
            state,
            reason,
            textLength: normalizedText.length,
            debugText: normalizedText.substring(0, 200),
            isAuthError,
            matchedKeyword: null
        };
    }

    global.TLS_ALLOWED_HOST_SUFFIX = TLS_ALLOWED_HOST_SUFFIX;
    global.TLS_PAGE_STATES = TLS_PAGE_STATES;
    global.normalizeTlsUrlValue = normalizeTlsUrlValue;
    global.normalizePageText = normalizePageText;
    global.analyzeTlsPageState = analyzeTlsPageState;
    global.getMonitorStateMeta = getMonitorStateMeta;
    global.MONITOR_STATE_TRANSITIONS = MONITOR_STATE_TRANSITIONS;
    global.canTransitionMonitorState = canTransitionMonitorState;
    global.isTlsLandingPath = isTlsLandingPath;
})(typeof self !== 'undefined' ? self : window);
