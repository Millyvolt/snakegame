const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const gridSize = 20;
const tileCount = canvas.width / gridSize;
let snake = [{ x: 10, y: 10 }];
let direction = { x: 0, y: 0 };
let food = { x: 5, y: 5 };
let gameOver = false;
let score = 0;
let gameStarted = false;

// --- Smooth movement timing ---
let tickIntervalMs = 100; // logical update rate (ms per grid step)
let lastTickTime = 0; // timestamp of last completed tick
let snakePrev = [];

function copySnakePositions(sourceSnake) {
    return sourceSnake.map(p => ({ x: p.x, y: p.y }));
}

function wrapAxis(value) {
    const n = tileCount;
    return ((value % n) + n) % n;
}

function interpolateAxis(prevVal, currVal, t) {
    // Handle wrap-around shortest path for single-step moves
    let delta = currVal - prevVal;
    if (delta > 1) delta -= tileCount;
    else if (delta < -1) delta += tileCount;
    return prevVal + delta * t;
}

function getInterpolatedSegment(index, t) {
    const prev = snakePrev[index] ?? snake[index] ?? snakePrev[snakePrev.length - 1];
    const curr = snake[index] ?? snakePrev[index] ?? snake[snake.length - 1];
    const x = wrapAxis(interpolateAxis(prev.x, curr.x, t));
    const y = wrapAxis(interpolateAxis(prev.y, curr.y, t));
    return { x, y };
}

// --- Sound effects (Web Audio API) ---
let audioContext = null;
let soundEnabled = true;

function getAudioContext() {
    if (!audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();
    }
    // Best effort resume (some browsers start suspended until user gesture)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    return audioContext;
}

function playTone(frequency, durationMs, type = 'sine', volume = 0.08) {
    try {
        if (!soundEnabled) return;
        const ctx = getAudioContext();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
        gain.gain.setValueAtTime(Math.max(0.0001, volume), ctx.currentTime);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        // Simple decay envelope
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
        oscillator.start(now);
        oscillator.stop(now + durationMs / 1000);
    } catch (_) {
        // Ignore audio errors to avoid breaking gameplay
    }
}

function playEat() {
    // Quick ascending blip
    playTone(650, 70, 'square', 0.08);
    setTimeout(() => playTone(820, 80, 'square', 0.08), 60);
}

function playGameOver() {
    // Falling tone pair
    playTone(300, 250, 'sawtooth', 0.1);
    setTimeout(() => playTone(180, 350, 'sawtooth', 0.1), 200);
}

function ensureAudioUnlocked() {
    try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();
    } catch (_) {
        // No-op
    }
}

function handleGameOver() {
    if (gameOver) return;
    gameOver = true;
    playGameOver();
    const message = 'Game Over! Your score: ' + score;
    // Give the sound a moment to play before blocking alert
    setTimeout(() => {
        try { alert(message); } catch (_) {}
    }, 500);
    setTimeout(() => {
        try { document.location.reload(); } catch (_) {}
    }, 1000);
}

function draw(interp = 1) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw snake body (excluding head and tail)
    ctx.fillStyle = '#0f0';
    for (let i = 1; i < snake.length - 1; i++) {
        const seg = getInterpolatedSegment(i, interp);
        ctx.beginPath();
        ctx.arc(
            seg.x * gridSize + gridSize / 2,
            seg.y * gridSize + gridSize / 2,
            gridSize / 2 - 0.25,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    // Draw tail if snake is longer than 1
    if (snake.length > 1) {
        const tail = getInterpolatedSegment(snake.length - 1, interp);
        ctx.fillStyle = '#145a1f'; // darker green for tail
        ctx.beginPath();
        ctx.arc(
            tail.x * gridSize + gridSize / 2,
            tail.y * gridSize + gridSize / 2,
            gridSize / 2 - 1.5,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    // Draw snake head
    if (snake.length > 0) {
        const head = getInterpolatedSegment(0, interp);
        ctx.fillStyle = '#2ecc40'; // brighter green for head
        ctx.beginPath();
        ctx.arc(
            head.x * gridSize + gridSize / 2,
            head.y * gridSize + gridSize / 2,
            gridSize / 2 - 0.25,
            0,
            Math.PI * 2
        );
        ctx.fill();

        // Draw eyes
        ctx.fillStyle = '#fff';
        let eyeOffsetX = 0, eyeOffsetY = 0;
        if (direction.x === 1) eyeOffsetX = 4;
        if (direction.x === -1) eyeOffsetX = -4;
        if (direction.y === 1) eyeOffsetY = 4;
        if (direction.y === -1) eyeOffsetY = -4;
        // Default eyes for no movement
        if (direction.x === 0 && direction.y === 0) eyeOffsetX = 4;
        // Left eye
        ctx.beginPath();
        ctx.arc(
            head.x * gridSize + gridSize / 2 + eyeOffsetX - 3,
            head.y * gridSize + gridSize / 2 + eyeOffsetY - 3,
            4,
            0,
            Math.PI * 2
        );
        ctx.fill();
        // Right eye
        ctx.beginPath();
        ctx.arc(
            head.x * gridSize + gridSize / 2 + eyeOffsetX + 3,
            head.y * gridSize + gridSize / 2 + eyeOffsetY - 3,
            4,
            0,
            Math.PI * 2
        );
        ctx.fill();

        // Draw mouth
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let mouthX = head.x * gridSize + gridSize / 2 + eyeOffsetX;
        let mouthY = head.y * gridSize + gridSize / 2 + eyeOffsetY + 4;
        if (direction.x === 0 && direction.y === 0) {
            mouthX = head.x * gridSize + gridSize / 2 + 6;
            mouthY = head.y * gridSize + gridSize / 2 + 4;
        }
        if (direction.x !== 0) {
            ctx.arc(mouthX, mouthY, 3, Math.PI * 0.25, Math.PI * 0.75, false);
        } else {
            ctx.arc(mouthX, mouthY, 3, 0, Math.PI, false);
        }
        ctx.stroke();
    }

    // Draw food
    ctx.fillStyle = '#f00';
    ctx.beginPath();
    ctx.arc(
        food.x * gridSize + gridSize / 2,
        food.y * gridSize + gridSize / 2,
        gridSize / 2 - 0.25,
        0,
        Math.PI * 2
    );
    ctx.fill();

    // Draw score
    ctx.fillStyle = '#fff';
    ctx.font = '18px Arial';
    ctx.fillText('Score: ' + score, 10, 20);

    // Draw start message if not started
    if (!gameStarted) {
        ctx.fillStyle = '#fff';
        ctx.font = '24px Arial';
        ctx.fillText('Press an arrow key to start', 50, canvas.height / 2);
    }
}

function update() {
    if (gameOver || !gameStarted) return;
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

    // Wrap around instead of wall collision game over
    if (head.x < 0) head.x = tileCount - 1;
    else if (head.x >= tileCount) head.x = 0;
    if (head.y < 0) head.y = tileCount - 1;
    else if (head.y >= tileCount) head.y = 0;

    // Check self collision
    for (let part of snake) {
        if (head.x === part.x && head.y === part.y) {
            handleGameOver();
            return;
        }
    }

    snake.unshift(head);

    // Check food collision
    if (head.x === food.x && head.y === food.y) {
        score++;
        playEat();
        placeFood();
    } else {
        snake.pop();
    }
}

function placeFood() {
    food = {
        x: Math.floor(Math.random() * tileCount),
        y: Math.floor(Math.random() * tileCount)
    };
    // Avoid placing food on the snake
    for (let part of snake) {
        if (food.x === part.x && food.y === part.y) {
            placeFood();
            return;
        }
    }
}

document.addEventListener('keydown', e => {
    if (!gameStarted && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        ensureAudioUnlocked();
        switch (e.key) {
            case 'ArrowUp':
                direction = { x: 0, y: -1 };
                break;
            case 'ArrowDown':
                direction = { x: 0, y: 1 };
                break;
            case 'ArrowLeft':
                direction = { x: -1, y: 0 };
                break;
            case 'ArrowRight':
                direction = { x: 1, y: 0 };
                break;
        }
        gameStarted = true;
        requestAnimationFrame(gameLoop);
        return;
    }
    if (!gameStarted) return;
    switch (e.key) {
        case 'ArrowUp':
            if (direction.y === 1) break;
            direction = { x: 0, y: -1 };
            break;
        case 'ArrowDown':
            if (direction.y === -1) break;
            direction = { x: 0, y: 1 };
            break;
        case 'ArrowLeft':
            if (direction.x === 1) break;
            direction = { x: -1, y: 0 };
            break;
        case 'ArrowRight':
            if (direction.x === -1) break;
            direction = { x: 1, y: 0 };
            break;
    }
});

// --- Settings panel wiring ---
window.addEventListener('DOMContentLoaded', () => {
    const soundToggle = document.getElementById('soundToggle');
    const speedSlider = document.getElementById('speedSlider');
    const speedValue = document.getElementById('speedValue');

    if (soundToggle) {
        soundToggle.checked = soundEnabled;
        soundToggle.addEventListener('change', () => {
            soundEnabled = soundToggle.checked;
            if (soundEnabled) ensureAudioUnlocked();
        });
    }

    if (speedSlider && speedValue) {
        // Initialize display
        speedSlider.value = String(tickIntervalMs);
        speedValue.textContent = String(tickIntervalMs);
        speedSlider.addEventListener('input', () => {
            const newVal = parseInt(speedSlider.value, 10);
            if (!Number.isNaN(newVal) && newVal >= 50 && newVal <= 300) {
                tickIntervalMs = newVal;
                speedValue.textContent = String(newVal);
            }
        });
    }
});

function gameLoop(timestamp) {
    if (!lastTickTime) {
        lastTickTime = timestamp;
        snakePrev = copySnakePositions(snake);
    }

    // Fixed-step update loop for logic
    while (!gameOver && gameStarted && timestamp - lastTickTime >= tickIntervalMs) {
        snakePrev = copySnakePositions(snake);
        update();
        lastTickTime += tickIntervalMs;
    }

    const interp = Math.max(0, Math.min(1, (timestamp - lastTickTime) / tickIntervalMs));
    draw(interp);

    if (!gameOver && gameStarted) {
        requestAnimationFrame(gameLoop);
    }
}

draw();
placeFood(); 