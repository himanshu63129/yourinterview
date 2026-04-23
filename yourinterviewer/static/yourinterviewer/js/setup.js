/**
 * setup.js — yourInterviewer
 *
 * Handles the setup page:
 *   - Domain card selection
 *   - Global Domain search/input
 *   - Round pill toggling
 *   - Questions-per-round card selection
 */

// ── State ─────────────────────────────────────────────────────────────
let selectedDomain = null;
let selectedRounds = ['hr', 'technical', 'coding'];  // all on by default
let selectedQPR    = 5;                               // default: Quick
let selectedExp    = 'fresher';                       // default

const searchInput = document.getElementById('domain-search-input');

// ── Domain selection ──────────────────────────────────────────────────

// 1. Handing card clicks
document.querySelectorAll('.domain-card').forEach(card => {
  card.addEventListener('click', () => {

    // Highlight clicked card
    document.querySelectorAll('.domain-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');

    // Sync to search input
    selectedDomain = card.dataset.domain;
    searchInput.value = selectedDomain;

    updateStartBtn();
    clearError();
  });
});

// 2. Handling typing in search input
searchInput.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  selectedDomain = val || null;

  // Deselect all cards if user is typing something new
  document.querySelectorAll('.domain-card').forEach(c => {
    if (c.dataset.domain === val) {
       c.classList.add('selected');
    } else {
       c.classList.remove('selected');
    }
  });

  updateStartBtn();
  if (selectedDomain) clearError();
});

// Helper: refresh start button text/state
function updateStartBtn() {
  const btn = document.getElementById('cta-btn');
  if (selectedDomain) {
    btn.disabled = false;
    btn.textContent = `Start ${selectedDomain} Interview →`;
  } else {
    btn.disabled = true;
    btn.textContent = 'Enter or select a domain to begin';
  }
}


// ── Round pills — toggle on/off ────────────────────────────────────────
document.querySelectorAll('.round-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const round = pill.dataset.round;

    pill.classList.toggle('active');

    if (pill.classList.contains('active')) {
      if (!selectedRounds.includes(round)) selectedRounds.push(round);
    } else {
      selectedRounds = selectedRounds.filter(r => r !== round);
      // Keep at least one
      if (selectedRounds.length === 0) {
        pill.classList.add('active');
        selectedRounds.push(round);
        showError('You must select at least one round.');
      }
    }
  });
});


// ── Questions per round cards ──────────────────────────────────────────
document.querySelectorAll('.qpr-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.qpr-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectedQPR = parseInt(card.dataset.qpr);
  });
});


// ── Experience stage cards ──────────────────────────────────────────
document.querySelectorAll('.exp-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.exp-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectedExp = card.dataset.exp;
    clearError();
  });
});


// ── Start button ───────────────────────────────────────────────────────
document.getElementById('cta-btn').addEventListener('click', async () => {

  if (!selectedDomain) {
    showError('Please enter or select a domain first.');
    return;
  }

  if (selectedRounds.length === 0) {
    showError('Please select at least one interview round.');
    return;
  }

  const btn       = document.getElementById('cta-btn');
  btn.disabled    = true;
  btn.textContent = 'Setting up your interview…';
  clearError();

  try {
    const languageInput = document.getElementById('language-input')?.value.trim() || '';

    const res = await fetch('/api/start/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain:              selectedDomain,
        language:            languageInput,
        rounds:              selectedRounds,
        questions_per_round: selectedQPR,
        experience_level:    selectedExp,
      }),
    });


    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data = await res.json();
    window.location.href = `/interview/${data.session_id}/`;

  } catch (e) {
    showError(e.message || 'Could not start session.');
    btn.disabled    = false;
    btn.textContent = `Start ${selectedDomain} Interview →`;
  }
});


// ── Helpers ────────────────────────────────────────────────────────────
function showError(msg) {
  document.getElementById('err').textContent = msg;
}

function clearError() {
  document.getElementById('err').textContent = '';
}
