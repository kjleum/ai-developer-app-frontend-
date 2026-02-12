// AI Developer Platform v4.0 - Frontend
const CONFIG = {
    API_URL: 'https://ai-developer-api.onrender.com' // Замените на ваш URL
};

// Состояние приложения
const state = {
    user: null,
    currentStep: 1,
    projectConfig: {
        type: '',
        name: '',
        description: '',
        features: [],
        database: 'postgresql',
        ai_provider: ''
    },
    providers: [],
    examples: []
};

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    loadData();
    setupEventListeners();
});

function initTelegram() {
    if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        tg.setHeaderColor('#0a0a1a');
        tg.setBackgroundColor('#0a0a1a');

        state.user = {
            id: tg.initDataUnsafe?.user?.id?.toString() || 'demo_' + Date.now(),
            username: tg.initDataUnsafe?.user?.username || 'demo'
        };
    } else {
        state.user = { id: 'web_' + Date.now(), username: 'web_user' };
    }
}

async function loadData() {
    await Promise.all([
        loadProviders(),
        loadExamples(),
        loadProjects()
    ]);
}

async function loadProviders() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/ai/providers`);
        const data = await res.json();
        state.providers = data.providers || [];
        renderProviders();
        document.getElementById('ai-count').textContent = 
            state.providers.filter(p => p.available).length + '+';
    } catch (e) {
        console.error('Failed to load providers:', e);
    }
}

function renderProviders() {
    const container = document.getElementById('providers-list');
    if (!container) return;

    const available = state.providers.filter(p => p.available);

    container.innerHTML = available.slice(0, 4).map(p => `
        <div class="provider-card available">
            <div class="provider-name">${p.name}</div>
            <div class="provider-status">${p.speed}</div>
        </div>
    `).join('') || '<p class="empty-state">Нет доступных провайдеров</p>';
}

async function loadExamples() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/examples`);
        const data = await res.json();
        state.examples = data.examples || [];
        renderExamples();
    } catch (e) {
        console.error('Failed to load examples:', e);
    }
}

function renderExamples() {
    const container = document.getElementById('examples-grid');
    if (!container) return;

    container.innerHTML = state.examples.map(ex => `
        <div class="example-card" onclick="useExample('${ex.id}')">
            <h3>${ex.icon} ${ex.title}</h3>
            <p>${ex.description}</p>
        </div>
    `).join('');
}

async function loadProjects() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/projects?user_id=${state.user.id}`);
        const data = await res.json();
        renderProjects(data.projects || []);
    } catch (e) {
        console.error('Failed to load projects:', e);
    }
}

function renderProjects(projects) {
    const container = document.getElementById('projects-list');
    if (!container) return;

    if (projects.length === 0) {
        container.innerHTML = '<p class="empty-state">Нет проектов. Создайте первый!</p>';
        return;
    }

    container.innerHTML = projects.map(p => `
        <div class="project-item" onclick="viewProject('${p.id}')">
            <div class="project-icon">📦</div>
            <div class="project-info">
                <h4>${p.config?.name || 'Без названия'}</h4>
                <p>${p.status} • ${new Date(p.created_at).toLocaleDateString()}</p>
            </div>
        </div>
    `).join('');
}

// Navigation
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    window.scrollTo(0, 0);
}

// Wizard
function openWizard() {
    state.currentStep = 1;
    state.projectConfig = { type: '', name: '', description: '', features: [], database: 'postgresql', ai_provider: '' };
    updateWizardStep();
    showScreen('wizard-screen');
}

function selectProjectType(type) {
    state.projectConfig.type = type;
    document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.type-card[data-type="${type}"]`)?.classList.add('selected');
}

function updateWizardStep() {
    document.querySelectorAll('.step').forEach((s, i) => {
        s.classList.toggle('active', i + 1 === state.currentStep);
    });

    document.querySelectorAll('.wizard-step-content').forEach((c, i) => {
        c.classList.toggle('active', i + 1 === state.currentStep);
    });

    document.getElementById('prev-step').style.display = state.currentStep > 1 ? 'block' : 'none';
    document.getElementById('next-step').textContent = state.currentStep === 4 ? '✨ Создать' : 'Далее →';
}

function nextStep() {
    if (state.currentStep === 1 && !state.projectConfig.type) {
        alert('Выберите тип проекта');
        return;
    }
    if (state.currentStep === 2) {
        state.projectConfig.name = document.getElementById('project-name').value;
        state.projectConfig.description = document.getElementById('project-description').value;
        if (!state.projectConfig.name || !state.projectConfig.description) {
            alert('Заполните название и описание');
            return;
        }
    }

    if (state.currentStep < 4) {
        state.currentStep++;
        updateWizardStep();
        if (state.currentStep === 4) updateSummary();
    } else {
        createProject();
    }
}

function prevStep() {
    if (state.currentStep > 1) {
        state.currentStep--;
        updateWizardStep();
    }
}

function updateSummary() {
    const summary = document.getElementById('project-summary');
    if (summary) {
        summary.innerHTML = `
            <div class="summary-item"><span>Тип:</span> <strong>${state.projectConfig.type}</strong></div>
            <div class="summary-item"><span>Название:</span> <strong>${state.projectConfig.name}</strong></div>
            <div class="summary-item"><span>Функций:</span> <strong>${state.projectConfig.features.length}</strong></div>
            <div class="summary-item"><span>База данных:</span> <strong>${state.projectConfig.database}</strong></div>
        `;
    }
}

function addFeature() {
    const name = document.getElementById('feature-name').value;
    const priority = document.getElementById('feature-priority').value;

    if (name) {
        state.projectConfig.features.push({ name, priority });
        renderFeatures();
        document.getElementById('feature-name').value = '';
    }
}

function quickAddFeature(name) {
    state.projectConfig.features.push({ name, priority: 'should' });
    renderFeatures();
}

function renderFeatures() {
    const container = document.getElementById('features-list');
    if (!container) return;

    container.innerHTML = state.projectConfig.features.map((f, i) => `
        <div class="feature-item">
            <span class="feature-priority ${f.priority}">${f.priority}</span>
            <span class="feature-name">${f.name}</span>
            <button class="feature-delete" onclick="removeFeature(${i})">×</button>
        </div>
    `).join('');
}

function removeFeature(index) {
    state.projectConfig.features.splice(index, 1);
    renderFeatures();
}

async function createProject() {
    showScreen('generating-screen');

    try {
        const res = await fetch(`${CONFIG.API_URL}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: state.user.id,
                config: state.projectConfig
            })
        });

        const data = await res.json();

        if (data.success) {
            // Симулируем прогресс
            await simulateProgress();
            showResult(data.project_id);
        } else {
            throw new Error(data.detail || 'Failed to create project');
        }
    } catch (e) {
        alert('Ошибка: ' + e.message);
        showScreen('main-screen');
    }
}

async function simulateProgress() {
    const steps = ['analyze', 'architecture', 'code', 'deploy'];
    const delays = [1500, 2000, 4000, 3000];

    for (let i = 0; i < steps.length; i++) {
        document.querySelectorAll('.progress-step').forEach((s, j) => {
            if (j < i) s.classList.add('completed');
            else if (j === i) s.classList.add('active');
        });
        await new Promise(r => setTimeout(r, delays[i]));
    }
}

async function showResult(projectId) {
    showScreen('result-screen');

    try {
        const res = await fetch(`${CONFIG.API_URL}/projects/${projectId}?user_id=${state.user.id}`);
        const project = await res.json();

        document.getElementById('result-project-name').textContent = project.config?.name || 'Project';

        if (project.deploy_url) {
            document.getElementById('result-deploy-url').href = project.deploy_url;
            document.getElementById('deploy-url-text').textContent = project.deploy_url;
        }
        if (project.github_url) {
            document.getElementById('result-github-url').href = project.github_url;
        }

        const files = Object.keys(project.files || {});
        document.getElementById('files-list').innerHTML = files.map(f => 
            `<span class="file-tag">${f}</span>`
        ).join('');
    } catch (e) {
        console.error('Failed to load project:', e);
    }
}

function useExample(exampleId) {
    const example = state.examples.find(e => e.id === exampleId);
    if (example) {
        state.projectConfig = { ...state.projectConfig, ...example.config_preview };
        state.projectConfig.name = example.title;
        state.projectConfig.description = example.description;
        openWizard();
    }
}

async function viewProject(projectId) {
    showResult(projectId);
}

// Chat
function openChat() {
    showScreen('chat-screen');
}

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    addChatMessage(message, 'user');
    input.value = '';

    try {
        const res = await fetch(`${CONFIG.API_URL}/ai/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: message,
                provider: document.getElementById('chat-provider')?.value || null
            })
        });

        const data = await res.json();
        if (data.success) {
            addChatMessage(data.response, 'assistant');
        }
    } catch (e) {
        addChatMessage('Ошибка: ' + e.message, 'system');
    }
}

function addChatMessage(text, role) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Media
function openMedia() {
    showScreen('media-screen');
}

function switchMediaTab(tab) {
    document.querySelectorAll('.media-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.media-content').forEach(c => c.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`media-${tab}`).classList.add('active');
}

async function generateImage() {
    const prompt = document.getElementById('image-prompt').value;
    if (!prompt) return;

    const resultDiv = document.getElementById('image-result');
    resultDiv.innerHTML = '<p>Генерация...</p>';

    try {
        const res = await fetch(`${CONFIG.API_URL}/media/image/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        const data = await res.json();
        if (data.success && data.images?.[0]) {
            resultDiv.innerHTML = `<img src="data:image/png;base64,${data.images[0]}" alt="Generated">`;
        }
    } catch (e) {
        resultDiv.innerHTML = `<p class="error">Ошибка: ${e.message}</p>`;
    }
}

async function textToSpeech() {
    const text = document.getElementById('tts-text').value;
    if (!text) return;

    const resultDiv = document.getElementById('audio-result');
    resultDiv.innerHTML = '<p>Генерация...</p>';

    try {
        const res = await fetch(`${CONFIG.API_URL}/media/audio/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        const data = await res.json();
        if (data.success && data.audio) {
            resultDiv.innerHTML = `<audio controls src="data:audio/wav;base64,${data.audio}"></audio>`;
        }
    } catch (e) {
        resultDiv.innerHTML = `<p class="error">Ошибка: ${e.message}</p>`;
    }
}

// Agents
function openAgents() {
    showScreen('agents-screen');
    loadAgents();
}

async function loadAgents() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/agents`);
        const data = await res.json();

        const container = document.getElementById('agents-list');
        container.innerHTML = data.agents.map(a => `
            <div class="agent-card" onclick="runAgent('${a.id}')">
                <div class="agent-avatar">🤖</div>
                <div class="agent-name">${a.name}</div>
                <div class="agent-desc">${a.description}</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load agents:', e);
    }
}

async function runAgent(agentId) {
    const input = prompt('Введите задачу для агента:');
    if (!input) return;

    try {
        const res = await fetch(`${CONFIG.API_URL}/agents/${agentId}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input })
        });

        const data = await res.json();
        alert(`Агент ${data.agent} ответил:

${data.response}`);
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// RAG
function openRAG() {
    showScreen('rag-screen');
}

async function sendRAGMessage() {
    const input = document.getElementById('rag-input');
    const message = input.value.trim();
    if (!message) return;

    addRAGMessage(message, 'user');
    input.value = '';

    try {
        const res = await fetch(`${CONFIG.API_URL}/rag/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'default', query: message })
        });

        const data = await res.json();
        if (data.success) {
            addRAGMessage(data.answer, 'assistant');
        }
    } catch (e) {
        addRAGMessage('Ошибка: ' + e.message, 'system');
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

// NLP
function openNLP() {
    showScreen('nlp-screen');
}

async function executeNLP(command) {
    document.getElementById('nlp-input').value = command;
    sendNLPMessage();
}

async function sendNLPMessage() {
    const input = document.getElementById('nlp-input');
    const message = input.value.trim();
    if (!message) return;

    addNLPMessage(message, 'user');
    input.value = '';

    try {
        const res = await fetch(`${CONFIG.API_URL}/nlp/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: message, user_id: state.user.id })
        });

        const data = await res.json();
        if (data.success) {
            addNLPMessage(JSON.stringify(data.result, null, 2), 'assistant');
        } else {
            addNLPMessage(data.result?.answer || 'Не удалось выполнить команду', 'assistant');
        }
    } catch (e) {
        addNLPMessage('Ошибка: ' + e.message, 'system');
    }
}

function addNLPMessage(text, role) {
    const container = document.getElementById('nlp-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.style.whiteSpace = 'pre-wrap';
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('refresh-providers')?.addEventListener('click', loadProviders);
    document.getElementById('refresh-examples')?.addEventListener('click', loadExamples);
    document.getElementById('refresh-projects')?.addEventListener('click', loadProjects);

    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    document.getElementById('rag-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendRAGMessage();
    });

    document.getElementById('nlp-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendNLPMessage();
    });
}
