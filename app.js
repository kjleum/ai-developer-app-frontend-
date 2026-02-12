// Конфигурация
const CONFIG = {
    API_URL: 'https://ai-developer-api.onrender.com',
    TELEGRAM_MODE: true
};

// Состояние приложения
const state = {
    user: null,
    currentStep: 1,
    projectConfig: {
        name: '',
        description: '',
        type: 'api',
        features: [],
        database: 'none',
        frontend: 'none',
        authentication: false,
        admin_panel: false,
        api_documentation: true,
        tests: false,
        docker: false,
        ai_settings: {
            provider: 'groq',
            model: null,
            temperature: 0.7,
            max_tokens: 4000
        },
        auto_deploy: true,
        platform: 'render'
    },
    aiProviders: [],
    examples: []
};

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    initTelegram();
    await loadData();
    setupEventListeners();
    showScreen('main-screen');
});

// Telegram WebApp
function initTelegram() {
    if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        state.user = {
            id: tg.initDataUnsafe?.user?.id?.toString() || 'demo_user',
            username: tg.initDataUnsafe?.user?.username || 'demo'
        };

        tg.setHeaderColor('#0f0f23');
        tg.setBackgroundColor('#0f0f23');
    } else {
        state.user = { id: 'web_user_' + Date.now(), username: 'web_user' };
    }
}

// Загрузка данных
async function loadData() {
    try {
        const providersRes = await fetch(`${CONFIG.API_URL}/ai/providers`);
        const providersData = await providersRes.json();
        state.aiProviders = providersData.providers;

        const recommended = state.aiProviders.find(p => p.recommended && p.available);
        if (recommended) {
            state.projectConfig.ai_settings.provider = recommended.id;
        }

        await loadExamples();
        await loadUserProjects();

    } catch (error) {
        console.error('Ошибка загрузки:', error);
    }
}

async function loadExamples() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/examples`);
        const data = await res.json();
        state.examples = data.examples;
        renderExamples();
    } catch (error) {
        console.error('Ошибка загрузки примеров:', error);
    }
}

async function loadUserProjects() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/projects?user_id=${state.user.id}`);
        const data = await res.json();
        renderProjects(data.projects);
    } catch (error) {
        console.error('Ошибка загрузки проектов:', error);
    }
}

// Рендер примеров
function renderExamples() {
    const container = document.getElementById('examples-grid');
    container.innerHTML = state.examples.map(example => `
        <div class="example-card" onclick="useExample('${example.id}')">
            <div class="icon">${example.icon}</div>
            <h3>${example.title}</h3>
            <p>${example.description}</p>
        </div>
    `).join('');
}

// Рендер проектов
function renderProjects(projects) {
    const container = document.getElementById('projects-list');

    if (!projects || projects.length === 0) {
        container.innerHTML = '<p class="empty-state">Пока нет проектов. Создайте первый!</p>';
        return;
    }

    const icons = { api: '🔌', bot: '🤖', frontend: '🎨', scraper: '🔍', fullstack: '⚡', cli: '⌨️' };

    container.innerHTML = projects.map(project => `
        <div class="project-item" onclick="viewProject('${project.id}')">
            <div class="project-icon">${icons[project.config?.type] || '📦'}</div>
            <div class="project-info">
                <h4>${project.config?.name || 'Без названия'}</h4>
                <p>${project.config?.type || 'unknown'} • ${formatDate(project.created_at)}</p>
            </div>
            <span class="project-status status-${project.status}">${project.status}</span>
        </div>
    `).join('');
}

// Использовать пример
function useExample(exampleId) {
    const example = state.examples.find(e => e.id === exampleId);
    if (!example) return;

    state.projectConfig = {
        ...state.projectConfig,
        ...example.config_preview,
        name: example.title.replace(/[^\w\s]/g, '').trim(),
        description: example.description
    };

    state.currentStep = 4;
    openWizard();
}

// Мастер создания проекта
function openWizard() {
    showScreen('wizard-screen');
    updateWizardStep();
    renderAIProviders();
}

function updateWizardStep() {
    document.querySelectorAll('.step-indicator').forEach((el, idx) => {
        el.classList.toggle('active', idx + 1 === state.currentStep);
    });

    document.querySelectorAll('.wizard-step').forEach((el, idx) => {
        el.classList.toggle('active', idx + 1 === state.currentStep);
    });

    if (state.currentStep === 4) {
        updateSummary();
    }
}

function updateSummary() {
    const container = document.getElementById('config-summary');
    const typeNames = { api: 'REST API', bot: 'Бот', frontend: 'Frontend', scraper: 'Парсер', fullstack: 'Fullstack', cli: 'CLI' };

    container.innerHTML = `
        <div class="summary-item">
            <span>Название:</span>
            <strong>${state.projectConfig.name || 'Не указано'}</strong>
        </div>
        <div class="summary-item">
            <span>Тип:</span>
            <strong>${typeNames[state.projectConfig.type]}</strong>
        </div>
        <div class="summary-item">
            <span>Функций:</span>
            <strong>${state.projectConfig.features.length}</strong>
        </div>
        <div class="summary-item">
            <span>База данных:</span>
            <strong>${state.projectConfig.database}</strong>
        </div>
        <div class="summary-item">
            <span>AI провайдер:</span>
            <strong>${state.aiProviders.find(p => p.id === state.projectConfig.ai_settings.provider)?.name || 'Auto'}</strong>
        </div>
    `;
}

// Рендер AI провайдеров
function renderAIProviders() {
    const container = document.getElementById('ai-providers');

    container.innerHTML = state.aiProviders.map(provider => `
        <div class="ai-provider-card ${provider.available ? '' : 'unavailable'} ${provider.id === state.projectConfig.ai_settings.provider ? 'selected' : ''}" 
             onclick="${provider.available ? `selectAIProvider('${provider.id}')` : ''}">
            <div class="provider-icon">
                ${provider.id === 'groq' ? '⚡' : provider.id === 'gemini' ? '🧠' : provider.id === 'openai' ? '🔮' : '📦'}
            </div>
            <div class="provider-info">
                <span class="provider-name">${provider.name}</span>
                <span class="provider-meta">${provider.speed} • ${provider.limits}</span>
            </div>
            ${provider.recommended ? '<span class="provider-badge badge-recommended">Рекомендуем</span>' : ''}
            ${!provider.available ? '<span class="provider-badge badge-paid">Нет ключа</span>' : 
              provider.cost === 'Бесплатно' ? '<span class="provider-badge badge-free">Бесплатно</span>' : 
              '<span class="provider-badge badge-paid">Платно</span>'}
        </div>
    `).join('');

    updateModelsList();
}

function selectAIProvider(providerId) {
    state.projectConfig.ai_settings.provider = providerId;
    renderAIProviders();
    updateModelsList();
}

function updateModelsList() {
    const provider = state.aiProviders.find(p => p.id === state.projectConfig.ai_settings.provider);
    const select = document.getElementById('ai-model');
    const group = document.getElementById('model-select-group');

    if (!provider || provider.models.length <= 1) {
        group.style.display = 'none';
        return;
    }

    group.style.display = 'block';
    select.innerHTML = `
        <option value="">Автовыбор (${provider.default_model})</option>
        ${provider.models.map(m => `<option value="${m}">${m}</option>`).join('')}
    `;
}

// Создание проекта
async function createProject() {
    if (!validateConfig()) return;

    showScreen('generating-screen');
    updateGeneratingStatus('analyze', 'active');

    try {
        const response = await fetch(`${CONFIG.API_URL}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: state.user.id,
                config: state.projectConfig
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.detail || 'Ошибка создания');
        }

        await simulateProgress();
        const project = await pollProjectStatus(data.project_id);
        showResult(project);

    } catch (error) {
        console.error('Ошибка:', error);
        alert(error.message);
        showScreen('main-screen');
    }
}

async function simulateProgress() {
    const steps = [
        { id: 'analyze', delay: 2000, next: 'architecture' },
        { id: 'architecture', delay: 3000, next: 'code' },
        { id: 'code', delay: 5000, next: 'deploy' },
        { id: 'deploy', delay: 4000, next: null }
    ];

    for (const step of steps) {
        await new Promise(r => setTimeout(r, step.delay));

        const el = document.getElementById(`step-${step.id}`);
        if (el) {
            el.classList.add('completed');
            el.classList.remove('active');
        }

        if (step.next) {
            const nextEl = document.getElementById(`step-${step.next}`);
            if (nextEl) nextEl.classList.add('active');
        }

        updateGeneratingStatus(step.id, 'completed');
    }
}

async function pollProjectStatus(projectId) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`${CONFIG.API_URL}/projects/${projectId}?user_id=${state.user.id}`);
    return await res.json();
}

function updateGeneratingStatus(step, status) {
    const messages = {
        analyze: 'Анализируем требования...',
        architecture: 'Проектируем архитектуру...',
        code: 'Генерируем код...',
        deploy: 'Деплоим на сервер...'
    };

    const el = document.getElementById('generating-status');
    if (el) el.textContent = messages[step] || 'Обработка...';
}

// Показ результата
function showResult(project) {
    showScreen('result-screen');

    document.getElementById('result-name').textContent = project.config.name;
    document.getElementById('result-deploy-url').href = project.deploy_url || '#';
    document.getElementById('deploy-url-text').textContent = project.deploy_url || 'Не развёрнут';
    document.getElementById('result-github-url').href = project.github_url || '#';

    const filesContainer = document.getElementById('files-list');
    const files = Object.keys(project.files || {});
    filesContainer.innerHTML = files.map(f => `<span class="file-tag">${f}</span>`).join('');
}

// Валидация
function validateConfig() {
    if (!state.projectConfig.name.trim()) {
        alert('Введите название проекта');
        state.currentStep = 1;
        updateWizardStep();
        return false;
    }

    if (!state.projectConfig.description.trim()) {
        alert('Введите описание проекта');
        state.currentStep = 1;
        updateWizardStep();
        return false;
    }

    return true;
}

// Навигация
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('create-project-btn').addEventListener('click', () => {
        state.currentStep = 1;
        state.projectConfig = getDefaultConfig();
        openWizard();
    });

    document.getElementById('refresh-examples').addEventListener('click', loadExamples);
    document.getElementById('wizard-back').addEventListener('click', () => showScreen('main-screen'));

    document.querySelectorAll('.btn-next').forEach(btn => {
        btn.addEventListener('click', () => {
            state.currentStep = parseInt(btn.dataset.next);
            updateWizardStep();
        });
    });

    document.querySelectorAll('.btn-prev').forEach(btn => {
        btn.addEventListener('click', () => {
            state.currentStep = parseInt(btn.dataset.prev);
            updateWizardStep();
        });
    });

    document.querySelectorAll('.type-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            state.projectConfig.type = card.dataset.value;

            const frontendSection = document.getElementById('frontend-section');
            frontendSection.style.display = card.dataset.value === 'fullstack' ? 'block' : 'none';
        });
    });

    document.getElementById('project-name').addEventListener('input', (e) => {
        state.projectConfig.name = e.target.value;
    });

    document.getElementById('project-description').addEventListener('input', (e) => {
        state.projectConfig.description = e.target.value;
    });

    document.getElementById('add-feature').addEventListener('click', addFeature);

    document.querySelectorAll('.quick-tags .tag').forEach(tag => {
        tag.addEventListener('click', () => {
            document.getElementById('feature-name').value = tag.dataset.feature;
            document.getElementById('feature-desc').focus();
        });
    });

    document.querySelectorAll('#database-select .tech-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('#database-select .tech-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            state.projectConfig.database = card.dataset.value;
        });
    });

    document.querySelectorAll('#frontend-select .tech-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('#frontend-select .tech-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            state.projectConfig.frontend = card.dataset.value;
        });
    });

    ['auth', 'admin', 'docs', 'tests', 'docker'].forEach(opt => {
        document.getElementById(`opt-${opt}`).addEventListener('change', (e) => {
            const key = opt === 'auth' ? 'authentication' : opt === 'admin' ? 'admin_panel' : opt === 'docs' ? 'api_documentation' : opt;
            state.projectConfig[key] = e.target.checked;
        });
    });

    document.getElementById('ai-temperature').addEventListener('input', (e) => {
        const val = e.target.value / 100;
        state.projectConfig.ai_settings.temperature = val;
        document.getElementById('temp-value').textContent = val.toFixed(1);
    });

    document.getElementById('ai-model').addEventListener('change', (e) => {
        state.projectConfig.ai_settings.model = e.target.value || null;
    });

    document.querySelectorAll('input[name="deploy"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            state.projectConfig.auto_deploy = e.target.value === 'render';
            document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('active'));
            e.target.closest('.radio-card').classList.add('active');
        });
    });

    document.getElementById('create-final-btn').addEventListener('click', createProject);

    document.getElementById('new-project-btn').addEventListener('click', () => {
        state.currentStep = 1;
        state.projectConfig = getDefaultConfig();
        openWizard();
    });

    document.getElementById('view-projects-btn').addEventListener('click', () => {
        showScreen('main-screen');
        loadUserProjects();
    });
}

// Добавление функции
function addFeature() {
    const name = document.getElementById('feature-name').value.trim();
    const desc = document.getElementById('feature-desc').value.trim();
    const priority = document.getElementById('feature-priority').value;

    if (!name) {
        alert('Введите название функции');
        return;
    }

    state.projectConfig.features.push({ name, description: desc, priority });
    renderFeatures();

    document.getElementById('feature-name').value = '';
    document.getElementById('feature-desc').value = '';
}

function renderFeatures() {
    const container = document.getElementById('features-list');

    if (state.projectConfig.features.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = state.projectConfig.features.map((f, idx) => `
        <div class="feature-item">
            <span class="feature-priority priority-${f.priority}">${f.priority}</span>
            <div style="flex: 1;">
                <div class="feature-name">${f.name}</div>
                ${f.description ? `<div class="feature-desc">${f.description}</div>` : ''}
            </div>
            <button class="btn-delete" onclick="removeFeature(${idx})">🗑️</button>
        </div>
    `).join('');
}

function removeFeature(index) {
    state.projectConfig.features.splice(index, 1);
    renderFeatures();
}

// Утилиты
function getDefaultConfig() {
    return {
        name: '',
        description: '',
        type: 'api',
        features: [],
        database: 'none',
        frontend: 'none',
        authentication: false,
        admin_panel: false,
        api_documentation: true,
        tests: false,
        docker: false,
        ai_settings: {
            provider: state.aiProviders.find(p => p.recommended && p.available)?.id || 'mock',
            model: null,
            temperature: 0.7,
            max_tokens: 4000
        },
        auto_deploy: true,
        platform: 'render'
    };
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function viewProject(projectId) {
    console.log('View project:', projectId);
}
