// AI Platform v5.0 - Минималистичный интерфейс с максимальными возможностями
const CONFIG = {
    API_URL: localStorage.getItem('api_url') || 'https://ai-developer-api.onrender.com',
    WS_URL: localStorage.getItem('ws_url') || 'wss://ai-developer-api.onrender.com/ws',
    VERSION: '5.0.0'
};

// Состояние приложения
const state = {
    user: null,
    currentSection: 'chat',
    currentProject: null,
    chatHistory: [],
    projects: [],
    workflows: [],
    collections: [],
    settings: {
        theme: 'dark',
        mode: 'simple', // simple, pro, autonomous
        language: 'ru'
    },
    isGenerating: false,
    contextPanelOpen: false
};

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    initTelegram();
    loadUserData();
    setupEventListeners();
    applyTheme();
    loadInitialData();

    // Автоматическое изменение высоты textarea
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('input', autoResizeTextarea);
    }
}

function initTelegram() {
    if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        if (tg.initDataUnsafe?.user) {
            state.user = {
                id: tg.initDataUnsafe.user.id.toString(),
                username: tg.initDataUnsafe.user.username,
                first_name: tg.initDataUnsafe.user.first_name
            };
            updateProfileUI();
        }
    }
}

function loadUserData() {
    const saved = localStorage.getItem('ai_platform_user');
    if (saved) {
        state.user = JSON.parse(saved);
        updateProfileUI();
    }

    const savedSettings = localStorage.getItem('ai_platform_settings');
    if (savedSettings) {
        state.settings = { ...state.settings, ...JSON.parse(savedSettings) };
    }
}

function setupEventListeners() {
    // Глобальные горячие клавиши
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeContextPanel();
        }

        // Ctrl/Cmd + K для фокуса на чат
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('chat-input')?.focus();
        }
    });

    // Обработка Enter в чате
    document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// ==================== НАВИГАЦИЯ ====================

function showSection(sectionName) {
    // Обновляем активную кнопку в сайдбаре
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === sectionName);
    });

    // Скрываем все секции
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    // Показываем нужную секцию
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
        state.currentSection = sectionName;

        // Специфичная логика для каждой секции
        switch(sectionName) {
            case 'projects':
                loadProjects();
                break;
            case 'media':
                loadMediaHistory();
                break;
            case 'data':
                loadCollections();
                break;
            case 'automation':
                loadWorkflows();
                break;
            case 'profile':
                updateProfileUI();
                break;
        }
    }
}

// ==================== ЧАТ (ГЛАВНЫЙ ЭКРАН) ====================

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (!message || state.isGenerating) return;

    // Добавляем сообщение пользователя
    addMessage(message, 'user');
    input.value = '';
    autoResizeTextarea();

    // Показываем индикатор загрузки
    showGlobalProgress('AI думает...');
    state.isGenerating = true;

    try {
        // Определяем намерение пользователя
        const intent = detectIntent(message);

        // Отправляем на API
        const response = await fetch(`${CONFIG.API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                intent,
                user_id: state.user?.id,
                context: getChatContext()
            })
        });

        const data = await response.json();

        hideGlobalProgress();

        if (data.success) {
            addMessage(data.response, 'assistant', data.actions);

            // Если есть предложенные действия, показываем их
            if (data.suggestions) {
                showSuggestions(data.suggestions);
            }

            // Если нужно переключиться в другой режим
            if (data.redirect) {
                handleRedirect(data.redirect);
            }
        } else {
            addMessage('Извините, произошла ошибка. Попробуйте ещё раз.', 'system');
        }
    } catch (error) {
        hideGlobalProgress();
        addMessage('Ошибка соединения. Проверьте интернет.', 'system');
        console.error('Chat error:', error);
    } finally {
        state.isGenerating = false;
    }
}

function detectIntent(message) {
    const lower = message.toLowerCase();

    if (lower.includes('создай') && (lower.includes('проект') || lower.includes('сайт') || lower.includes('приложение'))) {
        return 'create_project';
    }
    if (lower.includes('изображение') || lower.includes('картинку') || lower.includes('фото')) {
        return 'generate_image';
    }
    if (lower.includes('код') || lower.includes('функцию') || lower.includes('скрипт')) {
        return 'write_code';
    }
    if (lower.includes('анализ') || lower.includes('проверь')) {
        return 'analyze';
    }
    if (lower.includes('бизнес-план') || lower.includes('бизнес план')) {
        return 'business_plan';
    }

    return 'general';
}

function addMessage(text, role, actions = []) {
    const container = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    let content = `<div class="message-content">${formatMessage(text)}</div>`;

    // Добавляем кнопки действий если есть
    if (actions && actions.length > 0) {
        content += '<div class="message-actions">';
        actions.forEach(action => {
            content += `<button class="msg-action-btn" onclick="handleAction('${action.type}', '${action.data}')">${action.label}</button>`;
        });
        content += '</div>';
    }

    messageDiv.innerHTML = content;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;

    // Сохраняем в историю
    state.chatHistory.push({ text, role, timestamp: Date.now() });
}

function formatMessage(text) {
    // Простое форматирование markdown
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

function quickAction(actionType) {
    const prompts = {
        'create_project': 'Создай проект: ',
        'analyze_file': 'Проанализируй этот файл: ',
        'generate_image': 'Сгенерируй изображение: ',
        'write_code': 'Напиши код для: ',
        'business_plan': 'Создай бизнес-план для: ',
        'autonomous': 'Запусти автономный режим для задачи: '
    };

    const input = document.getElementById('chat-input');
    input.value = prompts[actionType] || '';
    input.focus();
    autoResizeTextarea();
}

function handleAction(type, data) {
    switch(type) {
        case 'accept_architecture':
            showToast('Архитектура принята');
            break;
        case 'modify':
            document.getElementById('chat-input').value = 'Измени: ';
            document.getElementById('chat-input').focus();
            break;
        case 'simplify':
            sendMessageDirect('Упрости эту архитектуру');
            break;
        case 'deepen':
            sendMessageDirect('Добавь больше деталей');
            break;
        case 'create_project':
            createProjectFromChat(data);
            break;
    }
}

async function sendMessageDirect(text) {
    document.getElementById('chat-input').value = text;
    await sendMessage();
}

// ==================== ПРОЕКТЫ ====================

async function loadProjects() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/projects?user_id=${state.user?.id}`);
        const data = await response.json();

        state.projects = data.projects || [];
        renderProjects();
    } catch (error) {
        console.error('Failed to load projects:', error);
    }
}

function renderProjects() {
    const container = document.getElementById('projects-list');

    if (state.projects.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📁</span>
                <p>Нет проектов</p>
                <button class="btn-primary" onclick="createNewProject()">Создать первый проект</button>
            </div>
        `;
        return;
    }

    container.innerHTML = state.projects.map(project => `
        <div class="project-card" onclick="openProject('${project.id}')">
            <div class="project-icon">${getProjectIcon(project.type)}</div>
            <div class="project-info">
                <h4>${project.name}</h4>
                <p>${project.type} • ${project.stack || 'не указан'}</p>
                <span class="project-status ${project.status}">${project.status}</span>
            </div>
            <div class="project-meta">
                <small>${formatDate(project.updated_at)}</small>
            </div>
        </div>
    `).join('');
}

function getProjectIcon(type) {
    const icons = {
        'api': '🔌',
        'bot': '🤖',
        'frontend': '🎨',
        'fullstack': '⚡',
        'saas': '☁️',
        'mobile': '📱',
        'default': '📦'
    };
    return icons[type] || icons.default;
}

function openProject(projectId) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    state.currentProject = project;
    document.getElementById('project-detail-title').textContent = project.name;

    // Переключаемся на детальный вид проекта
    document.getElementById('projects-section').classList.remove('active');
    document.getElementById('project-detail-section').classList.add('active');

    // Загружаем структуру проекта
    loadProjectStructure(projectId);
}

function showProjectTab(tabName) {
    // Обновляем кнопки
    document.querySelectorAll('.project-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // Показываем нужный контент
    document.querySelectorAll('.project-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`project-${tabName}`).classList.add('active');
}

async function loadProjectStructure(projectId) {
    try {
        const response = await fetch(`${CONFIG.API_URL}/projects/${projectId}/structure`);
        const data = await response.json();

        // Заполняем файловое дерево
        renderFileTree(data.files);
    } catch (error) {
        console.error('Failed to load project structure:', error);
    }
}

function renderFileTree(files) {
    const container = document.getElementById('file-tree');
    container.innerHTML = renderFileNode(files);
}

function renderFileNode(node, level = 0) {
    if (typeof node === 'string') {
        return `<div class="file-item" style="padding-left: ${level * 16}px" onclick="openFile('${node}')">📄 ${node}</div>`;
    }

    let html = '';
    for (const [name, children] of Object.entries(node)) {
        html += `<div class="folder-item" style="padding-left: ${level * 16}px">📁 ${name}</div>`;
        html += renderFileNode(children, level + 1);
    }
    return html;
}

function createNewProject() {
    // Возвращаемся в чат с шаблоном создания проекта
    showSection('chat');
    document.getElementById('chat-input').value = 'Создай проект: ';
    document.getElementById('chat-input').focus();
}

// ==================== МЕДИА ====================

function showMediaType(type) {
    // Обновляем навигацию
    document.querySelectorAll('.media-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    event.target.closest('.media-nav-item').classList.add('active');

    // Показываем нужный тип
    document.querySelectorAll('.media-type').forEach(el => {
        el.classList.remove('active');
    });
    document.getElementById(`media-${type}`).classList.add('active');
}

async function generateImage() {
    const prompt = document.getElementById('image-prompt').value;
    if (!prompt) {
        showToast('Введите описание изображения');
        return;
    }

    showGlobalProgress('Генерация изображения...');

    try {
        const response = await fetch(`${CONFIG.API_URL}/media/image/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                model: document.getElementById('image-model').value,
                size: document.getElementById('image-size').value
            })
        });

        const data = await response.json();
        hideGlobalProgress();

        if (data.success && data.image_url) {
            document.getElementById('image-result').innerHTML = `
                <img src="${data.image_url}" alt="Generated" class="generated-image">
                <div class="image-actions">
                    <button onclick="downloadImage('${data.image_url}')">⬇️ Скачать</button>
                    <button onclick="useInProject('${data.image_url}')">📁 В проект</button>
                </div>
            `;
            addToMediaHistory('image', prompt, data.image_url);
        }
    } catch (error) {
        hideGlobalProgress();
        showToast('Ошибка генерации');
    }
}

async function generateVideo() {
    const prompt = document.getElementById('video-prompt').value;
    if (!prompt) return;

    showGlobalProgress('Генерация видео (это может занять несколько минут)...');

    try {
        const response = await fetch(`${CONFIG.API_URL}/media/video/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        const data = await response.json();
        hideGlobalProgress();

        if (data.success) {
            document.getElementById('video-result').innerHTML = `
                <video controls src="${data.video_url}"></video>
            `;
        }
    } catch (error) {
        hideGlobalProgress();
        showToast('Ошибка генерации видео');
    }
}

async function textToSpeech() {
    const text = document.getElementById('audio-text').value;
    if (!text) return;

    showGlobalProgress('Создание аудио...');

    try {
        const response = await fetch(`${CONFIG.API_URL}/media/audio/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        const data = await response.json();
        hideGlobalProgress();

        if (data.success) {
            document.getElementById('audio-result').innerHTML = `
                <audio controls src="data:audio/wav;base64,${data.audio}"></audio>
            `;
        }
    } catch (error) {
        hideGlobalProgress();
        showToast('Ошибка генерации аудио');
    }
}

// ==================== ДАННЫЕ (RAG) ====================

function showDataTab(tabName) {
    document.querySelectorAll('.data-nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    document.querySelectorAll('.data-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`data-${tabName}`).classList.add('active');
}

async function loadCollections() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/rag/collections?user_id=${state.user?.id}`);
        const data = await response.json();

        state.collections = data.collections || [];
        renderCollections();
    } catch (error) {
        console.error('Failed to load collections:', error);
    }
}

function renderCollections() {
    const container = document.getElementById('collections-list');
    container.innerHTML = state.collections.map(col => `
        <div class="collection-item" onclick="selectCollection('${col.name}')">
            <span>📁</span> ${col.name}
            <small>${col.count} документов</small>
        </div>
    `).join('');
}

async function sendRAGMessage() {
    const input = document.getElementById('rag-input-field');
    const message = input.value.trim();
    if (!message) return;

    addRAGMessage(message, 'user');
    input.value = '';

    try {
        const response = await fetch(`${CONFIG.API_URL}/rag/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: message,
                user_id: state.user?.id
            })
        });

        const data = await response.json();
        if (data.success) {
            addRAGMessage(data.answer, 'assistant');
        }
    } catch (error) {
        addRAGMessage('Ошибка получения ответа', 'system');
    }
}

function addRAGMessage(text, role) {
    const container = document.getElementById('rag-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function executeNLP(command) {
    showGlobalProgress('Обработка запроса...');

    try {
        const response = await fetch(`${CONFIG.API_URL}/nlp/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, user_id: state.user?.id })
        });

        const data = await response.json();
        hideGlobalProgress();

        const container = document.getElementById('nlp-chat');
        container.innerHTML += `<div class="nlp-result"><strong>${command}</strong><pre>${JSON.stringify(data.result, null, 2)}</pre></div>`;
    } catch (error) {
        hideGlobalProgress();
        showToast('Ошибка выполнения команды');
    }
}

// ==================== АВТОМАТИЗАЦИЯ ====================

async function loadWorkflows() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/workflows?user_id=${state.user?.id}`);
        const data = await response.json();

        state.workflows = data.workflows || [];
        renderWorkflows();
    } catch (error) {
        console.error('Failed to load workflows:', error);
    }
}

function renderWorkflows() {
    const container = document.getElementById('workflows-list');

    if (state.workflows.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>Нет workflow</p>
                <button class="btn-primary" onclick="createWorkflow()">Создать первый</button>
            </div>
        `;
        return;
    }

    container.innerHTML = state.workflows.map(wf => `
        <div class="workflow-card">
            <div class="workflow-info">
                <h4>${wf.name}</h4>
                <p>${wf.trigger} → ${wf.actions.join(' → ')}</p>
            </div>
            <div class="workflow-status ${wf.active ? 'active' : 'paused'}">
                ${wf.active ? '● Активен' : '⏸️ На паузе'}
            </div>
        </div>
    `).join('');
}

function createWorkflow() {
    document.getElementById('workflow-builder').classList.remove('hidden');
}

// ==================== ПРОФИЛЬ ====================

function updateProfileUI() {
    if (!state.user) return;

    document.getElementById('profile-name').textContent = state.user.first_name || state.user.username || 'Пользователь';
    document.getElementById('profile-email').textContent = state.user.email || '';

    // Обновляем статистику
    document.getElementById('projects-count').textContent = state.projects.length;
    document.getElementById('requests-count').textContent = state.chatHistory.length;
}

function addApiKey(provider) {
    const key = prompt(`Введите API ключ для ${provider}:`);
    if (key) {
        // Сохраняем ключ (в реальном приложении - безопасно)
        localStorage.setItem(`api_key_${provider}`, key);
        showToast(`Ключ ${provider} добавлен`);
    }
}

// ==================== УТИЛИТЫ ====================

function showGlobalProgress(text) {
    const progress = document.getElementById('global-progress');
    progress.querySelector('.progress-text').textContent = text;
    progress.classList.remove('hidden');
}

function hideGlobalProgress() {
    document.getElementById('global-progress').classList.add('hidden');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function showModal(content) {
    document.getElementById('modal-content').innerHTML = content;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

function showContextPanel(content) {
    document.getElementById('context-content').innerHTML = content;
    document.getElementById('context-panel').classList.remove('hidden');
    state.contextPanelOpen = true;
}

function closeContextPanel() {
    document.getElementById('context-panel').classList.add('hidden');
    state.contextPanelOpen = false;
}

function autoResizeTextarea() {
    const textarea = document.getElementById('chat-input');
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

function toggleTheme() {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    localStorage.setItem('ai_platform_settings', JSON.stringify(state.settings));
}

function applyTheme() {
    document.body.classList.toggle('light-theme', state.settings.theme === 'light');
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU');
}

function getChatContext() {
    // Берём последние 10 сообщений для контекста
    return state.chatHistory.slice(-10);
}

function handleRedirect(redirect) {
    switch(redirect.type) {
        case 'project':
            showSection('projects');
            break;
        case 'media':
            showSection('media');
            break;
        case 'automation':
            showSection('automation');
            break;
    }
}

function showAttachMenu() {
    showModal(`
        <h3>Прикрепить</h3>
        <div class="attach-options">
            <button onclick="attachFile('file')">📁 Файл</button>
            <button onclick="attachFile('code')">💻 Код</button>
            <button onclick="attachFile('url')">🔗 URL</button>
            <button onclick="attachFile('db')">🗄️ База данных</button>
        </div>
    `);
}

function attachFile(type) {
    closeModal();
    showToast(`Прикрепление ${type}...`);
}

function clearChat() {
    if (confirm('Очистить историю чата?')) {
        document.getElementById('chat-messages').innerHTML = '';
        state.chatHistory = [];
    }
}

function showChatHistory() {
    // Показываем историю чатов
    showModal(`
        <h3>История чатов</h3>
        <div class="chat-history-list">
            ${state.chatHistory.map(msg => `
                <div class="history-item ${msg.role}">
                    <small>${new Date(msg.timestamp).toLocaleString()}</small>
                    <p>${msg.text.substring(0, 100)}...</p>
                </div>
            `).join('')}
        </div>
    `);
}

function cancelOperation() {
    state.isGenerating = false;
    hideGlobalProgress();
    showToast('Операция отменена');
}

// Инициализация данных при загрузке
function loadInitialData() {
    // Загружаем базовые данные
    if (state.user) {
        loadProjects();
    }
}
