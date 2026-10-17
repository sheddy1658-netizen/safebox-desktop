// ============================================
// GAMES.JS - SUDOKU & WORD PUZZLE ONLY
// FULLY RESPONSIVE - FITS ANY SCREEN
// TOUCH FRIENDLY - WORKS ON PHONE
// ============================================

// ============================================
// WORD LISTS BY LEVEL
// ============================================

const WORD_LISTS = {
    easy: {
        words: ['CAT', 'DOG', 'SUN', 'HAT', 'CAR', 'BAG', 'MAP', 'BED', 'CUP', 'PEN',
                'BUS', 'FLY', 'BUG', 'FAN', 'JAM', 'KEY', 'LOG', 'MOP', 'NET', 'OAK',
                'PIG', 'RAT', 'SAW', 'TAP', 'VAN', 'WAX', 'YAM', 'ZOO', 'ANT', 'BAT',
                'BEE', 'COW', 'DOT', 'EAR', 'FOG', 'GAS', 'HEN', 'ICE', 'JOG', 'LOT',
                'MAY', 'NOW', 'OIL', 'PAT', 'RED', 'SAT', 'TOP', 'WET', 'YET', 'ZAP'],
        gridSize: 6
    },
    medium: {
        words: ['APPLE', 'BERRY', 'CLOUD', 'DANCE', 'EAGLE', 'FAIRY', 'GRACE', 'HEART',
                'JOKER', 'LEMON', 'MARCH', 'NIGHT', 'OCEAN', 'PEACE', 'QUEEN', 'RIVER',
                'STONE', 'TIGER', 'UNCLE', 'VOICE', 'WATER', 'YOUTH', 'ZEBRA', 'BREAD',
                'CHAIR', 'DREAM', 'EAGER', 'FROST', 'GLEAM', 'HONOR', 'IMAGE', 'JAZZY',
                'KNIFE', 'LOVER', 'MAGIC', 'NORTH', 'OASIS', 'PRIZE', 'QUIET', 'RADIO'],
        gridSize: 8
    },
    hard: {
        words: ['BALLOON', 'CANDY', 'DOLPHIN', 'ELEPHANT', 'FALCON', 'GALAXY', 'HARMONY',
                'IGNITE', 'JUNGLE', 'KINGDOM', 'LIONESS', 'MAGNET', 'NEBULA', 'ORCHID',
                'PANTHER', 'QUARTZ', 'RABBIT', 'SAILOR', 'TEMPLE', 'UNIVERSE', 'VALLEY',
                'WISDOM', 'XENON', 'YOGURT', 'ZENITH', 'ADVENTURE', 'BRILLIANT', 'CIRCUIT',
                'DIAMOND', 'ENERGY', 'FANTASTIC', 'GENEROUS', 'HORIZON', 'INSPIRE', 'JOURNEY'],
        gridSize: 10
    },
    expert: {
        words: ['ABSTRACT', 'BIOGRAPHY', 'CHRONICLE', 'DANGEROUS', 'EMOTIONAL', 'FORGIVEN',
                'GENERATION', 'HISTORICAL', 'IDENTICAL', 'JURASSIC', 'KNOWLEDGE', 'LIBRARY',
                'MAGNIFICENT', 'NARRATIVE', 'OBSERVATION', 'PRACTICAL', 'QUARANTINE', 'REVOLUTION',
                'SURVIVAL', 'TECHNOLOGY', 'UNIVERSAL', 'VICTORIOUS', 'WONDERFUL', 'YOURSELF',
                'ZERO-GRAVITY', 'ALGORITHM', 'BENEVOLENT', 'CHALLENGING', 'DYNAMIC', 'ENLIGHTEN',
                'FASCINATING', 'GUARDIAN', 'HERITAGE', 'IMAGINATION', 'JUSTIFICATION'],
        gridSize: 12
    }
};

// ============================================
// RESPONSIVE HELPERS
// ============================================

function getResponsiveSize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const maxSize = Math.min(width, height) - 80;
    
    if (width < 400) {
        return { cellSize: Math.min(28, maxSize / 10), padding: 2 };
    } else if (width < 600) {
        return { cellSize: Math.min(36, maxSize / 10), padding: 3 };
    } else if (width < 800) {
        return { cellSize: Math.min(44, maxSize / 10), padding: 4 };
    } else {
        return { cellSize: Math.min(52, maxSize / 10), padding: 4 };
    }
}

// ============================================
// SUDOKU - FULLSCREEN WITH TOUCH SUPPORT
// ============================================

let sudokuState = {
    board: [],
    solution: [],
    initial: [],
    selectedCell: null,
    level: 'medium',
    errors: 0,
    hints: 3,
    completed: false,
    timer: 0,
    timerInterval: null
};

function loadSudokuFullscreen(container) {
    sudokuState.level = 'medium';
    sudokuState.errors = 0;
    sudokuState.hints = 3;
    sudokuState.completed = false;
    sudokuState.timer = 0;
    if (sudokuState.timerInterval) {
        clearInterval(sudokuState.timerInterval);
        sudokuState.timerInterval = null;
    }

    container.innerHTML = `
        <div class="sudoku-container" style="width:100%;max-width:550px;margin:0 auto;display:flex;flex-direction:column;align-items:center;padding:8px;">
            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:6px;width:100%;">
                <button class="level-btn ${sudokuState.level === 'easy' ? 'active' : ''}" onclick="sudokuSetLevel('easy')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🟢 Easy</button>
                <button class="level-btn ${sudokuState.level === 'medium' ? 'active' : ''}" onclick="sudokuSetLevel('medium')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🟡 Medium</button>
                <button class="level-btn ${sudokuState.level === 'hard' ? 'active' : ''}" onclick="sudokuSetLevel('hard')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🔴 Hard</button>
                <button class="level-btn ${sudokuState.level === 'expert' ? 'active' : ''}" onclick="sudokuSetLevel('expert')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">⚫ Expert</button>
            </div>
            <div class="game-info" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:4px 0;font-size:clamp(11px,1.5vw,14px);">
                <span>⏱️ <span class="value" id="sudokuTimer" style="color:white;font-weight:700;">00:00</span></span>
                <span>❌ Errors: <span class="value" id="sudokuErrors" style="color:white;font-weight:700;">0</span></span>
                <span>💡 Hints: <span class="value" id="sudokuHints" style="color:white;font-weight:700;">3</span></span>
                <span>📊 <span class="value" id="sudokuFilled" style="color:white;font-weight:700;">0/81</span></span>
            </div>
            <div class="sudoku-board" id="sudokuBoard" style="width:100%;max-width:500px;aspect-ratio:1;display:grid;grid-template-columns:repeat(9,1fr);gap:2px;background:#1e293b;padding:4px;border-radius:8px;touch-action:manipulation;"></div>
            
            <!-- TOUCH FRIENDLY NUMBER PAD -->
            <div class="sudoku-numpad" id="sudokuNumpad">
                ${[1,2,3,4,5,6,7,8,9].map(n => `
                    <button onclick="sudokuInputNumber(${n})" data-num="${n}">${n}</button>
                `).join('')}
                <button onclick="sudokuClearCell()" class="clear-btn">✕</button>
            </div>
            
            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:8px;width:100%;">
                <button onclick="sudokuNewGame()" class="btn btn-primary" style="font-size:clamp(11px,1.5vw,14px);padding:6px 14px;">🎲 New</button>
                <button onclick="sudokuHint()" class="btn btn-info" id="sudokuHintBtn" style="font-size:clamp(11px,1.5vw,14px);padding:6px 14px;">💡 Hint (<span id="sudokuHintCount">3</span>)</button>
                <button onclick="sudokuSolve()" class="btn btn-success" style="font-size:clamp(11px,1.5vw,14px);padding:6px 14px;">✨ Solve</button>
                <button onclick="sudokuCheck()" class="btn btn-secondary" style="font-size:clamp(11px,1.5vw,14px);padding:6px 14px;">✅ Check</button>
            </div>
            <div id="sudokuMessage" style="margin-top:6px;font-size:clamp(12px,1.6vw,15px);font-weight:600;min-height:24px;text-align:center;"></div>
        </div>
    `;

    sudokuGenerate();
    sudokuStartTimer();
    window.addEventListener('resize', sudokuResize);
}

// ============================================
// SUDOKU GENERATE
// ============================================

function sudokuGenerate() {
    const level = sudokuState.level;
    let difficulty = 30;
    if (level === 'easy') difficulty = 25;
    else if (level === 'medium') difficulty = 35;
    else if (level === 'hard') difficulty = 45;
    else if (level === 'expert') difficulty = 55;

    const board = Array(9).fill().map(() => Array(9).fill(0));
    sudokuSolveBoard(board);
    sudokuState.solution = board.map(row => [...row]);
    sudokuState.board = board.map(row => [...row]);
    sudokuState.initial = board.map(row => [...row]);
    sudokuState.errors = 0;
    sudokuState.completed = false;
    sudokuState.selectedCell = null;
    document.getElementById('sudokuErrors').textContent = '0';
    document.getElementById('sudokuHints').textContent = sudokuState.hints;
    document.getElementById('sudokuHintCount').textContent = sudokuState.hints;

    let removed = 0;
    while (removed < difficulty) {
        const row = Math.floor(Math.random() * 9);
        const col = Math.floor(Math.random() * 9);
        if (sudokuState.board[row][col] !== 0) {
            sudokuState.board[row][col] = 0;
            sudokuState.initial[row][col] = 0;
            removed++;
        }
    }

    sudokuRender();
    sudokuUpdateStats();
}

function sudokuSolveBoard(board) {
    const nums = [1,2,3,4,5,6,7,8,9];
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            if (board[i][j] === 0) {
                const shuffled = [...nums].sort(() => Math.random() - 0.5);
                for (const num of shuffled) {
                    if (sudokuIsValid(board, i, j, num)) {
                        board[i][j] = num;
                        if (sudokuSolveBoard(board)) return true;
                        board[i][j] = 0;
                    }
                }
                return false;
            }
        }
    }
    return true;
}

function sudokuIsValid(board, row, col, num) {
    for (let i = 0; i < 9; i++) {
        if (board[row][i] === num) return false;
        if (board[i][col] === num) return false;
    }
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let i = br; i < br + 3; i++) {
        for (let j = bc; j < bc + 3; j++) {
            if (board[i][j] === num) return false;
        }
    }
    return true;
}

// ============================================
// SUDOKU RENDER - TOUCH FIXED
// ============================================

function sudokuRender() {
    const boardEl = document.getElementById('sudokuBoard');
    if (!boardEl) return;

    const size = getResponsiveSize();
    boardEl.style.gap = Math.max(1, size.padding) + 'px';
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = 'repeat(9, 1fr)';

    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = i;
            cell.dataset.col = j;
            cell.id = `sudoku-cell-${i}-${j}`;
            
            const value = sudokuState.board[i][j];
            cell.textContent = value !== 0 ? value : '';
            
            // Borders for 3x3 boxes
            if (i === 0 || i === 3 || i === 6) cell.style.borderTop = '3px solid #718096';
            if (j === 0 || j === 3 || j === 6) cell.style.borderLeft = '3px solid #718096';
            if (i === 2 || i === 5 || i === 8) cell.style.borderBottom = '3px solid #718096';
            if (j === 2 || j === 5 || j === 8) cell.style.borderRight = '3px solid #718096';
            
            const fontSize = Math.max(14, Math.min(28, size.cellSize * 0.6));
            cell.style.fontSize = fontSize + 'px';
            cell.style.fontWeight = '700';
            cell.style.fontFamily = 'Arial, sans-serif';
            cell.style.border = '1px solid #3d4a5c';
            cell.style.borderRadius = '1px';
            cell.style.background = '#2d3748';
            cell.style.color = '#e2e8f0';
            cell.style.cursor = 'pointer';
            cell.style.touchAction = 'manipulation';
            cell.style.userSelect = 'none';
            cell.style.webkitUserSelect = 'none';
            
            if (sudokuState.initial[i][j] !== 0) {
                cell.style.background = '#1a202c';
                cell.style.color = '#a0aec0';
                cell.style.cursor = 'default';
                cell.classList.add('given');
            }
            
            // TOUCH: Use click event for mobile
            cell.addEventListener('click', function() {
                const row = parseInt(this.dataset.row);
                const col = parseInt(this.dataset.col);
                sudokuSelectCell(row, col);
            });
            
            boardEl.appendChild(cell);
        }
    }
    
    // Highlight selected cell if any
    if (sudokuState.selectedCell) {
        sudokuHighlight(sudokuState.selectedCell.row, sudokuState.selectedCell.col);
    }
    
    sudokuUpdateStats();
    sudokuResize();
}

// ============================================
// SUDOKU SELECT CELL - TOUCH FIXED
// ============================================

function sudokuSelectCell(row, col) {
    if (sudokuState.initial[row][col] !== 0) {
        // Can't select pre-filled cells
        if (sudokuState.selectedCell && 
            sudokuState.selectedCell.row === row && 
            sudokuState.selectedCell.col === col) {
            sudokuState.selectedCell = null;
        } else {
            sudokuState.selectedCell = { row, col };
        }
    } else {
        if (sudokuState.selectedCell && 
            sudokuState.selectedCell.row === row && 
            sudokuState.selectedCell.col === col) {
            sudokuState.selectedCell = null;
        } else {
            sudokuState.selectedCell = { row, col };
        }
    }
    sudokuHighlight(row, col);
}

// ============================================
// SUDOKU INPUT NUMBER - TOUCH FRIENDLY
// ============================================

function sudokuInputNumber(num) {
    if (!sudokuState.selectedCell) {
        document.getElementById('sudokuMessage').textContent = '👆 Tap a cell first!';
        document.getElementById('sudokuMessage').style.color = '#fc8181';
        return;
    }
    
    const { row, col } = sudokuState.selectedCell;
    if (sudokuState.initial[row][col] !== 0) {
        document.getElementById('sudokuMessage').textContent = '❌ This cell is pre-filled';
        document.getElementById('sudokuMessage').style.color = '#fc8181';
        return;
    }
    
    const cell = document.getElementById(`sudoku-cell-${row}-${col}`);
    if (!cell) return;
    
    cell.textContent = num;
    sudokuState.board[row][col] = num;
    
    if (num === sudokuState.solution[row][col]) {
        cell.style.color = '#68d391';
        cell.classList.remove('error');
        cell.classList.add('correct');
        document.getElementById('sudokuMessage').textContent = '✅ Correct!';
        document.getElementById('sudokuMessage').style.color = '#10b981';
    } else {
        cell.style.color = '#fc8181';
        cell.classList.add('error');
        cell.classList.remove('correct');
        sudokuState.errors++;
        document.getElementById('sudokuErrors').textContent = sudokuState.errors;
        document.getElementById('sudokuMessage').textContent = '❌ Wrong number';
        document.getElementById('sudokuMessage').style.color = '#fc8181';
    }
    sudokuUpdateStats();
    sudokuCheckComplete();
}

function sudokuClearCell() {
    if (!sudokuState.selectedCell) return;
    
    const { row, col } = sudokuState.selectedCell;
    if (sudokuState.initial[row][col] !== 0) return;
    
    const cell = document.getElementById(`sudoku-cell-${row}-${col}`);
    if (!cell) return;
    
    cell.textContent = '';
    sudokuState.board[row][col] = 0;
    cell.style.color = '#e2e8f0';
    cell.classList.remove('error', 'correct');
    sudokuUpdateStats();
    document.getElementById('sudokuMessage').textContent = '🧹 Cell cleared';
    document.getElementById('sudokuMessage').style.color = '#667eea';
}

function sudokuHighlight(row, col) {
    const cells = document.querySelectorAll('.sudoku-board .cell');
    const val = row !== -1 && col !== -1 ? sudokuState.board[row][col] : 0;
    
    cells.forEach(cell => {
        const r = parseInt(cell.dataset.row);
        const c = parseInt(cell.dataset.col);
        
        cell.style.background = cell.classList.contains('given') ? '#1a202c' : '#2d3748';
        cell.style.boxShadow = 'none';
        cell.style.outline = 'none';
        
        if (row === -1 || col === -1) return;
        
        if (r === row || c === col) {
            cell.style.background = '#3d4a5c';
        }
        
        if (val !== 0 && sudokuState.board[r][c] === val && sudokuState.board[r][c] !== 0) {
            cell.style.background = '#3d4a5c';
        }
        
        if (r === row && c === col) {
            cell.style.background = '#4a5568';
            cell.style.outline = '2px solid #667eea';
            cell.style.boxShadow = 'inset 0 0 0 2px #667eea';
            cell.classList.add('selected');
        } else {
            cell.classList.remove('selected');
        }
    });
}

function sudokuUpdateStats() {
    let filled = 0;
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            if (sudokuState.board[i][j] !== 0) filled++;
        }
    }
    document.getElementById('sudokuFilled').textContent = `${filled}/81`;
}

function sudokuSetLevel(level) {
    sudokuState.level = level;
    document.querySelectorAll('.level-btn').forEach(btn => {
        btn.classList.remove('active');
        const text = btn.textContent.trim().toLowerCase();
        if (text.includes('easy') && level === 'easy') btn.classList.add('active');
        else if (text.includes('medium') && level === 'medium') btn.classList.add('active');
        else if (text.includes('hard') && level === 'hard') btn.classList.add('active');
        else if (text.includes('expert') && level === 'expert') btn.classList.add('active');
    });
    sudokuNewGame();
}

function sudokuNewGame() {
    if (sudokuState.timerInterval) {
        clearInterval(sudokuState.timerInterval);
        sudokuState.timerInterval = null;
    }
    sudokuState.timer = 0;
    document.getElementById('sudokuTimer').textContent = '00:00';
    sudokuGenerate();
}

function sudokuStartTimer() {
    if (sudokuState.timerInterval) {
        clearInterval(sudokuState.timerInterval);
    }
    sudokuState.timerInterval = setInterval(() => {
        sudokuState.timer++;
        const mins = String(Math.floor(sudokuState.timer / 60)).padStart(2, '0');
        const secs = String(sudokuState.timer % 60).padStart(2, '0');
        document.getElementById('sudokuTimer').textContent = `${mins}:${secs}`;
    }, 1000);
}

function sudokuHint() {
    if (sudokuState.hints <= 0) {
        document.getElementById('sudokuMessage').textContent = '❌ No hints left!';
        document.getElementById('sudokuMessage').style.color = '#fc8181';
        return;
    }

    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            if (sudokuState.board[i][j] === 0) {
                sudokuState.board[i][j] = sudokuState.solution[i][j];
                const cell = document.getElementById(`sudoku-cell-${i}-${j}`);
                if (cell) {
                    cell.textContent = sudokuState.solution[i][j];
                    cell.classList.add('correct');
                    cell.style.color = '#68d391';
                    cell.style.cursor = 'default';
                }
                sudokuState.hints--;
                document.getElementById('sudokuHints').textContent = sudokuState.hints;
                document.getElementById('sudokuHintCount').textContent = sudokuState.hints;
                sudokuUpdateStats();
                sudokuCheckComplete();
                document.getElementById('sudokuMessage').textContent = '💡 Hint placed!';
                document.getElementById('sudokuMessage').style.color = '#667eea';
                return;
            }
        }
    }
    document.getElementById('sudokuMessage').textContent = '✅ Puzzle already complete!';
    document.getElementById('sudokuMessage').style.color = '#10b981';
}

function sudokuSolve() {
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            if (sudokuState.initial[i][j] === 0) {
                sudokuState.board[i][j] = sudokuState.solution[i][j];
                const cell = document.getElementById(`sudoku-cell-${i}-${j}`);
                if (cell) {
                    cell.textContent = sudokuState.solution[i][j];
                    cell.classList.add('correct');
                    cell.style.color = '#68d391';
                    cell.style.cursor = 'default';
                }
            }
        }
    }
    sudokuUpdateStats();
    document.getElementById('sudokuMessage').textContent = '✨ Puzzle solved!';
    document.getElementById('sudokuMessage').style.color = '#10b981';
    if (sudokuState.timerInterval) {
        clearInterval(sudokuState.timerInterval);
        sudokuState.timerInterval = null;
    }
}

function sudokuCheck() {
    let allCorrect = true;
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            const cell = document.getElementById(`sudoku-cell-${i}-${j}`);
            if (!cell) continue;
            if (sudokuState.initial[i][j] !== 0) continue;
            if (sudokuState.board[i][j] === sudokuState.solution[i][j]) {
                cell.classList.add('correct');
                cell.style.color = '#68d391';
                cell.classList.remove('error');
            } else {
                cell.classList.add('error');
                cell.style.color = '#fc8181';
                cell.classList.remove('correct');
                allCorrect = false;
            }
        }
    }
    document.getElementById('sudokuMessage').textContent = allCorrect ? '✅ All correct! Great job!' : '❌ Some cells are incorrect.';
    document.getElementById('sudokuMessage').style.color = allCorrect ? '#10b981' : '#fc8181';
    if (allCorrect) {
        sudokuState.completed = true;
        if (sudokuState.timerInterval) {
            clearInterval(sudokuState.timerInterval);
            sudokuState.timerInterval = null;
        }
    }
}

function sudokuCheckComplete() {
    let filled = 0;
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            if (sudokuState.board[i][j] !== 0) filled++;
        }
    }
    if (filled === 81) {
        sudokuState.completed = true;
        if (sudokuState.timerInterval) {
            clearInterval(sudokuState.timerInterval);
            sudokuState.timerInterval = null;
        }
        document.getElementById('sudokuMessage').textContent = '🎉 Puzzle Complete!';
        document.getElementById('sudokuMessage').style.color = '#10b981';
    }
}

function sudokuResize() {
    const board = document.getElementById('sudokuBoard');
    if (board) {
        const size = getResponsiveSize();
        board.style.gap = size.padding + 'px';
        document.querySelectorAll('.sudoku-board .cell').forEach(cell => {
            const fontSize = Math.max(12, size.cellSize * 0.55);
            cell.style.fontSize = fontSize + 'px';
        });
    }
}

// ============================================
// WORD PUZZLE - TOUCH FRIENDLY
// ============================================

let wordState = {
    grid: [],
    words: [],
    foundWords: [],
    selectedCells: [],
    level: 'medium',
    complexity: 'medium',
    gridSize: 8,
    hints: 3
};

function loadWordFullscreen(container) {
    wordState.level = 'medium';
    wordState.complexity = 'medium';
    wordState.hints = 3;
    wordState.foundWords = [];

    container.innerHTML = `
        <div class="word-container" style="width:100%;max-width:600px;margin:0 auto;display:flex;flex-direction:column;align-items:center;padding:8px;">
            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:4px;width:100%;">
                <button class="level-btn active" onclick="wordSetLevel('easy')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🟢 Easy</button>
                <button class="level-btn" onclick="wordSetLevel('medium')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🟡 Medium</button>
                <button class="level-btn" onclick="wordSetLevel('hard')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🔴 Hard</button>
                <button class="level-btn" onclick="wordSetLevel('expert')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">⚫ Expert</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:4px;width:100%;">
                <button class="complexity-btn ${wordState.complexity === 'easy' ? 'active' : ''}" onclick="wordSetComplexity('easy')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🟢 Simple</button>
                <button class="complexity-btn ${wordState.complexity === 'medium' ? 'active' : ''}" onclick="wordSetComplexity('medium')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🟡 Medium</button>
                <button class="complexity-btn ${wordState.complexity === 'hard' ? 'active' : ''}" onclick="wordSetComplexity('hard')" style="font-size:clamp(10px,1.5vw,14px);padding:4px 12px;">🔴 Complex</button>
            </div>
            <div class="game-info" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:4px 0;font-size:clamp(11px,1.5vw,14px);">
                <span>📝 <span class="value" id="wordFound" style="color:white;font-weight:700;">0</span>/<span class="value" id="wordTotal" style="color:white;font-weight:700;">0</span></span>
                <span>💡 Hints: <span class="value" id="wordHints" style="color:white;font-weight:700;">3</span></span>
                <span>📊 Level: <span class="value" id="wordLevel" style="color:white;font-weight:700;">Medium</span></span>
            </div>
            <div class="word-grid" id="wordGrid" style="width:100%;max-width:500px;aspect-ratio:1;display:grid;gap:3px;background:#1e293b;padding:4px;border-radius:8px;touch-action:manipulation;"></div>
            <div class="word-hint" id="wordHint" style="color:rgba(255,255,255,0.6);font-size:clamp(12px,1.6vw,15px);text-align:center;margin:4px 0;min-height:24px;">Tap cells to select letters</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:4px;width:100%;">
                <button onclick="wordNewGame()" class="btn btn-primary" style="font-size:clamp(11px,1.5vw,14px);padding:6px 14px;">🎲 New</button>
                <button onclick="wordHint()" class="btn btn-info" id="wordHintBtn" style="font-size:clamp(11px,1.5vw,14px);padding:6px 14px;">💡 Hint (<span id="wordHintCount">3</span>)</button>
                <button onclick="wordRevealAll()" class="btn btn-success" style="font-size:clamp(11px,1.5vw,14px);padding:6px 14px;">✨ Reveal</button>
            </div>
            <div id="wordMessage" style="margin-top:4px;font-size:clamp(12px,1.6vw,15px);font-weight:600;min-height:24px;text-align:center;color:#667eea;"></div>
        </div>
    `;

    wordGenerate();
    window.addEventListener('resize', wordResize);
}

// ============================================
// WORD PUZZLE - TOUCH FIXED
// ============================================

function wordGenerate() {
    const level = wordState.level;
    const words = WORD_LISTS[level]?.words || WORD_LISTS.medium.words;
    const gridSize = WORD_LISTS[level]?.gridSize || 8;
    
    let numWords = 6;
    if (wordState.complexity === 'easy') numWords = 4;
    else if (wordState.complexity === 'medium') numWords = 6;
    else if (wordState.complexity === 'hard') numWords = 8;
    
    const shuffled = [...words].sort(() => Math.random() - 0.5);
    const selectedWords = shuffled.slice(0, Math.min(numWords, shuffled.length));
    
    wordState.words = selectedWords;
    wordState.foundWords = [];
    wordState.selectedCells = [];
    wordState.hints = 3;
    wordState.gridSize = gridSize;
    
    const grid = Array(gridSize).fill().map(() => Array(gridSize).fill(''));
    
    const directions = [
        [0, 1], [1, 0], [1, 1], [1, -1],
        [0, -1], [-1, 0], [-1, -1], [-1, 1]
    ];
    
    for (const word of selectedWords) {
        let placed = false;
        let attempts = 0;
        while (!placed && attempts < 100) {
            attempts++;
            const row = Math.floor(Math.random() * gridSize);
            const col = Math.floor(Math.random() * gridSize);
            const dir = directions[Math.floor(Math.random() * directions.length)];
            
            if (wordCanPlace(grid, word, row, col, dir, gridSize)) {
                wordPlace(grid, word, row, col, dir);
                placed = true;
            }
        }
        if (!placed) {
            for (let i = 0; i < gridSize; i++) {
                for (let j = 0; j < gridSize; j++) {
                    if (grid[i][j] === '') {
                        for (const d of directions) {
                            if (wordCanPlace(grid, word, i, j, d, gridSize)) {
                                wordPlace(grid, word, i, j, d);
                                placed = true;
                                break;
                            }
                        }
                        if (placed) break;
                    }
                }
                if (placed) break;
            }
        }
    }
    
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
            if (grid[i][j] === '') {
                grid[i][j] = letters[Math.floor(Math.random() * letters.length)];
            }
        }
    }
    
    wordState.grid = grid;
    wordRender();
    wordUpdateStats();
    document.getElementById('wordHintCount').textContent = wordState.hints;
    document.getElementById('wordHints').textContent = wordState.hints;
    document.getElementById('wordMessage').textContent = `Find ${selectedWords.length} words!`;
    document.getElementById('wordMessage').style.color = '#667eea';
}

function wordCanPlace(grid, word, row, col, dir, size) {
    for (let i = 0; i < word.length; i++) {
        const r = row + i * dir[0];
        const c = col + i * dir[1];
        if (r < 0 || r >= size || c < 0 || c >= size) return false;
        if (grid[r][c] !== '' && grid[r][c] !== word[i]) return false;
    }
    return true;
}

function wordPlace(grid, word, row, col, dir) {
    for (let i = 0; i < word.length; i++) {
        const r = row + i * dir[0];
        const c = col + i * dir[1];
        grid[r][c] = word[i];
    }
}

// ============================================
// WORD RENDER - TOUCH FIXED
// ============================================

function wordRender() {
    const gridEl = document.getElementById('wordGrid');
    if (!gridEl) return;
    
    const size = wordState.gridSize;
    gridEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    const responsive = getResponsiveSize();
    gridEl.style.gap = Math.max(2, responsive.padding) + 'px';
    gridEl.innerHTML = '';
    
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = i;
            cell.dataset.col = j;
            cell.textContent = wordState.grid[i][j];
            cell.style.fontSize = Math.max(11, responsive.cellSize * 0.55) + 'px';
            cell.style.aspectRatio = '1';
            cell.style.background = '#2d3748';
            cell.style.border = 'none';
            cell.style.color = 'white';
            cell.style.textAlign = 'center';
            cell.style.fontWeight = '700';
            cell.style.cursor = 'pointer';
            cell.style.outline = 'none';
            cell.style.borderRadius = '2px';
            cell.style.width = '100%';
            cell.style.height = '100%';
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            cell.style.transition = 'all 0.15s';
            cell.style.textTransform = 'uppercase';
            cell.style.touchAction = 'manipulation';
            cell.style.userSelect = 'none';
            cell.style.WebkitUserSelect = 'none';
            cell.style.fontFamily = 'Arial, sans-serif';
            
            let isFound = false;
            for (const word of wordState.foundWords) {
                if (word.positions.some(p => p[0] === i && p[1] === j)) {
                    isFound = true;
                    break;
                }
            }
            if (isFound) {
                cell.classList.add('found');
                cell.style.background = 'rgba(102,126,234,0.2)';
                cell.style.color = '#667eea';
            }
            
            // TOUCH: Click to select/deselect
            cell.addEventListener('click', function(e) {
                e.preventDefault();
                wordCellClick(parseInt(this.dataset.row), parseInt(this.dataset.col));
            });
            
            gridEl.appendChild(cell);
        }
    }
}

function wordResize() {
    const grid = document.getElementById('wordGrid');
    if (grid) {
        const size = getResponsiveSize();
        const fontSize = Math.max(11, size.cellSize * 0.55);
        document.querySelectorAll('.word-grid .cell').forEach(cell => {
            cell.style.fontSize = fontSize + 'px';
        });
        grid.style.gap = Math.max(2, size.padding) + 'px';
    }
}

// ============================================
// WORD CELL CLICK - TOUCH FRIENDLY
// ============================================

function wordCellClick(row, col) {
    const cell = document.querySelector(`.word-grid .cell[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    if (cell.classList.contains('found')) return;
    
    // Check if cell is already selected
    const idx = wordState.selectedCells.findIndex(p => p[0] === row && p[1] === col);
    if (idx !== -1) {
        // Deselect
        wordState.selectedCells.splice(idx, 1);
        cell.style.background = '#2d3748';
        cell.style.boxShadow = 'none';
        cell.classList.remove('selected');
        document.getElementById('wordHint').textContent = 'Tap cells to select letters';
    } else {
        // Select
        wordState.selectedCells.push([row, col]);
        cell.style.background = '#4a5568';
        cell.style.boxShadow = 'inset 0 0 0 2px #667eea';
        cell.classList.add('selected');
    }
    
    // Check if selected cells form a word
    const selected = wordState.selectedCells;
    if (selected.length >= 2) {
        const word = selected.map(([r, c]) => wordState.grid[r][c]).join('');
        const foundWord = wordState.words.find(w => 
            w === word && !wordState.foundWords.some(f => f.word === w)
        );
        if (foundWord) {
            // Word found!
            wordState.foundWords.push({ word: foundWord, positions: [...selected] });
            for (const [r, c] of selected) {
                const cellEl = document.querySelector(`.word-grid .cell[data-row="${r}"][data-col="${c}"]`);
                if (cellEl) {
                    cellEl.classList.add('found');
                    cellEl.style.background = 'rgba(102,126,234,0.2)';
                    cellEl.style.color = '#667eea';
                    cellEl.style.boxShadow = 'none';
                    cellEl.classList.remove('selected');
                }
            }
            wordState.selectedCells = [];
            wordUpdateStats();
            document.getElementById('wordMessage').textContent = `✅ Found: ${foundWord}!`;
            document.getElementById('wordMessage').style.color = '#10b981';
            
            if (wordState.foundWords.length === wordState.words.length) {
                document.getElementById('wordMessage').textContent = '🎉 All words found! You win!';
                document.getElementById('wordMessage').style.color = '#10b981';
            }
        } else {
            // Check if it's a prefix of any word
            const isPrefix = wordState.words.some(w => 
                w.startsWith(word) && !wordState.foundWords.some(f => f.word === w)
            );
            if (!isPrefix && selected.length > 2) {
                // Not a valid prefix - clear selection after delay
                setTimeout(() => {
                    for (const [r, c] of wordState.selectedCells) {
                        const cellEl = document.querySelector(`.word-grid .cell[data-row="${r}"][data-col="${c}"]`);
                        if (cellEl) {
                            cellEl.style.background = '#2d3748';
                            cellEl.style.boxShadow = 'none';
                            cellEl.classList.remove('selected');
                        }
                    }
                    wordState.selectedCells = [];
                    document.getElementById('wordHint').textContent = '❌ Not a valid word';
                    document.getElementById('wordHint').style.color = '#fc8181';
                    setTimeout(() => {
                        document.getElementById('wordHint').textContent = 'Tap cells to select letters';
                        document.getElementById('wordHint').style.color = 'rgba(255,255,255,0.6)';
                    }, 1500);
                }, 800);
            }
        }
    }
}

function wordUpdateStats() {
    document.getElementById('wordFound').textContent = wordState.foundWords.length;
    document.getElementById('wordTotal').textContent = wordState.words.length;
    document.getElementById('wordLevel').textContent = wordState.level.charAt(0).toUpperCase() + wordState.level.slice(1);
}

function wordNewGame() {
    wordState.foundWords = [];
    wordState.selectedCells = [];
    wordGenerate();
}

function wordHint() {
    if (wordState.hints <= 0) {
        document.getElementById('wordMessage').textContent = '❌ No hints left!';
        document.getElementById('wordMessage').style.color = '#fc8181';
        return;
    }
    
    const unfound = wordState.words.filter(w => !wordState.foundWords.some(f => f.word === w));
    if (unfound.length === 0) {
        document.getElementById('wordMessage').textContent = '🎉 All words found!';
        document.getElementById('wordMessage').style.color = '#10b981';
        return;
    }
    
    const word = unfound[0];
    // Find the word in the grid and highlight it
    for (let i = 0; i < wordState.gridSize; i++) {
        for (let j = 0; j < wordState.gridSize; j++) {
            if (wordState.grid[i][j] === word[0]) {
                const dirs = [
                    [0, 1], [1, 0], [1, 1], [1, -1],
                    [0, -1], [-1, 0], [-1, -1], [-1, 1]
                ];
                for (const d of dirs) {
                    let match = true;
                    for (let k = 0; k < word.length; k++) {
                        const r = i + k * d[0];
                        const c = j + k * d[1];
                        if (r < 0 || r >= wordState.gridSize || c < 0 || c >= wordState.gridSize) {
                            match = false;
                            break;
                        }
                        if (wordState.grid[r][c] !== word[k]) {
                            match = false;
                            break;
                        }
                    }
                    if (match) {
                        // Highlight the word
                        for (let k = 0; k < word.length; k++) {
                            const r = i + k * d[0];
                            const c = j + k * d[1];
                            const cell = document.querySelector(`.word-grid .cell[data-row="${r}"][data-col="${c}"]`);
                            if (cell && !cell.classList.contains('found')) {
                                cell.style.background = 'rgba(102,126,234,0.3)';
                                cell.classList.add('highlight-hint');
                                setTimeout(() => {
                                    cell.style.background = '#2d3748';
                                    cell.classList.remove('highlight-hint');
                                }, 2000);
                            }
                        }
                        wordState.hints--;
                        document.getElementById('wordHints').textContent = wordState.hints;
                        document.getElementById('wordHintCount').textContent = wordState.hints;
                        document.getElementById('wordMessage').textContent = `💡 Hint: "${word}" is highlighted!`;
                        document.getElementById('wordMessage').style.color = '#667eea';
                        return;
                    }
                }
            }
        }
    }
}

function wordRevealAll() {
    for (const word of wordState.words) {
        if (wordState.foundWords.some(f => f.word === word)) continue;
        
        for (let i = 0; i < wordState.gridSize; i++) {
            for (let j = 0; j < wordState.gridSize; j++) {
                if (wordState.grid[i][j] === word[0]) {
                    const dirs = [
                        [0, 1], [1, 0], [1, 1], [1, -1],
                        [0, -1], [-1, 0], [-1, -1], [-1, 1]
                    ];
                    for (const d of dirs) {
                        let match = true;
                        const positions = [];
                        for (let k = 0; k < word.length; k++) {
                            const r = i + k * d[0];
                            const c = j + k * d[1];
                            if (r < 0 || r >= wordState.gridSize || c < 0 || c >= wordState.gridSize) {
                                match = false;
                                break;
                            }
                            if (wordState.grid[r][c] !== word[k]) {
                                match = false;
                                break;
                            }
                            positions.push([r, c]);
                        }
                        if (match) {
                            wordState.foundWords.push({ word, positions });
                            for (const [r, c] of positions) {
                                const cell = document.querySelector(`.word-grid .cell[data-row="${r}"][data-col="${c}"]`);
                                if (cell) {
                                    cell.classList.add('found');
                                    cell.style.background = 'rgba(102,126,234,0.2)';
                                    cell.style.color = '#667eea';
                                }
                            }
                            break;
                        }
                    }
                    break;
                }
            }
        }
    }
    wordUpdateStats();
    document.getElementById('wordMessage').textContent = '✨ All words revealed!';
    document.getElementById('wordMessage').style.color = '#10b981';
    if (wordState.foundWords.length === wordState.words.length) {
        document.getElementById('wordMessage').textContent = '🎉 All words found! You win!';
    }
}

function wordSetLevel(level) {
    wordState.level = level;
    document.querySelectorAll('.level-btn').forEach(btn => {
        btn.classList.remove('active');
        const text = btn.textContent.trim().toLowerCase();
        if (text.includes('easy') && level === 'easy') btn.classList.add('active');
        else if (text.includes('medium') && level === 'medium') btn.classList.add('active');
        else if (text.includes('hard') && level === 'hard') btn.classList.add('active');
        else if (text.includes('expert') && level === 'expert') btn.classList.add('active');
    });
    document.getElementById('wordLevel').textContent = level.charAt(0).toUpperCase() + level.slice(1);
    wordNewGame();
}

function wordSetComplexity(complexity) {
    wordState.complexity = complexity;
    document.querySelectorAll('.complexity-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.trim().toLowerCase().includes(complexity)) {
            btn.classList.add('active');
        }
    });
    wordNewGame();
}

// ============================================
// EXPOSE FUNCTIONS
// ============================================

// Sudoku
window.loadSudokuFullscreen = loadSudokuFullscreen;
window.sudokuSetLevel = sudokuSetLevel;
window.sudokuNewGame = sudokuNewGame;
window.sudokuHint = sudokuHint;
window.sudokuSolve = sudokuSolve;
window.sudokuCheck = sudokuCheck;
window.sudokuResize = sudokuResize;
window.sudokuInputNumber = sudokuInputNumber;
window.sudokuClearCell = sudokuClearCell;
window.sudokuSelectCell = sudokuSelectCell;

// Word Puzzle
window.loadWordFullscreen = loadWordFullscreen;
window.wordSetLevel = wordSetLevel;
window.wordSetComplexity = wordSetComplexity;
window.wordNewGame = wordNewGame;
window.wordHint = wordHint;
window.wordRevealAll = wordRevealAll;
window.wordResize = wordResize;

// Responsive helper
window.getResponsiveSize = getResponsiveSize;

console.log('🎮 Games loaded: Sudoku & Word Puzzle (Touch Friendly)');