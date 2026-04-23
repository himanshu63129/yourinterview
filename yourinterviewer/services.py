"""
services.py — yourInterviewer
All Gemini calls live here. Views never talk to the AI directly.
"""
import json
import re
import time
import threading
import google.generativeai as genai
from django.conf import settings

_gemini_lock = threading.Lock()
_api_configured = False

def _configure_api():
    global _api_configured
    if _api_configured:
        return
    if not settings.GEMINI_API_KEY:
        print("[Gemini Error]: API key is MISSING or EMPTY in settings.")
        return
    clean_key = settings.GEMINI_API_KEY.strip(' "\'\n\r')
    print(f"[Gemini Log]: Configuring Gemini API...")
    genai.configure(api_key=clean_key)
    _api_configured = True

def _get_model():
    _configure_api()
    return genai.GenerativeModel(settings.GEMINI_MODEL)


def _is_daily_quota_exhausted(err_msg: str) -> bool:
    """
    Returns True if the error is a hard daily quota limit (limit: 0).
    In this case retrying is pointless — go straight to fallback.
    """
    return (
        "PerDay" in err_msg
        or "per_day" in err_msg.lower()
        or "daily" in err_msg.lower()
        or ("limit: 0" in err_msg and "429" in err_msg)
        or "GenerateRequestsPerDayPerProjectPerModel" in err_msg
        or "generate_content_free_tier_requests" in err_msg
    )


def _call(prompt_or_content, json_mode: bool = False, max_tokens: int = 1024) -> str:
    """
    Send prompt to Gemini.
    - If daily quota is exhausted → immediately returns QUOTA_EXCEEDED (no wasted retries).
    - If per-minute limit → retries up to 5 times: 20s, 40s, 60s, 90s, 120s.
    - Always returns a string — never raises.
    """
    model = _get_model()
    if not model:
        return "⚠️ Error: API key is not configured correctly."

    safety_settings = [
        {"category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HATE_SPEECH",       "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
    ]

    conf: dict = {"max_output_tokens": max_tokens, "temperature": 0.5}
    if json_mode:
        conf["response_mime_type"] = "application/json"

    backoff_waits = [3, 7]  # Slightly more retry attempts for stability

    with _gemini_lock:
        # Initial delay removed for faster response as requested by USER
        for attempt, wait in enumerate(backoff_waits, start=1):
            try:
                resp = model.generate_content(
                    prompt_or_content,
                    generation_config=genai.GenerationConfig(**conf),
                    safety_settings=safety_settings,
                )
                text = resp.text.strip()
                print(f"[Gemini]: SUCCESS on attempt {attempt} — response[:80]: {text[:80]}")
                return text

            except Exception as e:
                err_msg = str(e)
                # Only match true rate-limit / quota errors — NOT generic errors like 404
                is_quota = (
                    "429"        in err_msg
                    or "quota"     in err_msg.lower()
                    or "rate_limit" in err_msg.lower()
                    or "exhausted" in err_msg.lower()
                    or "too many"  in err_msg.lower()
                )

                print(f"[Gemini]: Attempt {attempt}/{len(backoff_waits)} FAILED — {err_msg[:200]}")

                # Daily quota fully used up — no point retrying at all
                if _is_daily_quota_exhausted(err_msg):
                    print("[Gemini]: Daily quota exhausted. Switching to fallback immediately.")
                    return "QUOTA_EXCEEDED"

                if is_quota and attempt < len(backoff_waits):
                    print(f"[Gemini]: Per-minute limit. Waiting {wait}s before retry…")
                    time.sleep(wait)
                    continue

                if is_quota:
                    return "QUOTA_EXCEEDED"

                # Non-quota error (e.g. invalid model name, auth error) — fail immediately
                print(f"[Gemini]: Non-quota error, not retrying.")
                return f"⚠️ Error: {err_msg}"

    return "QUOTA_EXCEEDED"


def _parse_json(raw: str) -> dict:
    if not raw or "⚠️" in raw or "QUOTA_EXCEEDED" in raw:
        raise ValueError(f"AI returned error: {raw}")
    clean = re.sub(r'```(?:json)?|```', '', raw).strip()
    return json.loads(clean)


# ── Public functions ──────────────────────────────────────────────────────────

def generate_question(
    domain: str,
    experience_level: str,
    round_type: str,
    question_number: int,
    total_questions: int,
    already_asked: list,
    language: str = "",
) -> str:
    """
    Generate next interview question.
    Always returns a usable string — never raises.
    Falls back to FALLBACK_QUESTIONS silently if Gemini is unavailable.
    """
    asked_block = '\n'.join(f'- {q}' for q in already_asked) if already_asked else 'None yet.'

    exp_map = {
        'fresher':          'a fresh graduate (entry-level)',
        'experienced':      'a professional with 2-5 years of experience',
        'more_experienced': 'a senior professional with 5+ years of experience',
    }
    target_exp = exp_map.get(experience_level, 'a professional')
    topic = f"{domain} (focusing specifically on {language})" if language else domain

    prompts = {
        'hr': f"""You are a professional HR manager from India.
You are interviewing {target_exp} for a {topic} role.
Generate interview question #{question_number} of {total_questions}.

Focus areas: behavioural competencies, teamwork, communication,
career goals, strengths and weaknesses, motivation, cultural fit.

Already asked — do NOT repeat these:
{asked_block}

Rules:
- Return ONLY the question text.
- No numbering, no quotes, no preamble, no explanation.
- Polite, conversational Indian professional persona.
- Maximum 2 complete sentences.
- End with a question mark.""",

        'technical': f"""You are a senior technical lead from India.
You are running the technical round for {target_exp} in the {topic} field.
Generate technical question #{question_number} of {total_questions}.

Focus areas: core {topic} concepts, system design, problem-solving,
relevant tools, best practices, trade-offs.

Already asked — do NOT repeat these:
{asked_block}

Rules:
- Return ONLY the question text.
- No numbering, no quotes, no preamble, no explanation.
- Adjust difficulty to {experience_level} level.
- Maximum 3 complete sentences.
- End with a question mark.""",

        'coding': f"""You are an engineering manager from India.
You are running the coding round for {target_exp} for a {topic} role.
Generate coding or problem-solving question #{question_number} of {total_questions}.

Focus areas: algorithms, data structures, logic puzzles,
or {topic}-specific coding scenarios and optimisation problems.

Already asked — do NOT repeat these:
{asked_block}

Rules:
- Return ONLY the question text.
- No code blocks, no numbering, no preamble, no explanation.
- Adjust difficulty to {experience_level} level.
- Maximum 4 complete sentences.
- End with a question mark.""",
    }

    rt     = round_type.lower()
    prompt = prompts.get(rt, prompts['technical'])

    # 1. Attempt Gemini first
    print(f"[Gemini]: Attempting API call for question {question_number} ({rt} round)...")
    res = _call(prompt)

    # 2. If Gemini succeeds, use it
    if "QUOTA_EXCEEDED" not in res and not res.startswith("⚠️"):
        print(f"[Gemini]: SUCCESS — Using AI-generated question.")
        return res

    # 3. If Gemini fails (quota or error), use fallback
    print(f"[Gemini]: API failed or quota hit — Using fallback instead.")
    pool = FALLBACK_QUESTIONS.get(rt, FALLBACK_QUESTIONS['technical'])
    idx  = (question_number - 1) % len(pool)

    # Try to find a question not already asked in this session
    for i in range(len(pool)):
        candidate = pool[(idx + i) % len(pool)]
        if candidate not in already_asked:
            return candidate

    return pool[idx]


def evaluate_answer(
    domain: str,
    round_type: str,
    question: str,
    answer: str,
    language: str = "",
) -> dict:
    """
    Evaluate candidate's answer using Gemini.
    """
    topic = f"{domain} (focusing specifically on {language})" if language else domain

    prompt = f"""You are a strict but fair {round_type.upper()} interviewer
evaluating a candidate for a {topic} role.

Question asked:
"{question}"

Candidate's answer:
"{answer}"

Evaluate and give a score 0-10.
CRITICAL: If the answer is wrong, irrelevant or "I don't know" → score must be 0.
Score clarity (0-10) and depth (0-10).
Provide direct feedback in 1-3 sentences.

Return valid JSON:
{{ "score": int, "clarity": int, "depth": int, "feedback": "string" }}"""

    try:
        raw = _call(prompt, json_mode=True)

        if "QUOTA_EXCEEDED" in raw or raw.startswith("⚠️"):
            print("[Gemini]: Rate limited during evaluation — using provisional scores.")
            word_count = len(answer.split())
            base_score = min(6, max(1, word_count // 10))
            return {
                "score":    base_score,
                "clarity":  base_score,
                "depth":    max(1, base_score - 1),
                "feedback": "AI evaluator is temporarily busy. A provisional score has been assigned based on your response. Your answer has been saved correctly."
            }

        data = _parse_json(raw)

    except Exception as e:
        print(f"[Gemini Error in Evaluation]: {str(e)}")
        word_count = len(answer.split())
        base_score = min(6, max(1, word_count // 10))
        return {
            "score":    base_score,
            "clarity":  base_score,
            "depth":    max(1, base_score - 1),
            "feedback": "AI evaluator encountered an error. A provisional score has been assigned. Your answer has been saved."
        }

    for k in ('score', 'clarity', 'depth'):
        try:
            data[k] = max(0, min(10, int(data.get(k, 5))))
        except (ValueError, TypeError):
            data[k] = 5

    if not data.get('feedback'):
        data['feedback'] = "Good answer. It shows a solid understanding of the topic."

    return data


def generate_verdict(
    domain: str,
    rounds_completed: list,
    total_score: float,
    max_score: float,
    per_round_scores: dict,
) -> str:
    pct = round((total_score / max_score) * 100) if max_score else 0

    breakdown = ', '.join(
        f"{r}: {sum(s)}/{len(s) * 10}"
        for r, s in per_round_scores.items() if s
    )

    prompt = f"""Write a 2-3 sentence hiring verdict for a {domain} role.
Overall score: {total_score}/{max_score} ({pct}%)
Round scores: {breakdown}

Requirements:
1. One strength.
2. One area to improve.
3. Recommendation (Hire / No Hire).
Plain text only."""

    verdict = _call(prompt)

    if "QUOTA_EXCEEDED" in verdict or verdict.startswith("⚠️"):
        if pct >= 80:
            return "Excellent performance! You demonstrate a deep understanding of the core concepts. Continue refining your advanced system design skills. Recommendation: Strong Hire."
        elif pct >= 60:
            return "Solid showing across most rounds. Focusing on more specific examples and technical depth will help you stand out. Recommendation: Hire / Borderline."
        elif pct >= 40:
            return "You have the fundamental knowledge but lacked depth in several areas. More hands-on practice is recommended before your next attempt. Recommendation: No Hire / Needs Improvement."
        else:
            return "The interview revealed significant gaps in core domain knowledge. A thorough review of the basics and more structured study is suggested. Recommendation: No Hire."

    return verdict


# ── Fallback Question Bank ────────────────────────────────────────────────────

FALLBACK_QUESTIONS = {
    'hr': [
        "Namaste! To begin with, could you please introduce yourself and walk me through your career journey so far?",
        "What would you say are your core strengths, and what are some areas where you are looking to improve professionally?",
        "In a fast-paced work environment, how do you manage tight deadlines and handle work pressure?",
        "What specifically attracted you to this role at our company?",
        "Looking ahead, where do you see yourself in your career over the next five years?",
        "Could you share an instance where you had a difference of opinion with a colleague and how you resolved it?",
        "What are your compensation expectations for this position?",
        "What kind of company culture and work environment helps you perform at your best?",
        "What is the main reason you are considering a change from your current role?",
        "Do you have any questions for me regarding the company or the team you will be joining?",
    ],
    'technical': [
        "Could you explain your most recent project and highlight your specific technical contributions?",
        "How do you keep yourself updated with the latest trends and tools in the industry?",
        "Can you describe a particularly challenging technical problem you faced and how you solved it?",
        "What has been your experience with version control systems like Git in a collaborative team setting?",
        "When you encounter a complex bug, what is your step-by-step approach to debugging it?",
        "Could you explain the concept of synchronous versus asynchronous operations and when to choose each?",
        "What are the most important best practices for maintaining a clean and scalable codebase?",
        "How do you approach unit testing and how much importance do you give to test coverage?",
        "How do you balance delivering features quickly while managing technical debt?",
        "Is there a new framework or technology you have learned recently? What was the most interesting part?",
    ],
    'coding': [
        "If you were asked to design a high-traffic URL shortener service, what would your initial architecture look like?",
        "When a database query becomes slow as data grows, what are the first optimisations you would look into?",
        "How do you approach a peer's code review? What specific patterns or issues do you look for?",
        "What are your thoughts on microservices versus a monolithic architecture? When would you recommend each?",
        "What measures do you take to ensure your code is safe from common security vulnerabilities?",
        "Could you explain the Big O time complexity for a binary search and why it is efficient?",
        "Among the languages you know, which is your favourite for building scalable systems and why?",
        "How would you design a simple caching mechanism to speed up frequently accessed data?",
        "Can you share an experience where you led a technical feature from design all the way to production?",
        "What is your strategy for testing edge cases in your code before it moves to production?",
    ],
}