// AI Platform Pro v6.0 - Enterprise Grade
const CONFIG = {
    API_URL: localStorage.getItem('api_url') || 'https://api.aiplatform.pro',
    WS_URL: localStorage.getItem('ws_url') || 'wss://api.aiplatform.pro/ws',
    VERSION: '6.0.0',
    MAX_RETRIES: 3,
    TIMEOUT: 30000
};

// State Management
const state = {
    user: null,
    currentSection: 'chat',
    currentProject: null,
    chatHistory: [],
    projects: [],
    workflows: [],
    collections: [],
    settings: {
        theme: localStorage.getItem('theme') || 'dark',
        mode: 'pro',
        language: 'ru'
    },
    isGenerating: false,
    contextPanelOpen: false,
    apiStatus: {
        openai: true,
        anthropic: false,
        grok: false
    },
    balance: 1250
};

// Command Palette Commands
const commands = [
    { id: 'new_project', name: 'Новый проект', icon: '🏗️', shortcut: 'Ctrl+P', action: () => createNewProject() },
    { id: 'new_image', name: 'Сгенерировать изображение', icon: '🎨', shortcut: 'Ctrl+I', action: () => { showSection('media'); showMediaType('images'); } },
    { id: 'clear_chat', name: 'Очистить чат', icon: '🗑️', shortcut: 'Ctrl+Shift+C', action: () => clearChat() },
    { id: 'toggle_theme', name: 'Сменить тему', icon: '🌙', shortcut: 'Ctrl+T', action: () => toggleTheme() },
    { id: 'open_projects', name: 'Открыть проекты', icon: '📁', shortcut: 'Ctrl+Shift+P', action: () => showSection('projects') },
    { id: 'open_automation', name: 'Автоматизация', icon: '⚡', shortcut: 'Ctrl+Shift+A', action: () => showSection('automation') },
    { id: 'open_profile', name: 'Профиль', icon: '👤', shortcut: 'Ctrl+Shift+U', action: () => showSection('profile') },
    { id: 'add_funds', name: 'Пополнить баланс', icon: '💎', shortcut: '', action: () => addFunds() }
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    try {
        initTelegram();
        loadUserData();
        applyTheme();
        setupEventListeners();
        initCommandPalette();
        checkApiStatus();
        loadInitialData();
        
        // Simulate loading
        setTimeout(() => {
            updateUI();
        }, 500);
        
        console.log('✨ AI Platform Pro initialized');
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Ошибка инициализации', 'error');
    }
}

function initTelegram() {
    if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        tg.enableClosingConfirmation();
        
        if (tg.initDataUnsafe?.user) {
            state.user = {
                id: tg.initDataUnsafe.user.id.toString(),
                username: tg.initDataUnsafe.user.username,
                first_name: tg.initDataUnsafe.user.first_name,
                photo_url: tg.initDataUnsafe.user.photo_url
            };
            updateProfileUI();
        }
        
        // Set header color
        tg.setHeaderColor('#0a0a0f');
        tg.setBackgroundColor('#0a0a0f');
    }
}

function loadUserData() {
    const saved = localStorage.getItem('ai_platform_user');
    if (saved) {
        state.user = JSON.parse(saved);
    }
    
    const savedSettings = localStorage.getItem('ai_platform_settings');
    if (savedSettings) {
        state.settings = { ...state.settings, ...JSON.parse(savedSettings) };
    }
}

function setupEventListeners() {
    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Command Palette
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            showCommandPalette();
        }
        
        // Escape
        if (e.key === 'Escape') {
            closeModal();
            closeContextPanel();
            closeCommandPalette();
            hideQuickActions();
        }
        
        // Quick actions
        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
            e.preventDefault();
            createNewProject();
        }
    });
    
    // Chat input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('input', autoResizeTextarea);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
    
    // Palette input
    const paletteInput = document.getElementById('palette-input');
    if (paletteInput) {
        paletteInput.addEventListener('input', (e) => filterCommands(e.target.value));
        paletteInput.addEventListener('keydown', handlePaletteNavigation);
    }
    
    // Window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            adjustLayout();
        }, 250);
    });
}

function initCommandPalette() {
    const resultsContainer = document.getElementById('palette-results');
    resultsContainer.innerHTML = commands.map((cmd, index) => `
        <div class="command-item" data-index="${index}" onclick="executeCommand('${cmd.id}')">
            <div class="command-icon">${cmd.icon}</div>
            <div class="command-info">
                <div class="command-name">${cmd.name}</div>
                <div class="command-desc">${cmd.shortcut || ''}</div>
            </div>
        </div>
    `).join('');
}

function showCommandPalette() {
    const palette = document.getElementById('command-palette');
    palette.classList.remove('hidden');
    document.getElementById('palette-input').value = '';
    document.getElementById('palette-input').focus();
    filterCommands('');
}

function closeCommandPalette() {
    document.getElementById('command-palette').classList.add('hidden');
}

function filterCommands(query) {
    const items = document.querySelectorAll('.command-item');
    const lowerQuery = query.toLowerCase();
    
    items.forEach((item, index) => {
        const cmd = commands[index];
        const match = cmd.name.toLowerCase().includes(lowerQuery);
        item.style.display = match ? 'flex' : 'none';
        item.classList.toggle('selected', match && document.querySelectorAll('.command-item[style*="flex"]').length === 1);
    });
}

function handlePaletteNavigation(e) {
    const visibleItems = Array.from(document.querySelectorAll('.command-item[style*="flex"]'));
    const currentSelected = visibleItems.find(item => item.classList.contains('selected'));
    let currentIndex = currentSelected ? visibleItems.indexOf(currentSelected) : -1;
    
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        currentIndex = (currentIndex + 1) % visibleItems.length;
        updateSelection(visibleItems, currentIndex);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        currentIndex = currentIndex <= 0 ? visibleItems.length - 1 : currentIndex - 1;
        updateSelection(visibleItems, currentIndex);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (currentSelected) {
            const index = parseInt(currentSelected.dataset.index);
            executeCommand(commands[index].id);
        }
    }
}

function updateSelection(items, index) {
    items.forEach(item => item.classList.remove('selected'));
    if (items[index]) {
        items[index].classList.add('selected');
        items[index].scrollIntoView({ block: 'nearest' });
    }
}

function executeCommand(commandId) {
    const cmd = commands.find(c => c.id === commandId);
    if (cmd) {
        closeCommandPalette();
        cmd.action();
    }
}

// Navigation
function showSection(sectionName) {
    // Update sidebar
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === sectionName);
    });
    
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show target section
    const target = document.getElementById(`${sectionName}-section`);
    if (target) {
        target.classList.add('active');
        state.currentSection = sectionName;
        
        // Section-specific loading
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
            case 'dashboard':
                loadDashboard();
                break;
            case 'profile':
                updateProfileUI();
                break;
        }
        
        // Scroll to top
        window.scrollTo(0, 0);
    }
}

// Chat Functions
async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message || state.isGenerating) return;
    
    // Add user message
    addMessage(message, 'user');
    input.value = '';
    autoResizeTextarea();
    
    // Show progress
    showGlobalProgress('AI анализирует запрос...');
    state.isGenerating = true;
    
    try {
        const intent = detectIntent(message);
        const response = await fetchWithRetry(`${CONFIG.API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                intent,
                user_id: state.user?.id,
                context: getChatContext()
            })
        });
        
        hideGlobalProgress();
        
        if (response.success) {
            addMessage(response.response, 'assistant', response.actions);
            
            if (response.suggestions) {
                showSuggestions(response.suggestions);
            }
            
            if (response.redirect) {
                setTimeout(() => handleRedirect(response.redirect), 1000);
            }
        } else {
            addMessage('⚠️ Произошла ошибка. Попробуйте ещё раз.', 'system');
        }
    } catch (error) {
        hideGlobalProgress();
        console.error('Chat error:', error);
        
        // Fallback response for demo
        setTimeout(() => {
            addMessage('✅ Я получил ваше сообщение. В демо-режиме я показываю, как будет выглядеть ответ AI. В продакшене здесь будет интеграция с реальными API.', 'assistant', [
                { type: 'create_project', label: 'Создать проект', data: message },
                { type: 'modify', label: 'Уточнить', data: '' }
            ]);
        }, 1000);
    } finally {
        state.isGenerating = false;
    }
}

function detectIntent(message) {
    const lower = message.toLowerCase();
    const intents = {
        'create_project': ['создай', 'проект', 'сайт', 'приложение', 'бот'],
        'generate_image': ['изображение', 'картинку', 'фото', 'нарисуй'],
        'write_code': ['код', 'функцию', 'скрипт', 'напиши'],
        'analyze': ['анализ', 'проверь', 'ревью'],
        'business_plan': ['бизнес-план', 'бизнес план', 'startup']
    };
    
    for (const [intent, keywords] of Object.entries(intents)) {
        if (keywords.some(k => lower.includes(k))) return intent;
    }
    return 'general';
}

function addMessage(text, role, actions = []) {
    const container = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    let content = `<div class="message-content">${formatMessage(text)}</div>`;
    
    if (actions?.length > 0) {
        content += '<div class="message-actions">';
        actions.forEach(action => {
            content += `<button class="msg-action-btn" onclick="handleAction('${action.type}', '${escapeHtml(action.data)}')">${action.label}</button>`;
        });
        content += '</div>';
    }
    
    messageDiv.innerHTML = content;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    
    state.chatHistory.push({ text, role, timestamp: Date.now() });
    
    // Limit history
    if (state.chatHistory.length > 100) {
        state.chatHistory.shift();
    }
}

function formatMessage(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function quickAction(actionType) {
    const prompts = {
        'create_project': 'Создай проект: ',
        'analyze_file': 'Проанализируй этот файл: ',
        'generate_image': 'Сгенерируй изображение: ',
        'write_code': 'Напиши код для: ',
        'business_plan': 'Создай бизнес-план для: ',
        'autonomous': 'Запусти автономный режим для: '
    };
    
    const input = document.getElementById('chat-input');
    input.value = prompts[actionType] || '';
    input.focus();
    autoResizeTextarea();
    
    if (actionType === 'generate_image') {
        showSection('media');
        showMediaType('images');
        document.getElementById('image-prompt').value = input.value.replace('Сгенерируй изображение: ', '');
    }
}

function handleAction(type, data) {
    switch(type) {
        case 'accept_architecture':
            showToast('✅ Архитектура принята', 'success');
            break;
        case 'modify':
            document.getElementById('chat-input').value = 'Измени: ' + data;
            document.getElementById('chat-input').focus();
            break;
        case 'create_project':
            createProjectFromChat(data);
            break;
        case 'simplify':
            sendMessageDirect('Упрости эту архитектуру');
            break;
        case 'deepen':
            sendMessageDirect('Добавь больше деталей');
            break;
    }
}

async function sendMessageDirect(text) {
    document.getElementById('chat-input').value = text;
    await sendMessage();
}

// Projects
async function loadProjects() {
    const container = document.getElementById('projects-list');
    
    // Show skeleton
    container.innerHTML = `
        <div class="loading-skeleton">
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
        </div>
    `;
    
    try {
        const response = await fetchWithRetry(`${CONFIG.API_URL}/projects?user_id=${state.user?.id}`);
        state.projects = response.projects || getDemoProjects();
    } catch (error) {
        state.projects = getDemoProjects();
    }
    
    renderProjects();
    updateProjectStats();
}

function getDemoProjects() {
    return [
        { id: '1', name: 'E-Commerce Platform', type: 'fullstack', stack: 'React + Node.js', status: 'active', updated_at: Date.now() },
        { id: '2', name: 'Telegram Bot', type: 'bot', stack: 'Python + aiogram', status: 'active', updated_at: Date.now() - 86400000 },
        { id: '3', name: 'Landing Page', type: 'frontend', stack: 'Vue + Tailwind', status: 'draft', updated_at: Date.now() - 172800000 }
    ];
}

function renderProjects() {
    const container = document.getElementById('projects-list');
    
    if (state.projects.length === 0) {
        container.innerHTML = `
            <div class="empty-state glass">
                <span class="empty-icon">📁</span>
                <p>Нет проектов</p>
                <button class="btn-primary gradient-btn" onclick="createNewProject()">Создать первый проект</button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = state.projects.map(project => `
        <div class="project-card glass" onclick="openProject('${project.id}')">
            <div class="project-icon">${getProjectIcon(project.type)}</div>
            <div class="project-info">
                <h4>${escapeHtml(project.name)}</h4>
                <p>${project.type} • ${project.stack || 'не указан'}</p>
                <span class="project-status ${project.status}">${project.status}</span>
            </div>
            <div class="project-meta">
                <small>${formatDate(project.updated_at)}</small>
            </div>
        </div>
    `).join('');
}

function updateProjectStats() {
    document.getElementById('total-projects').textContent = state.projects.length;
    document.getElementById('active-projects').textContent = state.projects.filter(p => p.status === 'active').length;
    document.getElementById('deployed-projects').textContent = state.projects.filter(p => p.status === 'deployed').length;
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
    
    showSection('project-detail');
    loadProjectStructure(projectId);
}

function showProjectTab(tabName) {
    document.querySelectorAll('.project-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(tabName)) {
            btn.classList.add('active');
        }
    });
    
    document.querySelectorAll('.project-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const target = document.getElementById(`project-${tabName}`);
    if (target) target.classList.add('active');
}

async function loadProjectStructure(projectId) {
    // Demo file structure
    const files = {
        'src': {
            'components': ['Header.tsx', 'Footer.tsx', 'Button.tsx'],
            'pages': ['index.tsx', 'about.tsx'],
            'utils': ['api.ts', 'helpers.ts']
        },
        'public': ['index.html', 'favicon.ico'],
        'package.json': 'file',
        'tsconfig.json': 'file'
    };
    
    renderFileTree(files);
}

function renderFileTree(files, level = 0) {
    const container = document.getElementById('tree-content');
    let html = '';
    
    for (const [name, content] of Object.entries(files)) {
        if (typeof content === 'object') {
            html += `
                <div class="folder-item" style="padding-left: ${level * 16}px" onclick="toggleFolder(this)">
                    📁 ${name}
                </div>
                <div class="folder-content">
                    ${renderFileTree(content, level + 1)}
                </div>
            `;
        } else {
            html += `
                <div class="file-item" style="padding-left: ${level * 16}px" onclick="openFile('${name}')">
                    📄 ${name}
                </div>
            `;
        }
    }
    
    if (level === 0) container.innerHTML = html;
    return html;
}

function toggleFolder(element) {
    element.classList.toggle('expanded');
    const content = element.nextElementSibling;
    if (content) content.classList.toggle('hidden');
}

function openFile(filename) {
    document.getElementById('code-textarea').value = `// ${filename}\n// Здесь будет код файла...\n\nimport React from 'react';\n\nexport default function Component() {\n  return <div>Hello World</div>;\n}`;
}

function createNewProject() {
    showSection('chat');
    quickAction('create_project');
}

function createProjectFromChat(data) {
    showToast('🚀 Создаю проект...', 'success');
    setTimeout(() => {
        showSection('projects');
        loadProjects();
    }, 1500);
}

// Media
function showMediaType(type) {
    document.querySelectorAll('.media-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    document.querySelectorAll('.media-type').forEach(el => {
        el.classList.remove('active');
    });
    
    const target = document.getElementById(`media-${type}`);
    if (target) target.classList.add('active');
}

async function generateImage() {
    const prompt = document.getElementById('image-prompt').value;
    if (!prompt) {
        showToast('⚠️ Введите описание', 'warning');
        return;
    }
    
    const progress = document.getElementById('image-progress');
    const result = document.getElementById('image-result');
    
    progress.classList.remove('hidden');
    result.innerHTML = '';
    
    // Animate progress
    let percent = 0;
    const interval = setInterval(() => {
        percent += Math.random() * 15;
        if (percent > 100) percent = 100;
        document.getElementById('progress-percent').textContent = Math.floor(percent) + '%';
        
        if (percent === 100) {
            clearInterval(interval);
            setTimeout(() => {
                progress.classList.add('hidden');
                showImageResult(prompt);
            }, 500);
        }
    }, 300);
    
    // Deduct balance
    updateBalance(-25);
}

function showImageResult(prompt) {
    const result = document.getElementById('image-result');
    // Placeholder image with gradient
    result.innerHTML = `
        <div class="generated-image-container">
            <div class="generated-image-placeholder" style="background: linear-gradient(135deg, #6366f1, #ec4899); height: 400px; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: white; font-size: 18px;">
                🎨 ${escapeHtml(prompt.substring(0, 50))}...
            </div>
            <div class="image-actions">
                <button class="btn-secondary" onclick="downloadImage()">⬇️ Скачать</button>
                <button class="btn-secondary" onclick="useInProject()">📁 В проект</button>
                <button class="btn-secondary" onclick="regenerateImage()">🔄 Повторить</button>
            </div>
        </div>
    `;
    
    addToMediaHistory('image', prompt, 'generated');
    showToast('✅ Изображение сгенерировано!', 'success');
}

async function generateVideo() {
    showToast('🎬 Генерация видео начата...', 'info');
    updateBalance(-100);
}

async function textToSpeech() {
    const text = document.getElementById('audio-text').value;
    if (!text) {
        showToast('⚠️ Введите текст', 'warning');
        return;
    }
    
    showToast('🔊 Создание аудио...', 'info');
    updateBalance(-5);
    
    setTimeout(() => {
        document.getElementById('audio-result').innerHTML = `
            <audio controls style="width: 100%; margin-top: 20px;">
                <source src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZSA0PVanu87plHQUuh9Dz2YU2Bhxqv+zplkcODVGm5O+4ZSAEMYrO89GFNwYdcfDr4ZdJDQtPp+XysWUeBjiS1/LNfi0GI33R8tOENAcdcO/r4phJDQxPpOXyxGUhBDeOzvPVhjYGHG3A7+SaSQ0MTqjl8b1kHwU2jc7z1YU1Bhxwv+zmm0gNC1Ko5O/EZSAFNo/M89CEMwYccPDs4ppIDQtRqOXyxWUfBTiOz/PShjUGG3Dw7OKbSA0LUqjl8cVlHwU3jM/z0oU1Bxtw8OzhmUgNC1Ko5fHFZR8F" type="audio/wav">
            </audio>
        `;
    }, 1500);
}

function loadMediaHistory() {
    const container = document.getElementById('media-history-list');
    container.innerHTML = `
        <div class="history-item glass" onclick="loadHistoryItem(1)">
            <div class="history-thumb" style="background: linear-gradient(135deg, #6366f1, #8b5cf6);"></div>
            <div class="history-info">
                <span>Киберпанк город</span>
                <small>2 часа назад</small>
            </div>
        </div>
        <div class="history-item glass" onclick="loadHistoryItem(2)">
            <div class="history-thumb" style="background: linear-gradient(135deg, #ec4899, #f59e0b);"></div>
            <div class="history-info">
                <span>Абстрактный фон</span>
                <small>Вчера</small>
            </div>
        </div>
    `;
}

// Data
async function loadCollections() {
    // Demo data
    state.collections = [
        { name: 'Основная', count: 24 },
        { name: 'Документация', count: 156 },
        { name: 'Код', count: 89 }
    ];
    renderCollections();
}

function renderCollections() {
    const container = document.getElementById('collections-list');
    container.innerHTML = state.collections.map(col => `
        <div class="collection-item ${col.name === 'Основная' ? 'active' : ''}" onclick="selectCollection('${col.name}')">
            <div class="collection-icon">📁</div>
            <div class="collection-info">
                <span class="collection-name">${col.name}</span>
                <span class="collection-meta">${col.count} документов</span>
            </div>
        </div>
    `).join('');
}

function selectCollection(name) {
    document.querySelectorAll('.collection-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    showToast(`📁 Выбрана коллекция: ${name}`, 'info');
}

async function sendRAGMessage() {
    const input = document.getElementById('rag-input-field');
    const message = input.value.trim();
    if (!message) return;
    
    addRAGMessage(message, 'user');
    input.value = '';
    
    setTimeout(() => {
        addRAGMessage('На основе ваших документов: Это демо-ответ от RAG системы. В продакшене здесь будет поиск по векторной базе данных и ответ на основе найденных документов.', 'assistant');
    }, 1000);
}

function addRAGMessage(text, role) {
    const container = document.getElementById('rag-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `<div class="message-content">${text}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function executeNLP(command) {
    showGlobalProgress('Обработка NLP...');
    
    setTimeout(() => {
        hideGlobalProgress();
        const container = document.getElementById('nlp-chat');
        container.innerHTML += `
            <div class="nlp-result glass" style="margin-bottom: 16px; padding: 20px;">
                <strong style="color: var(--accent-primary);">${escapeHtml(command)}</strong>
                <pre style="margin-top: 12px; padding: 16px; background: var(--bg-glass); border-radius: 8px; overflow-x: auto;">{
  "action": "query",
  "table": "sales",
  "filters": {
    "month": "january"
  },
  "result": "Найдено 1,234 записей"
}</pre>
            </div>
        `;
    }, 1500);
}

// Automation
async function loadWorkflows() {
    state.workflows = [
        { id: 1, name: 'Авто-постинг', trigger: 'webhook', actions: ['ai', 'telegram'], active: true },
        { id: 2, name: 'Обработка заказов', trigger: 'schedule', actions: ['db', 'email'], active: false }
    ];
    renderWorkflows();
}

function renderWorkflows() {
    const container = document.getElementById('workflows-list');
    container.innerHTML = state.workflows.map(wf => `
        <div class="workflow-card glass">
            <div class="workflow-visual">
                <div class="node trigger">⚡ ${wf.trigger}</div>
                <div class="connection"></div>
                ${wf.actions.map(action => `<div class="node action">${getActionIcon(action)} ${action}</div>`).join('<div class="connection"></div>')}
            </div>
            <div class="workflow-info">
                <h4>${wf.name}</h4>
                <p>${wf.active ? '● Активен' : '⏸️ На паузе'}</p>
            </div>
            <div class="workflow-actions">
                <button class="btn-glass" onclick="editWorkflow(${wf.id})">✏️</button>
                <button class="btn-glass ${wf.active ? 'active' : ''}" onclick="toggleWorkflow(${wf.id})">${wf.active ? '⏸️' : '▶️'}</button>
            </div>
        </div>
    `).join('');
}

function getActionIcon(action) {
    const icons = { 'ai': '🤖', 'telegram': '📱', 'email': '📧', 'db': '💾' };
    return icons[action] || '⚡';
}

function createWorkflow() {
    document.getElementById('workflow-builder').classList.remove('hidden');
    showToast('🛠️ Открыт конструктор workflow', 'info');
}

function editWorkflow(id) {
    showToast(`✏️ Редактирование workflow ${id}`, 'info');
}

function toggleWorkflow(id) {
    const wf = state.workflows.find(w => w.id === id);
    if (wf) {
        wf.active = !wf.active;
        renderWorkflows();
        showToast(wf.active ? '▶️ Workflow активирован' : '⏸️ Workflow остановлен', 'success');
    }
}

// Dashboard
function loadDashboard() {
    // Animate numbers
    animateNumber('dash-projects', 12);
    animateNumber('dash-generations', 48);
    
    // Load activity
    document.getElementById('activity-list').innerHTML = `
        <div class="activity-item" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-glass); border-radius: 8px;">
            <span style="font-size: 24px;">🎨</span>
            <div style="flex: 1;">
                <div style="font-weight: 500;">Сгенерировано изображение</div>
                <div style="font-size: 12px; color: var(--text-muted);">2 минуты назад</div>
            </div>
        </div>
        <div class="activity-item" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-glass); border-radius: 8px;">
            <span style="font-size: 24px;">🏗️</span>
            <div style="flex: 1;">
                <div style="font-weight: 500;">Создан проект "E-Commerce"</div>
                <div style="font-size: 12px; color: var(--text-muted);">1 час назад</div>
            </div>
        </div>
    `;
}

function animateNumber(id, target) {
    const element = document.getElementById(id);
    let current = 0;
    const increment = target / 30;
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        element.textContent = Math.floor(current);
    }, 50);
}

// Profile
function updateProfileUI() {
    if (!state.user) return;
    
    document.getElementById('profile-name').textContent = state.user.first_name || state.user.username || 'Пользователь';
    document.getElementById('profile-email').textContent = state.user.email || '@' + (state.user.username || 'user');
    
    if (state.user.photo_url) {
        document.getElementById('profile-avatar').innerHTML = `<img src="${state.user.photo_url}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
    }
    
    document.getElementById('projects-count').textContent = state.projects.length;
    document.getElementById('requests-count').textContent = '1.2k';
    document.getElementById('balance').textContent = state.balance.toLocaleString();
}

function addApiKey(provider) {
    const key = prompt(`Введите API ключ для ${provider}:`);
    if (key) {
        // Secure storage simulation
        sessionStorage.setItem(`api_key_${provider}`, key);
        showToast(`🔑 Ключ ${provider} добавлен`, 'success');
        
        // Update UI
        setTimeout(() => {
            document.querySelector(`#status-${provider} .status-dot`).style.background = 'var(--success)';
        }, 500);
    }
}

function editProfile() {
    showToast('✏️ Редактирование профиля', 'info');
}

function addFunds() {
    showModal(`
        <h3 style="margin-bottom: 20px;">💎 Пополнение баланса</h3>
        <div style="display: grid; gap: 12px;">
            <button class="btn-primary gradient-btn" onclick="processPayment(500)" style="justify-content: space-between;">
                <span>500 💎</span>
                <span>499 ₽</span>
            </button>
            <button class="btn-primary gradient-btn" onclick="processPayment(1000)" style="justify-content: space-between;">
                <span>1000 💎</span>
                <span>899 ₽</span>
            </button>
            <button class="btn-primary gradient-btn" onclick="processPayment(5000)" style="justify-content: space-between;">
                <span>5000 💎</span>
                <span>3999 ₽</span>
            </button>
        </div>
    `);
}

function processPayment(amount) {
    closeModal();
    showGlobalProgress('Обработка платежа...');
    
    setTimeout(() => {
        hideGlobalProgress();
        updateBalance(amount);
        showToast(`✅ Зачислено ${amount} 💎`, 'success');
    }, 2000);
}

function updateBalance(delta) {
    state.balance += delta;
    document.getElementById('user-balance').textContent = state.balance.toLocaleString();
    document.getElementById('balance').textContent = state.balance.toLocaleString();
    localStorage.setItem('user_balance', state.balance);
}

// Theme
function toggleTheme() {
    const themes = ['dark', 'light', 'midnight'];
    const currentIndex = themes.indexOf(state.settings.theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    changeTheme(nextTheme);
}

function changeTheme(theme) {
    state.settings.theme = theme;
    document.body.className = theme === 'light' ? 'light-theme' : theme === 'midnight' ? 'midnight-theme' : '';
    localStorage.setItem('theme', theme);
    
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'light' ? '☀️' : '🌙';
    
    // Update Telegram
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.setHeaderColor(theme === 'light' ? '#f8fafc' : '#0a0a0f');
    }
}

function applyTheme() {
    changeTheme(state.settings.theme);
}

// Utility Functions
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
    
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showModal(content) {
    const modal = document.getElementById('modal-content');
    const overlay = document.getElementById('modal-overlay');
    modal.innerHTML = content + '<button onclick="closeModal()" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: var(--text-muted); font-size: 24px; cursor: pointer;">×</button>';
    overlay.classList.remove('hidden');
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

function showAttachMenu() {
    showModal(`
        <h3 style="margin-bottom: 20px;">📎 Прикрепить</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            <button class="btn-glass" onclick="attachFile('file')" style="padding: 24px; flex-direction: column; gap: 8px;">
                <span style="font-size: 32px;">📁</span>
                <span>Файл</span>
            </button>
            <button class="btn-glass" onclick="attachFile('code')" style="padding: 24px; flex-direction: column; gap: 8px;">
                <span style="font-size: 32px;">💻</span>
                <span>Код</span>
            </button>
            <button class="btn-glass" onclick="attachFile('url')" style="padding: 24px; flex-direction: column; gap: 8px;">
                <span style="font-size: 32px;">🔗</span>
                <span>URL</span>
            </button>
            <button class="btn-glass" onclick="attachFile('db')" style="padding: 24px; flex-direction: column; gap: 8px;">
                <span style="font-size: 32px;">🗄️</span>
                <span>База данных</span>
            </button>
        </div>
    `);
}

function attachFile(type) {
    closeModal();
    showToast(`📎 Выбран тип: ${type}`, 'info');
}

function clearChat() {
    if (confirm('Очистить историю чата?')) {
        document.getElementById('chat-messages').innerHTML = '';
        state.chatHistory = [];
        showToast('🗑️ Чат очищен', 'success');
    }
}

function showChatHistory() {
    const history = state.chatHistory.slice(-10).map(msg => `
        <div style="padding: 12px; background: var(--bg-glass); border-radius: 8px; margin-bottom: 8px;">
            <small style="color: var(--text-muted);">${new Date(msg.timestamp).toLocaleString()}</small>
            <p style="margin-top: 4px;">${escapeHtml(msg.text.substring(0, 100))}...</p>
        </div>
    `).join('');
    
    showModal(`
        <h3 style="margin-bottom: 20px;">📜 История чата</h3>
        <div style="max-height: 400px; overflow-y: auto;">
            ${history || '<p style="color: var(--text-muted); text-align: center;">История пуста</p>'}
        </div>
    `);
}

function cancelOperation() {
    state.isGenerating = false;
    hideGlobalProgress();
    showToast('❌ Операция отменена', 'warning');
}

function showQuickActions() {
    document.getElementById('quick-actions-sheet').classList.remove('hidden');
}

function hideQuickActions() {
    document.getElementById('quick-actions-sheet').classList.add('hidden');
}

function adjustLayout() {
    // Mobile adjustments
    if (window.innerWidth <= 768) {
        closeContextPanel();
    }
}

function checkApiStatus() {
    // Simulate API status check
    setTimeout(() => {
        document.getElementById('status-openai').classList.add('error');
        document.querySelector('#status-openai .status-dot').style.background = 'var(--success)';
    }, 1000);
}

async function fetchWithRetry(url, options, retries = CONFIG.MAX_RETRIES) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);
        
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 1000));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
    
    return date.toLocaleDateString('ru-RU');
}

function getChatContext() {
    return state.chatHistory.slice(-10);
}

function handleRedirect(redirect) {
    switch(redirect.type) {
        case 'project': showSection('projects'); break;
        case 'media': showSection('media'); break;
        case 'automation': showSection('automation'); break;
    }
}

function loadInitialData() {
    if (state.user) {
        loadProjects();
    }
    updateBalance(0); // Load saved balance
}

function updateUI() {
    // Initial UI updates
    document.querySelectorAll('.loading-skeleton').forEach(el => {
        el.style.display = 'none';
    });
}

// Expose functions globally
window.showSection = showSection;
window.sendMessage = sendMessage;
window.quickAction = quickAction;
window.showMediaType = showMediaType;
window.generateImage = generateImage;
window.generateVideo = generateVideo;
window.textToSpeech = textToSpeech;
window.createNewProject = createNewProject;
window.openProject = openProject;
window.showProjectTab = showProjectTab;
window.toggleTheme = toggleTheme;
window.showCommandPalette = showCommandPalette;
window.closeCommandPalette = closeCommandPalette;
window.executeCommand = executeCommand;
window.showModal = showModal;
window.closeModal = closeModal;
window.showContextPanel = showContextPanel;
window.closeContextPanel = closeContextPanel;
window.clearChat = clearChat;
window.showChatHistory = showChatHistory;
window.showAttachMenu = attachFile;
window.cancelOperation = cancelOperation;
window.showQuickActions = showQuickActions;
window.hideQuickActions = hideQuickActions;
window.addApiKey = addApiKey;
window.editProfile = editProfile;
window.addFunds = addFunds;
window.createWorkflow = createWorkflow;
window.editWorkflow = editWorkflow;
window.toggleWorkflow = toggleWorkflow;
window.sendRAGMessage = sendRAGMessage;
window.executeNLP = executeNLP;
window.selectCollection = selectCollection;
window.createCollection = () => showToast('📁 Создание коллекции', 'info');
window.uploadDocument = () => showToast('📄 Загрузка документа', 'info');
window.handleAction = handleAction;
window.toggleFolder = toggleFolder;
window.openFile = openFile;
window.deployProject = () => showToast('🚀 Деплой начат', 'success');
window.shareProject = () => showToast('🔗 Ссылка скопирована', 'success');
window.settingsProject = () => showToast('⚙️ Настройки проекта', 'info');
window.explainCode = () => showToast('🤖 AI анализирует код', 'info');
window.optimizeCode = () => showToast('⚡ Оптимизация кода', 'info');
window.fixCode = () => showToast('🔧 Исправление ошибок', 'info');
window.viewLogs = (type) => showToast(`📋 Логи ${type}`, 'info');
window.setupMonitoring = () => showToast('📊 Настройка мониторинга', 'info');
window.viewErrors = () => showToast('⚠️ Просмотр ошибок', 'warning');
window.downloadImage = () => showToast('⬇️ Скачивание...', 'success');
window.useInProject = () => showToast('📁 Добавлено в проект', 'success');
window.regenerateImage = generateImage;
window.newFile = () => showToast('📄 Новый файл', 'info');
window.changeTheme = changeTheme;
window.processPayment = processPayment;
