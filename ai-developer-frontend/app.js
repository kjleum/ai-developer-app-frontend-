// Telegram Mini App логика
const tg = window.Telegram.WebApp;

// Конфигурация API
const API_URL = https://ai-developer-api.onrender.com; // Заменишь на свой URL после деплоя backend

// Инициализация
tg.ready();
tg.expand();

// Состояние приложения
const state = {
    userId: tg.initDataUnsafe?.user?.id?.toString() || 'test_user',
    currentProject: null,
    projects: []
};

// DOM элементы
const screens = {
    main: document.getElementById('main-screen'),
    creating: document.getElementById('creating-screen'),
    result: document.getElementById('result-screen'),
    projects: document.getElementById('projects-screen')
};

// Навигация
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');

    // Обновляем нижнюю навигацию
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.screen === screenName + '-screen');
    });
}

// Обработчики навигации
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const screen = btn.dataset.screen.replace('-screen', '');
        if (screen === 'projects') loadProjects();
        showScreen(screen);
    });
});

document.getElementById('back-btn').addEventListener('click', () => {
    showScreen('main');
});

// Выбор примера
document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.getElementById('project-input').value = chip.dataset.text;
    });
});

// Создание проекта
document.getElementById('create-btn').addEventListener('click', createProject);

async function createProject() {
    const description = document.getElementById('project-input').value.trim();
    if (!description) {
        tg.showAlert('Опиши проект');
        return;
    }

    const btn = document.getElementById('create-btn');
    const btnText = btn.querySelector('.btn-text');
    const btnLoading = btn.querySelector('.btn-loading');

    // UI: начало создания
    btn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
    showScreen('creating');

    // Прогресс
    updateProgress(1, 'Анализирую задачу...');

    try {
        // Отправка запроса
        const response = await fetch(`${API_URL}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: description,
                user_id: state.userId,
                project_name: description.slice(0, 30) + '...'
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.detail || 'Ошибка создания');
        }

        state.currentProject = data;

        // Симуляция прогресса (в реальности polling статуса)
        await simulateProgress();

        // Показываем результат
        showResult(data);

    } catch (error) {
        console.error('Error:', error);
        tg.showAlert('Ошибка: ' + error.message);
        showScreen('main');
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoading.classList.add('hidden');
    }
}

// Симуляция прогресса (пока backend работает)
async function simulateProgress() {
    const steps = [
        { step: 1, text: 'Анализирую задачу...', delay: 2000 },
        { step: 2, text: 'Генерирую код...', delay: 3000 },
        { step: 3, text: 'Деплою на сервер...', delay: 4000 },
        { step: 4, text: 'Почти готово...', delay: 2000 }
    ];

    for (const s of steps) {
        updateProgress(s.step, s.text);
        await sleep(s.delay);
    }
}

function updateProgress(step, text) {
    const percent = (step / 4) * 100;
    document.getElementById('progress-fill').style.width = percent + '%';
    document.getElementById('progress-log').textContent = text;

    document.querySelectorAll('.step').forEach((el, idx) => {
        el.classList.toggle('active', idx < step);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Показ результата
function showResult(data) {
    document.getElementById('result-name').textContent = data.architecture?.type || 'Проект';
    document.getElementById('result-type').textContent = `Тип: ${data.architecture?.description || 'Приложение'}`;
    document.getElementById('result-link').value = data.url || 'Создается...';
    document.getElementById('visit-btn').href = data.url || '#';

    showScreen('result');

    // Уведомление в Telegram
    tg.showPopup({
        title: 'Готово! 🎉',
        message: `Проект создан: ${data.architecture?.type}`,
        buttons: [{ id: 'ok', text: 'Отлично', type: 'default' }]
    });
}

// Копирование ссылки
document.getElementById('copy-btn').addEventListener('click', () => {
    const link = document.getElementById('result-link');
    link.select();
    document.execCommand('copy');
    tg.showAlert('Ссылка скопирована!');
});

// Обновление проекта
document.getElementById('update-btn').addEventListener('click', async () => {
    const feedback = document.getElementById('feedback-input').value.trim();
    if (!feedback) {
        tg.showAlert('Опиши что изменить');
        return;
    }

    if (!state.currentProject) {
        tg.showAlert('Нет активного проекта');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: state.currentProject.project_id,
                feedback: feedback,
                user_id: state.userId
            })
        });

        const data = await response.json();

        if (data.success) {
            tg.showAlert('Проект обновлен!');
            document.getElementById('result-link').value = data.url;
            document.getElementById('visit-btn').href = data.url;
        } else {
            throw new Error(data.detail);
        }
    } catch (error) {
        tg.showAlert('Ошибка: ' + error.message);
    }
});

// Загрузка списка проектов
async function loadProjects() {
    try {
        const response = await fetch(`${API_URL}/projects/${state.userId}`);
        const data = await response.json();

        state.projects = data.projects || [];
        renderProjects();
    } catch (error) {
        console.error('Error loading projects:', error);
        document.getElementById('projects-list').innerHTML = 
            '<p style="text-align: center; color: var(--tg-hint);">Ошибка загрузки</p>';
    }
}

function renderProjects() {
    const container = document.getElementById('projects-list');

    if (state.projects.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--tg-hint);">Нет проектов</p>';
        return;
    }

    container.innerHTML = state.projects.map(p => `
        <div class="project-item" data-id="${p.id}">
            <h4>${p.name}</h4>
            <div class="meta">
                <span class="status-badge status-${p.status}">${getStatusText(p.status)}</span>
                <span>${new Date(p.created_at).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');

    // Клик по проекту
    document.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('click', () => {
            const project = state.projects.find(p => p.id === item.dataset.id);
            if (project) {
                state.currentProject = project;
                showResult(project);
            }
        });
    });
}

function getStatusText(status) {
    const map = {
        'live': 'Работает',
        'error': 'Ошибка',
        'creating': 'Создается',
        'generating': 'Генерация'
    };
    return map[status] || status;
}

// Проверка статуса проекта (polling)
async function checkProjectStatus(projectId) {
    try {
        const response = await fetch(`${API_URL}/status/${projectId}?user_id=${state.userId}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Status check error:', error);
        return null;
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    console.log('AI Developer Mini App загружен');
    console.log('User ID:', state.userId);
});

// Обработка свайпов для навигации
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
});

document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
});

function handleSwipe() {
    const swipeThreshold = 50;
    const diff = touchStartX - touchEndX;

    if (Math.abs(diff) > swipeThreshold) {
        const currentScreen = document.querySelector('.screen.active').id;
        if (diff > 0 && currentScreen === 'main-screen') {
            // Свайп влево - на проекты
            showScreen('projects');
        } else if (diff < 0 && currentScreen === 'projects-screen') {
            // Свайп вправо - на главную
            showScreen('main');
        }
    }
}
