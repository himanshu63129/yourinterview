/**
 * ui.js — yourInterviewer
 *
 * Pure DOM helpers. Zero business logic lives here.
 * app.js calls these functions — it never touches the DOM directly.
 */

const UI = (() => {
  // ── Shorthand ─────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ── Interviewer personas per round ────────────────────────────────
  const ROUNDS = {
    hr: {
      label: "HR Round",
      chip: "hr",
      avatar: "🧑‍💼",
      name: "HR Interviewer",
      role: "HR Manager · yourInterviewer",
    },
    technical: {
      label: "Technical Round",
      chip: "technical",
      avatar: "🧑‍💻",
      name: "Technical Interviewer",
      role: "Senior Engineer · yourInterviewer",
    },
    coding: {
      label: "Coding Round",
      chip: "coding",
      avatar: "🧑‍🔬",
      name: "Coding Interviewer",
      role: "Tech Lead · yourInterviewer",
    },
  };

  // ── Status pill ───────────────────────────────────────────────────
  // states: 'idle' | 'speaking' | 'listening' | 'thinking'
  function status(s) {
    const el = $("status-pill");
    el.className = "status-pill " + s;
    el.textContent = s;
  }

  // ── Round — updates avatar, name, role, badge chip ────────────────
  function setRound(r) {
    const cfg = ROUNDS[r] || ROUNDS.technical;

    $("avatar").textContent = cfg.avatar;
    $("iv-name").textContent = cfg.name;
    $("iv-role").textContent = cfg.role;

    const chip = $("round-chip");
    chip.textContent = cfg.label;
    chip.className = "round-chip " + cfg.chip;
  }

  // ── Question counter label  e.g. "Q3 / 10" ───────────────────────
  function setQLabel(current, total) {
    $("q-label").textContent = `Q${current} / ${total}`;
  }

  // ── Progress dots below the round chip ───────────────────────────
  function setDots(current, total) {
    const container = $("q-dots");
    container.innerHTML = "";

    for (let i = 1; i <= total; i++) {
      const dot = document.createElement("div");

      if (i < current) dot.className = "qdot done";
      else if (i === current) dot.className = "qdot current";
      else dot.className = "qdot";

      container.appendChild(dot);
    }
  }

  // ── Question text ─────────────────────────────────────────────────
  function setQuestion(text, loading = false) {
    const el = $("q-text");
    el.textContent = text;
    el.className = loading ? "q-text loading" : "q-text";
  }

  // ── Transcript (live voice / typed answer preview) ────────────────
  function setTranscript(text, placeholder = false) {
    const el = $("transcript");
    el.textContent = text;
    el.className = placeholder ? "transcript placeholder" : "transcript";
  }

  // ── Mic button states ─────────────────────────────────────────────
  // state: 'idle' | 'recording' | 'off'
  function setMic(state) {
    const btn = $("mic-btn");

    if (state === "recording") {
      btn.className = "mic-btn recording";
      btn.textContent = "⏹";
      btn.disabled = false;
    } else if (state === "off") {
      btn.className = "mic-btn";
      btn.textContent = "🎤";
      btn.disabled = true;
    } else {
      // idle — ready to record
      btn.className = "mic-btn";
      btn.textContent = "🎤";
      btn.disabled = false;
    }
  }

  // ── Submit button ─────────────────────────────────────────────────
  function submitEnabled(enabled) {
    $("submit-btn").disabled = !enabled;
  }

  // ── Next / finish button ──────────────────────────────────────────
  function nextBtn(show, label, onClick) {
    const btn = $("next-btn");

    if (!show) {
      btn.classList.add("hidden");
      return;
    }

    btn.textContent = label;
    btn.classList.remove("hidden");
    btn.onclick = onClick;
  }

  // ── Avatar speaking ring ──────────────────────────────────────────
  function setSpeaking(on) {
    $("avatar").classList.toggle("speaking", on);
  }

  // ── Live score display ────────────────────────────────────────────
  function showScore(score, clarity, depth, feedback) {
    // Big number + colour
    const big = $("score-big");
    big.textContent = score;
    big.style.color =
      score >= 8
        ? "var(--green)"
        : score >= 5
        ? "var(--accent)"
        : "var(--pink)";

    // Star rating  (0–10 → 0–5 stars)
    const starCount = Math.round(score / 2);
    $("stars").textContent = "⭐".repeat(starCount) + "☆".repeat(5 - starCount);

    // Animated bars
    _setBar("score", score);
    _setBar("clarity", clarity);
    _setBar("depth", depth);

    // AI feedback text
    $("feedback-box").textContent = feedback;
  }

  function _setBar(name, value) {
    $("bf-" + name).style.width = value * 10 + "%";
    $("bv-" + name).textContent = value + "/10";
  }

  // ── Reset score panel between questions ──────────────────────────
  function resetScore() {
    const big = $("score-big");
    big.textContent = "—";
    big.style.color = "";

    $("stars").textContent = "☆☆☆☆☆";

    ["score", "clarity", "depth"].forEach((name) => {
      $("bf-" + name).style.width = "0%";
      $("bv-" + name).textContent = "—";
    });

    $("feedback-box").textContent = "Awaiting your answer…";
  }

  // ── Total points in header ────────────────────────────────────────
  function setTotal(value) {
    $("total-pts").textContent = value;
  }

  // ── Answer history list ───────────────────────────────────────────
  function addHistory(questionText, score) {
    const list = $("hist-list");

    // Remove the "No answers yet" placeholder
    list.querySelector(".hist-empty")?.remove();

    const item = document.createElement("div");
    item.className = "hist-item";

    const scoreClass = score >= 8 ? "good" : score >= 5 ? "ok" : "bad";

    // Truncate long questions
    const short =
      questionText.length > 46 ? questionText.slice(0, 46) + "…" : questionText;

    item.innerHTML =
      `<span class="hi-q">${short}</span>` +
      `<span class="hi-s ${scoreClass}">${score}/10</span>`;

    list.appendChild(item);

    // Auto scroll to latest
    list.scrollTop = list.scrollHeight;
  }

  function clearHistory() {
    $("hist-list").innerHTML = '<div class="hist-empty">No answers yet</div>';
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    ROUNDS,
    status,
    setRound,
    setQLabel,
    setDots,
    setQuestion,
    setTranscript,
    setMic,
    submitEnabled,
    nextBtn,
    setSpeaking,
    showScore,
    resetScore,
    setTotal,
    addHistory,
    clearHistory,
  };
})();
