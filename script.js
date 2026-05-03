const STORAGE_KEYS = {
    PROGRESS: 'trainer_progress',
    ACTIVE_ID: 'trainer_active_id',
    MODE: 'trainer_mode',
    VOCABULARY: 'trainer_vocabulary',
    RECORDED_WORDS: 'trainer_recorded_words'
};

let fileTexts = [];

function getAllTexts() {
    return fileTexts;
}
function loadFromStorage(key, fallback) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : fallback;
    } catch { return fallback; }
}

function saveToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function ruTextCountLabel(n) {
    const x = Math.abs(Number(n)) || 0;
    const m10 = x % 10;
    const m100 = x % 100;
    if (m100 >= 11 && m100 <= 14) return `${x} текстов`;
    if (m10 === 1) return `${x} текст`;
    if (m10 >= 2 && m10 <= 4) return `${x} текста`;
    return `${x} текстов`;
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

function hashArray(arr) {
    const str = JSON.stringify(arr.map(s => `${s.ru}|${s.en}`));
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(36);
}

function normalizeTextName(name) {
    return String(name || '').trim().toLowerCase();
}

function getProgressKey(text) {
    return normalizeTextName(text?.name);
}

function migrateProgressToTextNames(textItems, progressMap) {
    const nextProgress = { ...(progressMap || {}) };
    const textById = new Map(textItems.map(text => [text.id, text]));
    let changed = false;

    Object.keys(nextProgress).forEach((key) => {
        if (textById.has(key)) {
            const text = textById.get(key);
            const nameKey = getProgressKey(text);
            if (nameKey && !nextProgress[nameKey]) {
                nextProgress[nameKey] = nextProgress[key];
            }
            delete nextProgress[key];
            changed = true;
        }
    });

    return { progress: nextProgress, changed };
}

function slugFromContentFilename(name) {
    const base = String(name || '').replace(/\.json$/i, '').trim();
    const slug = base.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_|_$/g, '');
    return slug || 'file';
}

function normalizeChaptersFromEntries(entries, slug, collectionHeading, collectionId) {
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry, index) => {
            const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
            const sentences = Array.isArray(entry?.sentences)
                ? entry.sentences.filter(item => typeof item?.ru === 'string' && typeof item?.en === 'string')
                : [];
            if (!title || !sentences.length) return null;
            const content = sentences.map(sentence => ({ ru: sentence.ru.trim(), en: sentence.en.trim() }))
                .filter(sentence => sentence.ru && sentence.en);
            if (!content.length) return null;
            return {
                id: `default_${slug}_${String(index + 1).padStart(3, '0')}`,
                name: title,
                content,
                hash: hashArray(content),
                collectionHeading,
                collectionId
            };
        })
        .filter(Boolean);
}

async function loadContentTexts() {
    try {
        const manifestRes = await fetch('./content/manifest.json', { cache: 'no-store' });
        if (!manifestRes.ok) return [];
        const manifest = await manifestRes.json();
        if (!Array.isArray(manifest)) return [];
        const all = [];
        for (const file of manifest) {
            if (typeof file !== 'string' || !file.trim().toLowerCase().endsWith('.json')) continue;
            const safeFile = file.replace(/^.*[\\/]/, '');
            const slug = slugFromContentFilename(safeFile);
            const res = await fetch(`./content/${encodeURIComponent(safeFile)}`, { cache: 'no-store' });
            if (!res.ok) continue;
            const data = await res.json();
            let entries;
            let collectionHeading;
            if (Array.isArray(data)) {
                entries = data;
                collectionHeading = safeFile.replace(/\.json$/i, '') || slug;
            } else if (data && typeof data === 'object' && Array.isArray(data.items)) {
                entries = data.items;
                const h = typeof data.heading === 'string' ? data.heading.trim() : '';
                collectionHeading = h || safeFile.replace(/\.json$/i, '') || slug;
            } else {
                continue;
            }
            const collId = `content_${slug}`;
            all.push(...normalizeChaptersFromEntries(entries, slug, collectionHeading, collId));
        }
        return all;
    } catch {
        return [];
    }
}

async function initStorage() {
    try {
        localStorage.removeItem('trainer_texts');
    } catch (_) {}
    fileTexts = await loadContentTexts();
    const all = getAllTexts();
    if (all.length && !loadFromStorage(STORAGE_KEYS.ACTIVE_ID, '')) {
        saveToStorage(STORAGE_KEYS.ACTIVE_ID, all[0].id);
    }

    const savedProgress = loadFromStorage(STORAGE_KEYS.PROGRESS, {});
    const migrationResult = migrateProgressToTextNames(all, savedProgress);
    if (migrationResult.changed) {
        saveToStorage(STORAGE_KEYS.PROGRESS, migrationResult.progress);
    }
}

let activeTextId = '';

const managerModal = document.getElementById('managerModal');
const textListEl = document.getElementById('textList');
let managerCollectionId = null;
const vocabularyModal = document.getElementById('vocabularyModal');
const vocabularyCountEl = document.getElementById('vocabularyCount');
const vocabularyListEl = document.getElementById('vocabularyList');
const openVocabularyBtn = document.getElementById('openVocabulary');
const clearStorageBtn = document.getElementById('clearStorageBtn');

document.getElementById('openManager').onclick = () => {
    activeTextId = loadFromStorage(STORAGE_KEYS.ACTIVE_ID, '');
    const groups = buildTextGroups(getAllTexts());
    if (groups.length > 1) {
        const activeText = getAllTexts().find((t) => t.id === activeTextId);
        const cid = activeText ? (activeText.collectionId ?? '__manual__') : null;
        managerCollectionId = cid && groups.some((g) => g.collectionId === cid) ? cid : null;
    } else {
        managerCollectionId = null;
    }
    renderTextList();
    managerModal.classList.add('open');
};

document.getElementById('closeModal').onclick = () => managerModal.classList.remove('open');
document.getElementById('closeVocabularyModal').onclick = () => vocabularyModal.classList.remove('open');

function getVocabularySet() {
    const words = loadFromStorage(STORAGE_KEYS.VOCABULARY, []);
    if (!Array.isArray(words)) return new Set();
    return new Set(words.filter(word => typeof word === 'string' && word.trim()).map(word => word.trim().toLowerCase()));
}

function saveVocabularySet(vocabularySet) {
    saveToStorage(STORAGE_KEYS.VOCABULARY, Array.from(vocabularySet).sort((a, b) => a.localeCompare(b)));
}

function extractWords(text) {
    return String(text || '').toLowerCase().match(/\p{L}+/gu) || [];
}

function updateVocabularyCount() {
    const vocabularySet = getVocabularySet();
    openVocabularyBtn.textContent = `Словарный запас: ${vocabularySet.size}`;
}

function addWordsToVocabulary(text) {
    const words = extractWords(text);
    if (!words.length) return;
    const vocabularySet = getVocabularySet();
    const sizeBefore = vocabularySet.size;
    words.forEach(word => vocabularySet.add(word));
    if (vocabularySet.size !== sizeBefore) {
        saveVocabularySet(vocabularySet);
        updateVocabularyCount();
    }
}

function renderVocabularyModal() {
    const words = Array.from(getVocabularySet()).sort((a, b) => a.localeCompare(b));
    vocabularyCountEl.textContent = `Уникальных слов: ${words.length}`;
    if (!words.length) {
        vocabularyListEl.innerHTML = '<p style="color: var(--text-muted); margin: 0;">Пока нет сохраненных слов.</p>';
        return;
    }
    vocabularyListEl.innerHTML = words.map(word => `<div class="en-sentence">${word}</div>`).join('');
}

openVocabularyBtn.onclick = () => {
    renderVocabularyModal();
    vocabularyModal.classList.add('open');
};

clearStorageBtn.onclick = async () => {
    const confirmed = window.confirm('Удалить сохранённый прогресс, словарь и режим? После перезагрузки снова подтянутся файлы из папки content.');
    if (!confirmed) return;

    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    try {
        localStorage.removeItem('trainer_texts');
    } catch (_) {}
    await initStorage();
    initTrainer();
    updateVocabularyCount();
    showToast('Данные очищены');
    if (managerModal.classList.contains('open')) {
        activeTextId = loadFromStorage(STORAGE_KEYS.ACTIVE_ID, '');
        managerCollectionId = null;
        renderTextList();
    }
};

function buildTextGroups(textsList) {
    const orderFirst = new Map();
    textsList.forEach((t, i) => {
        const cid = t.collectionId ?? '__manual__';
        if (!orderFirst.has(cid)) orderFirst.set(cid, i);
    });
    const byId = new Map();
    for (const t of textsList) {
        const cid = t.collectionId ?? '__manual__';
        if (!byId.has(cid)) {
            byId.set(cid, {
                collectionId: cid,
                collectionHeading: t.collectionHeading || '',
                texts: []
            });
        }
        byId.get(cid).texts.push(t);
    }
    return Array.from(byId.values()).sort((a, b) =>
        (orderFirst.get(a.collectionId) ?? 0) - (orderFirst.get(b.collectionId) ?? 0)
    );
}

function collectionLabel(group) {
    if (group.collectionId === '__manual__') return 'Добавлено вручную';
    return group.collectionHeading || 'Без названия';
}

function renderTextList() {
    const texts = getAllTexts();
    const migrationResult = migrateProgressToTextNames(texts, loadFromStorage(STORAGE_KEYS.PROGRESS, {}));
    const progress = migrationResult.progress;
    if (migrationResult.changed) {
        saveToStorage(STORAGE_KEYS.PROGRESS, progress);
    }
    textListEl.innerHTML = '';
    if (texts.length === 0) {
        textListEl.innerHTML = '<p style="text-align:center; color:var(--text-muted)">Нет текстов (проверьте manifest и папку content)</p>';
        return;
    }

    const groups = buildTextGroups(texts);
    const multiCollection = groups.length > 1;

    if (multiCollection && managerCollectionId === null) {
        groups.forEach((g, index) => {
            const label = collectionLabel(g);
            const div = document.createElement('div');
            div.className = 'collection-item';
            div.innerHTML = `
                <div class="text-info">
                    <h3>${index + 1}. ${escapeHtml(label)}</h3>
                    <p>${ruTextCountLabel(g.texts.length)}</p>
                </div>
                <div class="text-actions">
                    <button type="button" class="btn btn-sm btn-primary open-collection-btn" data-collection-id="${g.collectionId}">Открыть</button>
                </div>
            `;
            textListEl.appendChild(div);
        });
        textListEl.querySelectorAll('.open-collection-btn').forEach((btn) => {
            btn.onclick = (e) => {
                e.stopPropagation();
                managerCollectionId = btn.getAttribute('data-collection-id');
                renderTextList();
            };
        });
        return;
    }

    let activeGroup;
    if (!multiCollection) {
        activeGroup = groups[0];
    } else {
        activeGroup = groups.find((g) => g.collectionId === managerCollectionId);
        if (!activeGroup) {
            managerCollectionId = null;
            renderTextList();
            return;
        }
    }

    if (multiCollection) {
        const nav = document.createElement('div');
        nav.className = 'manager-nav';
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'btn btn-sm btn-secondary';
        backBtn.id = 'managerBackBtn';
        backBtn.textContent = '← Коллекции';
        backBtn.onclick = () => {
            managerCollectionId = null;
            renderTextList();
        };
        nav.appendChild(backBtn);
        textListEl.appendChild(nav);
    }

    activeGroup.texts.forEach((t, index) => {
        const total = t.content.length;
        const current = Math.min(progress[getProgressKey(t)]?.currentIndex ?? 0, total);
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const div = document.createElement('div');
        div.className = `text-item ${t.id === activeTextId ? 'active' : ''}`;
        div.innerHTML = `
            <div class="text-info">
                <h3>${index + 1}. ${escapeHtml(t.name)}</h3>
                <p>${total} предложений • Прогресс: ${current}/${total} (${percent}%)</p>
            </div>
            <div class="text-actions">
                <button type="button" class="btn btn-sm btn-primary load-text-btn" data-id="${t.id}">Загрузить</button>
            </div>
        `;
        textListEl.appendChild(div);
    });

    textListEl.querySelectorAll('.load-text-btn').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); selectText(btn.dataset.id); };
    });
}

function selectText(id) {
    saveToStorage(STORAGE_KEYS.ACTIVE_ID, id);
    activeTextId = id;
    initTrainer();
    managerModal.classList.remove('open');
    showToast('Текст загружен');
}

let currentContent = [];
let currentIndex = 0;
let furthestIndexReached = 0;
let isWaitingForGotIt = false;
let isFinished = false;
let trainingMode = loadFromStorage(STORAGE_KEYS.MODE, 'normal');
const enList = document.getElementById('enList');
const inputZone = document.querySelector('.input-zone');
const currentTask = document.getElementById('currentTask');
const positionBadge = document.getElementById('positionBadge');
const recordedWordDisplay = document.getElementById('recordedWordDisplay');
const sourceText = document.getElementById('sourceText');
const userInput = document.getElementById('userInput');
const checkBtn = document.getElementById('checkBtn');
const gotItBtn = document.getElementById('gotItBtn');
const feedback = document.getElementById('feedback');
const trainingModeEl = document.getElementById('trainingMode');
const isMobile = window.matchMedia('(max-width: 768px)');

function resolveTrainingMode(mode) {
    if (mode === 'hard') return 'hard';
    if (mode === 'easy' || mode === 'legion') return 'easy';
    return 'normal';
}

function normalize(str) {
    return str
        .toLowerCase()
        .replace(/[^\p{L}]+/gu, '');
}

function splitAnswerIntoWords(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function loadRecordedWordsStore() {
    const raw = loadFromStorage(STORAGE_KEYS.RECORDED_WORDS, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function saveRecordedWordsStore(store) {
    saveToStorage(STORAGE_KEYS.RECORDED_WORDS, store);
}

function getRecordedWordForIndex(textKey, index) {
    if (!textKey || index < 0) return '';
    const store = loadRecordedWordsStore();
    const perText = store[textKey];
    if (!perText || typeof perText !== 'object') return '';
    const w = perText[String(index)];
    return typeof w === 'string' ? w.trim() : '';
}

function setRecordedWordForCurrentSentence(w) {
    const activeText = getAllTexts().find(t => t.id === activeTextId);
    if (!activeText) return;
    const textKey = getProgressKey(activeText);
    const word = String(w || '').trim();
    const store = loadRecordedWordsStore();
    if (!store[textKey]) store[textKey] = {};
    if (word) {
        store[textKey][String(currentIndex)] = word;
    } else {
        delete store[textKey][String(currentIndex)];
        if (Object.keys(store[textKey]).length === 0) delete store[textKey];
    }
    saveRecordedWordsStore(store);
    updateRecordedWordDisplay();
}

function setRecordedWord(w) {
    setRecordedWordForCurrentSentence(w);
}

function updateRecordedWordDisplay() {
    if (!recordedWordDisplay) return;
    const activeText = getAllTexts().find(t => t.id === activeTextId);
    let word = '';
    if (
        activeText &&
        currentContent.length &&
        currentIndex >= 0 &&
        currentIndex < currentContent.length &&
        !isFinished
    ) {
        word = getRecordedWordForIndex(getProgressKey(activeText), currentIndex);
    }
    recordedWordDisplay.textContent = word;
    recordedWordDisplay.classList.toggle('has-word', Boolean(word));
}

function resizeUserInput() {
    userInput.style.height = 'auto';
    const nextHeight = Math.min(userInput.scrollHeight, isMobile.matches ? 140 : 180);
    userInput.style.height = `${Math.max(nextHeight, 44)}px`;
}

function lockMobilePageScroll() {
    if (!isMobile.matches) return;
    const root = document.scrollingElement || document.documentElement;
    window.scrollTo(0, 0);
    root.scrollTop = 0;
    document.body.scrollTop = 0;
}

function applyMobileVisualViewportHeight() {
    if (!isMobile.matches) {
        document.documentElement.style.removeProperty('--app-visible-height');
        return;
    }
    const vv = window.visualViewport;
    const h = vv ? Math.max(1, Math.round(vv.height)) : window.innerHeight;
    document.documentElement.style.setProperty('--app-visible-height', `${h}px`);
    lockMobilePageScroll();
}

function syncMobileInputZoneInset() {
    if (!inputZone || !isMobile.matches) return;
    document.documentElement.style.setProperty('--mobile-input-zone-height', `${inputZone.offsetHeight}px`);
}

function scrollEnListToBottomIfInputFocused() {
    if (!isMobile.matches) return;
    if (document.activeElement !== userInput) return;
    const run = () => {
        enList.scrollTop = enList.scrollHeight;
    };
    run();
    requestAnimationFrame(() => {
        run();
        requestAnimationFrame(() => {
            run();
        });
    });
}

function scheduleScrollListAfterMobileLayout() {
    if (!isMobile.matches) return;
    if (document.activeElement !== userInput) return;
    const delays = [0, 32, 100, 220, 400, 600];
    delays.forEach((ms) => {
        setTimeout(() => scrollEnListToBottomIfInputFocused(), ms);
    });
}

function focusInputForTranslation() {
    if (!isMobile.matches) return;
    if (isFinished || isWaitingForGotIt) return;
    if (userInput.disabled) return;
    if (!currentContent.length || currentIndex >= currentContent.length) return;
    if (userInput.style.display === 'none') return;
    const go = () => {
        try {
            userInput.focus({ preventScroll: true });
        } catch {
            userInput.focus();
        }
        syncMobileKeyboardOffset();
        syncMobileInputZoneInset();
        scheduleScrollListAfterMobileLayout();
    };
    requestAnimationFrame(() => {
        go();
        setTimeout(go, 80);
        setTimeout(go, 250);
    });
}

function syncMobileKeyboardOffset() {
    if (!isMobile.matches) {
        document.documentElement.style.setProperty('--mobile-keyboard-offset', '0px');
        document.documentElement.style.removeProperty('--app-visible-height');
        return;
    }
    applyMobileVisualViewportHeight();
    const viewport = window.visualViewport;
    if (!viewport) {
        document.documentElement.style.setProperty('--mobile-keyboard-offset', '0px');
        scheduleScrollListAfterMobileLayout();
        return;
    }
    const keyboardOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty('--mobile-keyboard-offset', `${keyboardOffset}px`);
    scheduleScrollListAfterMobileLayout();
}

function initTrainer() {
    const texts = getAllTexts();
    activeTextId = loadFromStorage(STORAGE_KEYS.ACTIVE_ID, '');
    const activeText = texts.find(t => t.id === activeTextId) || texts[0];
    
    if (!activeText) {
        alert('Ошибка: нет текстов. Добавьте JSON в папку content и перечислите их в content/manifest.json.');
        return;
    }

    currentContent = activeText.content;
    const migrationResult = migrateProgressToTextNames(texts, loadFromStorage(STORAGE_KEYS.PROGRESS, {}));
    const savedProgress = migrationResult.progress;
    if (migrationResult.changed) {
        saveToStorage(STORAGE_KEYS.PROGRESS, savedProgress);
    }
    const progressEntry = savedProgress[getProgressKey(activeText)] || {};
    currentIndex = progressEntry.currentIndex ?? 0;
    
    if (currentIndex >= currentContent.length) currentIndex = 0;
    if (currentContent.length === 0) {
        furthestIndexReached = 0;
    } else {
        const savedFurthest = Number.isInteger(progressEntry.furthestIndex) ? progressEntry.furthestIndex : currentIndex;
        furthestIndexReached = Math.max(currentIndex, Math.min(savedFurthest, currentContent.length - 1));
    }
    
    isFinished = false;
    isWaitingForGotIt = false;
    
    renderEN();
    updateCurrentTask();
    
    userInput.style.display = 'block';
    userInput.disabled = false;
    userInput.value = '';
    resizeUserInput();
    feedback.className = 'feedback hidden';
    checkBtn.classList.remove('hidden');
    gotItBtn.classList.add('hidden');
    focusInputForTranslation();
}

function updateCurrentTask() {
    const total = currentContent.length;
    if (isFinished || total === 0 || currentIndex >= total) {
        currentTask.classList.add('hidden');
        positionBadge.textContent = '';
        sourceText.textContent = '';
        return;
    }
    currentTask.classList.remove('hidden');
    positionBadge.textContent = `${currentIndex + 1} из ${total}`;
    sourceText.textContent = currentContent[currentIndex].ru;
    updateRecordedWordDisplay();
}

function renderEN() {
    enList.innerHTML = '';
    if (currentIndex === 0) {
        enList.innerHTML = '<div class="placeholder">Переведённые предложения появятся здесь</div>';
        return;
    }
    currentContent.slice(0, currentIndex).forEach(s => {
        const div = document.createElement('div');
        div.className = 'en-sentence';
        div.textContent = s.en;
        enList.appendChild(div);
    });
    enList.scrollTop = enList.scrollHeight;
}

function saveProgress() {
    const activeText = getAllTexts().find(t => t.id === activeTextId);
    if (!activeText) return;
    const prog = loadFromStorage(STORAGE_KEYS.PROGRESS, {});
    prog[getProgressKey(activeText)] = { currentIndex, furthestIndex: furthestIndexReached };
    saveToStorage(STORAGE_KEYS.PROGRESS, prog);
}

function checkAnswer() {
    if (isFinished || isWaitingForGotIt || !userInput.value.trim()) return;

    const userVal = normalize(userInput.value);
    const targetVal = normalize(currentContent[currentIndex].en);
    feedback.classList.add('hidden');

    if (userVal === targetVal) {
        addWordsToVocabulary(userInput.value);
        currentIndex++;
        if (currentContent.length > 0 && currentIndex < currentContent.length) {
            furthestIndexReached = Math.max(furthestIndexReached, currentIndex);
        }
        saveProgress();
        renderEN();
        if (currentIndex >= currentContent.length) {
            finishTrainer();
        } else {
            userInput.value = '';
            resizeUserInput();
            updateCurrentTask();
            focusInputForTranslation();
        }
    } else {
        isWaitingForGotIt = true;
        userInput.disabled = true;
        checkBtn.classList.add('hidden');
        gotItBtn.classList.remove('hidden');
        feedback.className = 'feedback error';
        const correctRaw = currentContent[currentIndex].en;
        let correctTokens = splitAnswerIntoWords(correctRaw);
        if (!correctTokens.length && String(correctRaw).trim()) {
            correctTokens = [String(correctRaw).trim()];
        }
        const correctWordsHtml = correctTokens.map((w) => `<button type="button" class="word-pick">${escapeHtml(w)}</button>`).join('');
        const correctBlock = `<div class="pick-word-hint">Правильный вариант:</div><div class="word-pick-row">${correctWordsHtml}</div>`;
        feedback.innerHTML = `❌ Ошибка.<br>${correctBlock}`;
    }
}

function handleGotIt() {
    if (trainingMode === 'hard') {
        currentIndex = 0;
    } else if (trainingMode !== 'easy') {
        currentIndex = Math.max(0, currentIndex - 1);
    }
    saveProgress();
    
    isWaitingForGotIt = false;
    userInput.disabled = false;
    gotItBtn.classList.add('hidden');
    checkBtn.classList.remove('hidden');
    feedback.classList.add('hidden');
    
    renderEN();
    userInput.value = '';
    resizeUserInput();
    updateCurrentTask();
    focusInputForTranslation();
    if (!isMobile.matches) {
        userInput.focus();
    }
}

function finishTrainer() {
    isFinished = true;
    userInput.style.display = 'none';
    checkBtn.classList.add('hidden');
    updateCurrentTask();
    feedback.className = 'feedback success';
    feedback.textContent = '🎉 Поздравляем! Весь текст успешно переведен.';
}

document.getElementById('restartBtn').onclick = () => {
    if (!confirm('Сбросить прогресс по этому тексту?')) return;
    currentIndex = 0;
    furthestIndexReached = 0;
    saveProgress();
    initTrainer();
    if (managerModal.classList.contains('open')) renderTextList();
};

checkBtn.addEventListener('click', checkAnswer);
gotItBtn.addEventListener('click', handleGotIt);
feedback.addEventListener('click', (e) => {
    const btn = e.target.closest('.word-pick');
    if (!btn || !isWaitingForGotIt) return;
    e.preventDefault();
    setRecordedWord(btn.textContent);
});
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        checkAnswer();
    }
});
userInput.addEventListener('input', resizeUserInput);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        syncMobileKeyboardOffset();
        syncMobileInputZoneInset();
    });
    window.visualViewport.addEventListener('scroll', () => {
        syncMobileKeyboardOffset();
        syncMobileInputZoneInset();
    });
}
trainingMode = resolveTrainingMode(trainingMode);
trainingModeEl.value = trainingMode;
trainingModeEl.addEventListener('change', () => {
    trainingMode = resolveTrainingMode(trainingModeEl.value);
    saveToStorage(STORAGE_KEYS.MODE, trainingMode);
});
window.addEventListener('resize', () => {
    syncMobileKeyboardOffset();
    syncMobileInputZoneInset();
});
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        syncMobileKeyboardOffset();
        syncMobileInputZoneInset();
    }, 300);
});
if (inputZone && window.ResizeObserver) {
    new ResizeObserver(() => {
        applyMobileVisualViewportHeight();
        syncMobileInputZoneInset();
        scheduleScrollListAfterMobileLayout();
    }).observe(inputZone);
}
userInput.addEventListener('focus', () => {
    syncMobileKeyboardOffset();
    syncMobileInputZoneInset();
    scheduleScrollListAfterMobileLayout();
});
userInput.addEventListener('blur', () => {
    setTimeout(syncMobileKeyboardOffset, 120);
});

async function bootstrap() {
    await initStorage();
    updateVocabularyCount();
    initTrainer();
    syncMobileKeyboardOffset();
    syncMobileInputZoneInset();
    resizeUserInput();
    requestAnimationFrame(() => {
        applyMobileVisualViewportHeight();
        syncMobileInputZoneInset();
        scheduleScrollListAfterMobileLayout();
    });
}

bootstrap();
