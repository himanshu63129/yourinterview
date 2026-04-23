/**
 * app.js — yourInterviewer
 *
 * Main interview controller.
 * Orchestrates the full flow: rounds → questions → answers → results.
 *
 * Depends on (must load before this file):
 *   speech.js  →  Speech
 *   ui.js      →  UI
 *
 * Globals injected by interview.html:
 *   SESSION_ID, SESSION_DOMAIN, SESSION_ROUNDS, QPR
 */

const App = (() => {
  // ── State ─────────────────────────────────────────────────────────
  const S = {
    roundIdx: 0, // index into SESSION_ROUNDS array
    qNum: 0, // current question number (1-based)
    questionId: null, // DB id of current QuestionAnswer row
    answer: "", // current accumulated answer text
    totalPts: 0, // running total score
    perRound: {}, // { hr:[7,8,..], technical:[..], coding:[..] }
    busy: false, // true while API call is in progress
  };

  // Initialise per-round score buckets
  SESSION_ROUNDS.forEach((r) => (S.perRound[r] = []));

  // ── CSRF token (required by Django for POST requests) ─────────────
  function getCSRF() {
    return (
      document.cookie
        .split(";")
        .find((c) => c.trim().startsWith("csrftoken="))
        ?.split("=")[1]
        ?.trim() ?? ""
    );
  }

  // ── API helpers ───────────────────────────────────────────────────

  async function post(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCSRF(),
      },
      body: JSON.stringify(body),
    });
    
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || `Server Error (${res.status})`);
    }
    return data;
  }

  async function get(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || `Server Error (${res.status})`);
    }
    return data;
  }

  // ── ROUND START ───────────────────────────────────────────────────

  function startRound() {
    const round = SESSION_ROUNDS[S.roundIdx];
    const cfg = UI.ROUNDS[round];

    // Reset state for new round
    S.qNum = 0;
    S.busy = false;
    S.answer = "";

    // Reset UI
    UI.setRound(round);
    UI.clearHistory();
    UI.resetScore();
    UI.nextBtn(false);
    UI.setMic("off");
    UI.submitEnabled(false);
    clearTextInput();

    // Intro speech for this round
    const intros = {
      hr:
        `Hello! Welcome to the HR round for the ${SESSION_DOMAIN} role. ` +
        `I'll be your HR interviewer today and I have ${QPR} questions for you. Let's get started!`,

      technical:
        `Hi! Welcome to the technical round for ${SESSION_DOMAIN}. ` +
        `I'll assess your technical knowledge with ${QPR} questions. ` +
        `Take your time and think out loud.`,

      coding:
        `Hello! Welcome to the coding round for ${SESSION_DOMAIN}. ` +
        `I have ${QPR} problem-solving questions for you. ` +
        `You can explain your approach verbally or type it out — whatever works best for you.`,
    };

    UI.setQuestion(intros[round]);
    UI.status("speaking");
    UI.setSpeaking(true);

    Speech.speak(intros[round], () => {
      UI.setSpeaking(false);
      UI.status("idle");
      loadQuestion(); // automatically load first question
    });
  }

  // ── LOAD QUESTION ─────────────────────────────────────────────────

  async function loadQuestion() {
    S.qNum++;
    S.busy = false;
    S.answer = "";
    S.questionId = null;

    const round = SESSION_ROUNDS[S.roundIdx];

    // Update UI immediately
    UI.setQLabel(S.qNum, QPR);
    UI.setDots(S.qNum, QPR);
    UI.setQuestion("Generating question…", true);
    UI.setTranscript("Click 🎤 to speak  or  type your answer below…", true);
    UI.setMic("off");
    UI.submitEnabled(false);
    UI.resetScore();
    UI.nextBtn(false);
    UI.status("thinking");
    clearTextInput();

    try {
      // Call Django → services.py → Gemini
      const data = await get(
        `/api/${SESSION_ID}/question/` +
          `?round_type=${round}&question_number=${S.qNum}`
      );

      S.questionId = data.question_id;

      // Show question and speak it aloud
      UI.setQuestion(data.question);
      UI.status("speaking");
      UI.setSpeaking(true);

      Speech.speak(data.question, () => {
        // After speaking — enable mic and wait for answer
        UI.setSpeaking(false);
        UI.status("idle");
        UI.setMic("idle");
      });
    } catch (e) {
      const msg = e.message || '';
      const isQuota = msg.includes('QUOTA') || msg.includes('quota') || msg.includes('429');

      if (isQuota) {
        // Friendly message — server is already retrying in the background
        UI.setQuestion("⏳ Preparing your question, please wait a moment…", true);
        UI.status("thinking");
      } else {
        UI.setQuestion("⚠️ Could not load question.", false);
        UI.status("idle");
        alert(`Interviewer Error: ${e.message}\n\nPlease wait a moment and try refreshing.`);
      }
    }
  }

  // ── SUBMIT ANSWER ─────────────────────────────────────────────────

  async function submitAnswer() {
    if (S.busy) return;

    const answer = S.answer.trim();
    if (!answer) return;

    // Lock UI while evaluating
    S.busy = true;
    Speech.stopRecording();
    UI.setMic("off");
    UI.submitEnabled(false);
    disableTextInput(true);
    UI.status("thinking");
    UI.setSpeaking(false);

    const round = SESSION_ROUNDS[S.roundIdx];

    try {
      // Send answer to Django → services.py → Gemini for evaluation
      const ev = await post(`/api/${SESSION_ID}/answer/`, {
        question_id: S.questionId,
        answer_text: answer,
      });

      // Update running totals
      S.totalPts = ev.session_total;
      S.perRound[round].push(ev.score);

      // Update UI with scores
      UI.setTotal(S.totalPts);
      UI.showScore(ev.score, ev.clarity, ev.depth, ev.feedback);
      UI.addHistory(document.getElementById("q-text").textContent, ev.score);

      // Interviewer speaks the feedback aloud
      const spokenFeedback = `You scored ${ev.score} out of 10. ${ev.feedback}`;

      UI.status("speaking");
      UI.setSpeaking(true);

      Speech.speak(spokenFeedback, () => {
        UI.setSpeaking(false);
        UI.status("idle");
        disableTextInput(false);

        // Decide what comes next
        const isLastQuestion = S.qNum >= QPR;
        const isLastRound = S.roundIdx >= SESSION_ROUNDS.length - 1;

        if (!isLastQuestion) {
          // More questions in this round
          UI.nextBtn(true, "Next Question →", () => {
            clearTextInput();
            loadQuestion();
          });
        } else if (!isLastRound) {
          // Move to the next round
          const nextRound = SESSION_ROUNDS[S.roundIdx + 1];
          const nextRoundName = UI.ROUNDS[nextRound]?.label || "Next Round";

          UI.nextBtn(true, `Start ${nextRoundName} →`, () => {
            clearTextInput();
            S.roundIdx++;
            startRound();
          });
        } else {
          // All rounds complete — go to results
          UI.nextBtn(true, "View My Results →", finishInterview);
        }
      });
    } catch (e) {
      // Unlock UI on error
      S.busy = false;
      disableTextInput(false);
      UI.setMic("idle");
      UI.submitEnabled(true);
      UI.status("idle");
      const msg = e.message || '';
      const isQuota = msg.includes('QUOTA') || msg.includes('quota') || msg.includes('429');
      if (isQuota) {
        alert("The AI evaluator is temporarily busy.\nPlease wait 30-60 seconds and re-submit your answer.");
      } else {
        alert(`Evaluation Error: ${e.message}`);
      }
    }
  }

  // ── FINISH INTERVIEW ──────────────────────────────────────────────

  async function finishInterview() {
    console.log("finishInterview entered. S.busy status:", S.busy);
    UI.status("thinking");
    UI.setSpeaking(false);
    UI.nextBtn(false);
    UI.setQuestion("Wrapping up your interview…", true);

    try {
      console.log(`Sending finish request to: /api/${SESSION_ID}/finish/`);
      const data = await post(`/api/${SESSION_ID}/finish/`, {
        per_round_scores: S.perRound,
      });
      console.log("Finish request successful. data:", data);
      window.location.href = data.results_url;
    } catch (e) {
      console.warn("API finish failed. Fallback redirect.", e);
      window.location.href = `/results/${SESSION_ID}/`;
    }
  }

  // ── ANSWER INPUT HELPERS ──────────────────────────────────────────

  function onAnswerChange(text) {
    S.answer = text;
    // Enable submit only if there is text and no API call running
    UI.submitEnabled(text.trim().length > 0 && !S.busy);
  }

  function clearTextInput() {
    const t = document.getElementById("text-input");
    t.value = "";
    t.disabled = false;
    UI.setTranscript("Click 🎤 to speak  or  type your answer below…", true);
  }

  function disableTextInput(disabled) {
    document.getElementById("text-input").disabled = disabled;
  }

  // ── NAVIGATION HELPERS ────────────────────────────────────────────

  function goBack() {
    Speech.stopSpeaking();
    Speech.stopRecording();
    if (confirm("Are you sure you want to go back? Your current interview progress will be lost.")) {
       window.location.href = "/";
    }
  }

  // ── EVENT BINDING ─────────────────────────────────────────────────

  function bindEvents() {
    // Stop speaking immediately on browser back/navigation
    window.addEventListener("popstate", () => Speech.stopSpeaking());
    window.addEventListener("beforeunload", () => Speech.stopSpeaking());
    // ── Mic button — toggle recording ──────────────────────────────
    document.getElementById("mic-btn").addEventListener("click", () => {
      const textInput = document.getElementById("text-input");
      const currentText = textInput.value.trim();

      if (Speech.isRecording()) {
        // Stop recording
        Speech.stopRecording();
        UI.setMic("idle");
        UI.status("idle");
      } else {
        // Start recording
        // Pre-fill transcript with existing text to allow continuation
        const started = Speech.startRecording({
          initialText: currentText,
          onUpdate: (text, isFinal) => {
            UI.setTranscript(text, false);
            
            // Sync voice transcript to text-input
            if (text.trim()) {
              textInput.value = text;
              onAnswerChange(text);
            }
          },

          onEnd: () => {
            UI.setMic("idle");
            UI.status("idle");
            // Final sync
            const t = Speech.getTranscript();
            if (t) {
              textInput.value = t;
              onAnswerChange(t);
            }
          },
        });

        if (started) {
          UI.setMic("recording");
          UI.status("listening");
        }
      }
    });

    // ── Text input — typed answer ───────────────────────────────────
    document.getElementById("text-input").addEventListener("input", (e) => {
      const val = e.target.value;

      if (val.trim()) {
        UI.setTranscript(val, false);
        onAnswerChange(val);
      } else {
        UI.setTranscript(
          "Click 🎤 to speak  or  type your answer below…",
          true
        );
        onAnswerChange("");
      }
    });

    // ── Submit button ───────────────────────────────────────────────
    document
      .getElementById("submit-btn")
      .addEventListener("click", submitAnswer);

    // ── Enter key in textarea ───────────────────────────────────────
    // Enter = submit,  Shift+Enter = new line
    document.getElementById("text-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const btn = document.getElementById("submit-btn");
        if (!btn.disabled) submitAnswer();
      }
    });
  }

  // ── INIT ──────────────────────────────────────────────────────────

  function init() {
    if (!SESSION_ROUNDS?.length) {
      alert("No rounds configured. Redirecting to setup…");
      window.location.href = "/";
      return;
    }
    bindEvents();
    startRound();
  }

  return { init, quit: finishInterview, goBack };
})();

// Boot when DOM is ready
document.addEventListener("DOMContentLoaded", App.init);
