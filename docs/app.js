const QUESTION_PATH = './data/questions.json';

const state = {
  topics: [],
  selectedTopicIds: new Set(),
  currentQuiz: [],
  currentIndex: 0,
  submitState: null,
  quizResults: [],
  loading: false,
  loadError: '',
  currentSubject: null,
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatChemicalFormulaUnicode(formula) {
  const digits = {
    0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  };

  return String(formula).replace(/([A-Za-z]+)(\d+)/g, (match, letters, number) => {
    const sub = [...number].map((char) => digits[char] ?? char).join('');
    return `${letters}${sub}`;
  });
}

function renderRichText(text) {
  if (text === null || text === undefined) {
    return '';
  }

  const rawText = String(text);
  const formulaPattern = /(?:[A-Z][a-z]?\d*[A-Z][a-z]?\d*|[A-Z][a-z]?\d+)/g;
  const matches = [...rawText.matchAll(formulaPattern)];

  if (!matches.length) {
    return escapeHtml(rawText);
  }

  let result = '';
  let lastIndex = 0;

  for (const match of matches) {
    const start = match.index ?? 0;
    const formula = match[0];

    result += escapeHtml(rawText.slice(lastIndex, start));
    result += escapeHtml(formatChemicalFormulaUnicode(formula));
    lastIndex = start + formula.length;
  }

  result += escapeHtml(rawText.slice(lastIndex));
  return result;
}

function getAllSelectedTopics() {
  return state.topics.filter((topic) => state.selectedTopicIds.has(topic.id));
}

function getTopicSubject(topicId) {
  const lower = String(topicId).toLowerCase();
  if (lower.startsWith('chemie')) return 'chemie';
  if (lower.startsWith('fyzika')) return 'fyzika';
  if (lower.startsWith('biologie')) return 'biologie';
  return 'summary';
}

function getSubjectTopics(subjectKey) {
  if (!subjectKey || subjectKey === 'summary') {
    return state.topics;
  }

  return state.topics.filter((topic) => getTopicSubject(topic.id) === subjectKey);
}

function shuffleList(list) {
  const output = [...list];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[randomIndex]] = [output[randomIndex], output[index]];
  }
  return output;
}

function getQuestionCountOptions(selectedTopics) {
  const total = selectedTopics.reduce((sum, topic) => sum + topic.questions.length, 0);
  const options = ['all'];
  for (let count = 5; count <= Math.min(total, 30); count += 5) {
    options.push(String(count));
  }
  if (total < 5 && total > 0) {
    options.push(String(total));
  }
  if (total && !options.includes(String(total))) {
    options.push(String(total));
  }
  return options;
}

function buildQuestionPool(selectedTopics, mode) {
  const pool = [];
  selectedTopics.forEach((topic) => {
    topic.questions.forEach((question) => {
      pool.push({
        ...question,
        topicId: topic.id,
        topicName: topic.name,
      });
    });
  });

  if (mode === 'random') {
    return shuffleList(pool);
  }

  return pool;
}

function renderSubjectOverview() {
  const container = document.getElementById('app');
  const subjectConfig = [
    { key: 'chemie', label: 'Chemie', topics: getSubjectTopics('chemie') },
    { key: 'fyzika', label: 'Fyzika', topics: getSubjectTopics('fyzika') },
    { key: 'biologie', label: 'Biologie', topics: getSubjectTopics('biologie') },
    { key: 'summary', label: 'Souhrnný test', topics: state.topics },
  ];

  container.innerHTML = `
    <section class="panel">
      <div class="subject-header">
        <h2>Vyberte předmět</h2>
        <p>Vyberte si předmět nebo spusťte souhrnný test zahrnující všechny okruhy.</p>
      </div>

      <div class="subject-grid">
        ${subjectConfig
          .map((subject) => {
            const options = subject.key === 'summary'
              ? '<option value="all">Všechny otázky</option>'
              : `
                  <option value="all">Všechny okruhy ${subject.label}</option>
                  ${subject.topics
                    .map((topic) => `<option value="${topic.id}">${escapeHtml(topic.name)}</option>`)
                    .join('')}
                `;

            return `
              <div class="subject-card">
                <div class="subject-card-header">
                  <h3>${subject.label}</h3>
                  <span>${subject.topics.length} okruhů</span>
                </div>

                <label class="field compact-field">
                  <span>Vyberte okruh</span>
                  <select class="subject-select" data-subject="${subject.key}">
                    ${options}
                  </select>
                </label>

                <button class="primary-btn open-subject-btn" data-subject="${subject.key}" type="button">
                  ${subject.key === 'summary' ? 'Spustit souhrnný test' : 'Otevřít okruhy'}
                </button>
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;

  document.querySelectorAll('.open-subject-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const subjectKey = button.dataset.subject;
      if (subjectKey === 'summary') {
        startSummaryTest();
        return;
      }

      const relatedSelect = document.querySelector(`.subject-select[data-subject="${subjectKey}"]`);
      const selectedValue = relatedSelect ? relatedSelect.value : 'all';
      const subjectTopics = getSubjectTopics(subjectKey);
      const chosenIds = selectedValue === 'all'
        ? subjectTopics.map((topic) => topic.id)
        : [selectedValue];

      if (!chosenIds.length) {
        showSelectionError('Vyberte alespoň jeden okruh v daném předmětu.');
        return;
      }

      state.currentSubject = subjectKey;
      state.selectedTopicIds = new Set(chosenIds);
      renderTopicSelector(subjectKey);
    });
  });
}

function renderTopicSelector(subjectKey = null) {
  const container = document.getElementById('app');
  if (!state.topics.length) {
    container.innerHTML = '<div class="panel"><p>Načítání otázek…</p></div>';
    return;
  }

  const subjectLabel = subjectKey === 'chemie' ? 'Chemie' : subjectKey === 'fyzika' ? 'Fyzika' : subjectKey === 'biologie' ? 'Biologie' : 'Všechny okruhy';
  const filteredTopics = subjectKey ? getSubjectTopics(subjectKey) : state.topics;
  if (!filteredTopics.length) {
    renderSubjectOverview();
    return;
  }

  const selectedTopics = filteredTopics.filter((topic) => state.selectedTopicIds.has(topic.id));

  container.innerHTML = `
    <section class="panel selection-layout">
      <div>
        <h2>${subjectKey ? `Předmět: ${subjectLabel}` : 'Vyberte tematické okruhy'}</h2>
        <div class="topic-grid">
          ${filteredTopics
            .map(
              (topic) => `
                <label class="topic-card">
                  <input type="checkbox" data-topic-id="${topic.id}" ${state.selectedTopicIds.has(topic.id) ? 'checked' : ''} />
                  <div>
                    <div>${escapeHtml(topic.name)}</div>
                    <div class="topic-meta">${topic.questions.length} otázek</div>
                  </div>
                </label>
              `,
            )
            .join('')}
        </div>
      </div>

      <div class="controls">
        <div class="field">
          <label for="quizMode">Režim</label>
          <select id="quizMode">
            <option value="sequential">Postupně</option>
            <option value="random">Náhodně</option>
          </select>
        </div>

        <div class="field">
          <label for="questionCount">Počet otázek</label>
          <select id="questionCount">
            ${getQuestionCountOptions(selectedTopics.length ? selectedTopics : filteredTopics)
              .map((count) => `
                <option value="${count}">${count === 'all' ? 'Všechny otázky' : `Vybrat ${count}`}</option>
              `)
              .join('')}
          </select>
        </div>

        <div class="action-bar">
          <button id="startQuizBtn" class="primary-btn">Spustit kvíz</button>
          <button id="allTopicsBtn" class="ghost-btn" type="button">Vybrat vše</button>
          <button id="backToSubjectsBtn" class="ghost-btn" type="button">Zpět na předměty</button>
        </div>
      </div>
    </section>
  `;

  document.querySelectorAll('[data-topic-id]').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const { topicId } = event.target.dataset;
      if (event.target.checked) {
        state.selectedTopicIds.add(topicId);
      } else {
        state.selectedTopicIds.delete(topicId);
      }
    });
  });

  document.getElementById('allTopicsBtn').addEventListener('click', () => {
    state.selectedTopicIds = new Set(filteredTopics.map((topic) => topic.id));
    renderTopicSelector(subjectKey);
  });

  document.getElementById('backToSubjectsBtn').addEventListener('click', () => {
    state.selectedTopicIds = new Set();
    state.currentSubject = null;
    renderSubjectOverview();
  });

  document.getElementById('startQuizBtn').addEventListener('click', () => {
    const selectedTopics = filteredTopics.filter((topic) => state.selectedTopicIds.has(topic.id));
    if (!selectedTopics.length) {
      showSelectionError('Vyberte alespoň jeden tematický okruh.');
      return;
    }

    const mode = document.getElementById('quizMode').value;
    const countValue = document.getElementById('questionCount').value;
    const pool = buildQuestionPool(selectedTopics, mode);
    const questionLimit = countValue === 'all' ? pool.length : Math.min(Number(countValue), pool.length);
    const questions = pool.slice(0, questionLimit);

    if (!questions.length) {
      showSelectionError('V zvolených okruzích nejsou žádné otázky.');
      return;
    }

    state.currentQuiz = questions;
    state.currentIndex = 0;
    state.submitState = null;
    state.quizResults = [];
    renderQuiz();
  });

  const selectionError = document.getElementById('selectionError');
  if (selectionError) {
    selectionError.remove();
  }
}

function startSummaryTest() {
  let rawValue = 20;
  try {
    rawValue = Number(window.prompt('Zadejte počet otázek pro souhrnný test (1–50):', '20'));
  } catch (error) {
    rawValue = 20;
  }

  const count = Number.isFinite(rawValue) ? Math.max(1, Math.min(50, rawValue)) : 20;
  const allQuestions = buildQuestionPool(state.topics, 'random');
  const questions = allQuestions.slice(0, Math.min(count, allQuestions.length));

  if (!questions.length) {
    showSelectionError('V databázi nejsou žádné otázky pro souhrnný test.');
    return;
  }

  state.currentQuiz = questions;
  state.currentIndex = 0;
  state.submitState = null;
  state.quizResults = [];
  renderQuiz();
}

function showSelectionError(message) {
  const container = document.getElementById('app');
  const banner = document.createElement('div');
  banner.id = 'selectionError';
  banner.className = 'error-banner';
  banner.textContent = message;
  const existing = document.getElementById('selectionError');
  if (existing) existing.remove();
  container.appendChild(banner);
}

function getCurrentQuestion() {
  return state.currentQuiz[state.currentIndex];
}

function selectedIndexesFromForm() {
  const selected = [];
  document.querySelectorAll('input[name="answerOption"]:checked').forEach((checkbox) => {
    selected.push(Number(checkbox.value));
  });
  return selected.sort((a, b) => a - b);
}

function markAnswerState(question, selected) {
  const answerOptions = document.querySelectorAll('.answer-option');
  const correctSet = new Set(question.correctAnswers);

  answerOptions.forEach((option) => {
    const index = Number(option.dataset.index);
    option.classList.remove('correct', 'incorrect', 'selected');

    if (correctSet.has(index)) {
      option.classList.add('correct');
    }

    if (selected.includes(index) && !correctSet.has(index)) {
      option.classList.add('incorrect');
    }

    if (selected.includes(index)) {
      option.classList.add('selected');
    }
  });
}

function renderQuiz() {
  const container = document.getElementById('app');
  const question = getCurrentQuestion();

  if (!question) {
    renderSummary();
    return;
  }

  const currentNumber = state.currentIndex + 1;

  container.innerHTML = `
    <section class="panel question-card">
      <div class="quiz-header">
        <div>
          <p class="eyebrow">${escapeHtml(question.topicName)}</p>
        </div>
        <div class="progress">Otázka ${currentNumber}/${state.currentQuiz.length}</div>
      </div>

      <h2 class="question-text">${renderRichText(question.question)}</h2>

      <div class="answers-list">
        ${question.answers
          .map(
            (answer, index) => `
              <div class="answer-option" data-index="${index}">
                <label class="answer-label">
                  <input type="checkbox" name="answerOption" value="${index}" ${state.submitState && state.submitState.selected.includes(index) ? 'checked' : ''} ${state.submitState ? 'disabled' : ''} />
                  <span class="letter">${String.fromCharCode(97 + index)}</span>
                  <span>${renderRichText(answer)}</span>
                </label>
              </div>
            `,
          )
          .join('')}
      </div>

      ${state.submitState ? renderFeedback(question, state.submitState) : ''}

      <div class="action-bar">
        ${state.submitState ? `
          <button id="nextQuestionBtn" class="primary-btn">${state.currentIndex === state.currentQuiz.length - 1 ? 'Ukončit kvíz' : 'Další otázka'}</button>
        ` : `
          <button id="submitAnswerBtn" class="primary-btn">Odeslat odpověď</button>
        `}
        <button id="backToTopicsBtn" class="ghost-btn" type="button">Zpět na předměty</button>
      </div>
    </section>
  `;

  if (state.submitState) {
    markAnswerState(question, state.submitState.selected);
    document.getElementById('nextQuestionBtn').addEventListener('click', () => {
      if (state.currentIndex < state.currentQuiz.length - 1) {
        state.currentIndex += 1;
        state.submitState = null;
        renderQuiz();
        return;
      }
      renderSummary();
    });
  } else {
    document.getElementById('submitAnswerBtn').addEventListener('click', () => {
      const selected = selectedIndexesFromForm();
      if (!selected.length) {
        showQuestionError('Vyberte alespoň jednu možnost odpovědi.');
        return;
      }

      const isCorrect = JSON.stringify(selected.slice().sort((a, b) => a - b)) === JSON.stringify(question.correctAnswers.slice().sort((a, b) => a - b));
      state.submitState = { selected, isCorrect };
      state.quizResults.push({
        questionId: question.id,
        topicName: question.topicName,
        question: question.question,
        selected,
        correctAnswers: question.correctAnswers,
        isCorrect,
      });
      renderQuiz();
    });
  }

  document.getElementById('backToTopicsBtn').addEventListener('click', () => {
    state.currentQuiz = [];
    state.currentIndex = 0;
    state.submitState = null;
    state.quizResults = [];
    renderSubjectOverview();
  });
}

function showQuestionError(message) {
  const existing = document.querySelector('.error-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.className = 'error-banner';
  banner.textContent = message;
  document.querySelector('.question-card').appendChild(banner);
}

function renderFeedback(question, submitState) {
  const correctText = submitState.isCorrect ? 'Správně.' : 'Špatně.';
  const correctAnswers = question.correctAnswers.map((index) => String.fromCharCode(97 + index)).join(', ');

  return `
    <div class="result-box ${submitState.isCorrect ? 'success' : 'error'}">
      <strong>${correctText}</strong>
      <div>Správné odpovědi: ${escapeHtml(correctAnswers)}</div>
    </div>
  `;
}

function renderSummary() {
  const total = state.quizResults.length;
  const correct = state.quizResults.filter((result) => result.isCorrect).length;
  const percentage = total ? Math.round((correct / total) * 100) : 0;
  const wrong = state.quizResults.filter((result) => !result.isCorrect);

  document.getElementById('app').innerHTML = `
    <section class="panel">
      <h2>Výsledek kvízu</h2>

      <div class="summary-grid">
        <div class="summary-card">
          <span>Správně</span>
          <strong>${correct}/${total}</strong>
        </div>
        <div class="summary-card">
          <span>Úspěšnost</span>
          <strong>${percentage}%</strong>
        </div>
      </div>

      <div class="action-bar">
        <button id="restartQuizBtn" class="primary-btn">Restartovat kvíz</button>
        <button id="chooseTopicsBtn" class="ghost-btn">Zpět na předměty</button>
      </div>

      <h3>Otázky zodpovězené špatně</h3>
      ${wrong.length ? `
        <ul class="wrong-list">
          ${wrong
            .map(
              (result) => `
                <li>
                  <div><strong>${escapeHtml(result.topicName)}</strong></div>
                  <div>${renderRichText(result.question)}</div>
                  <div><small>Správně: ${result.correctAnswers.map((index) => String.fromCharCode(97 + index)).join(', ')}</small></div>
                </li>
              `,
            )
            .join('')}
        </ul>
      ` : '<p>Všechny odpovědi byly správně.</p>'}
    </section>
  `;

  document.getElementById('restartQuizBtn').addEventListener('click', () => {
    state.currentIndex = 0;
    state.submitState = null;
    state.quizResults = [];
    renderQuiz();
  });

  document.getElementById('chooseTopicsBtn').addEventListener('click', () => {
    state.currentQuiz = [];
    state.currentIndex = 0;
    state.submitState = null;
    state.quizResults = [];
    renderSubjectOverview();
  });
}

async function loadDatabase() {
  try {
    state.loading = true;
    const response = await fetch(QUESTION_PATH, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Nepodařilo se načíst databázi (${response.status})`);
    }

    const data = await response.json();
    state.topics = data.topics || [];
    if (!state.topics.length) {
      throw new Error('Databáze neobsahuje žádné tematické okruhy.');
    }
    state.loadError = '';
    renderSubjectOverview();
  } catch (error) {
    state.loadError = error.message;
    document.getElementById('app').innerHTML = `
      <section class="panel">
        <h2>Chyba při načítání databáze</h2>
        <p>${escapeHtml(state.loadError)}</p>
      </section>
    `;
  } finally {
    state.loading = false;
  }
}

loadDatabase();
