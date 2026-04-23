import json
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_POST, require_GET
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Sum
from django.conf import settings

from .models import InterviewSession, QuestionAnswer
from . import services

# -- Authentication Imports --
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.core.mail import send_mail
from django.contrib import messages
from django.shortcuts import redirect


# ── Page views ────────────────────────────────────────────────────────────────

def landing_page(request):
    """The 3D welcome page for logged out users."""
    if request.user.is_authenticated:
        return redirect('setup')
    return render(request, 'yourinterviewer/landing.html')

def signup_view(request):
    """Handles User Registration and Welcome Email."""
    if request.user.is_authenticated:
        return redirect('setup')
        
    if request.method == 'POST':
        email = request.POST.get('email')
        password = request.POST.get('password')
        name = request.POST.get('name', 'User')
        
        # Check if email is already used
        if User.objects.filter(username=email).exists():
            messages.error(request, "Email already registered.")
        else:
            # Create user (we use email as the username for Django)
            user = User.objects.create_user(username=email, email=email, password=password, first_name=name)
            
            # Send Welcome Email via SMTP
            try:
                send_mail(
                    subject='Welcome to yourInterviewer!',
                    message=f'Hi {name},\n\nYour account has been created successfully. Good luck with your interviews!',
                    from_email=settings.EMAIL_HOST_USER,
                    recipient_list=[email],
                    fail_silently=True,  # Won't crash if SMTP isn't set up yet
                )
            except Exception as e:
                print("Email failed:", e)
                
            login(request, user)
            return redirect('setup')
            
    return render(request, 'yourinterviewer/signup.html')

def login_view(request):
    """Handles User Login."""
    if request.user.is_authenticated:
        return redirect('setup')
        
    if request.method == 'POST':
        email = request.POST.get('email')
        password = request.POST.get('password')
        
        # Authenticate using the email as username
        user = authenticate(request, username=email, password=password)
        if user is not None:
            login(request, user)
            return redirect('setup')
        else:
            messages.error(request, "Invalid email or password.")
            
    return render(request, 'yourinterviewer/login.html')

def logout_view(request):
    """Handles User Logout."""
    logout(request)
    return redirect('landing')


@login_required
def setup_page(request):
    """Setup page — domain, rounds, question count selection."""
    return render(request, 'yourinterviewer/setup.html')


@login_required
def interview_page(request, session_id):
    """Live interview page."""
    session = get_object_or_404(InterviewSession, id=session_id)
    return render(request, 'yourinterviewer/interview.html', {
        'session': session,
        'qpr':     session.questions_per_round,
    })


@login_required
def results_page(request, session_id):
    """Final results page."""
    session = get_object_or_404(InterviewSession, id=session_id)
    answers = session.answers.all()

    rounds_data = {}
    for r in session.rounds:
        qs     = answers.filter(round_type=r)
        scores = [a.score for a in qs]
        rounds_data[r] = {
            'answers': list(qs.values(
                'question_number', 'question_text', 'answer_text',
                'score', 'clarity', 'depth', 'feedback'
            )),
            'total': sum(scores),
            'max':   len(scores) * 10,
        }

    return render(request, 'yourinterviewer/results.html', {
        'session':     session,
        'rounds_data': rounds_data,
    })


# ── API endpoints ─────────────────────────────────────────────────────────────

@csrf_exempt
@require_POST
def api_start(request):
    """
    Create a new InterviewSession.
    Body: { domain, rounds, questions_per_round }
    Returns: { session_id }
    """
    try:
        data     = json.loads(request.body)
        domain   = data.get('domain', '').strip()
        rounds   = data.get('rounds', ['hr', 'technical', 'coding'])
        qpr      = int(data.get('questions_per_round', settings.QUESTIONS_PER_ROUND))
        language = data.get('language', '').strip()
        exp      = data.get('experience_level', 'fresher')

        if not domain:
            return JsonResponse({'error': 'Domain is required.'}, status=400)
        if qpr not in [5, 10, 15]:
            return JsonResponse({'error': 'questions_per_round must be 5, 10 or 15.'}, status=400)
        if not rounds:
            return JsonResponse({'error': 'Select at least one round.'}, status=400)

        session = InterviewSession.objects.create(
            domain              = domain,
            language            = language,
            rounds              = rounds,
            questions_per_round = qpr,
            experience_level    = exp,
            max_score           = len(rounds) * qpr * 10,
        )
        return JsonResponse({'session_id': str(session.id)})

    except Exception as e:
        return JsonResponse({'error': f'Could not start session: {str(e)}'}, status=500)


@require_GET
def api_question(request, session_id):
    """
    Generate and return the next question for a given round.
    Params: ?round_type=hr&question_number=1
    Returns: { question_id, question }

    NOTE: services.generate_question() never raises — it always returns
    a usable question string (AI-generated or from the fallback bank).
    """
    session    = get_object_or_404(InterviewSession, id=session_id)
    round_type = request.GET.get('round_type', 'hr')
    q_num      = int(request.GET.get('question_number', 1))

    already_asked = list(
        session.answers
        .filter(round_type=round_type)
        .values_list('question_text', flat=True)
    )

    try:
        text = services.generate_question(
            domain           = session.domain,
            language         = session.language,
            experience_level = session.experience_level,
            round_type       = round_type,
            question_number  = q_num,
            total_questions  = session.questions_per_round,
            already_asked    = already_asked,
        )
    except Exception as e:
        # Should never reach here with the new services.py, but just in case
        print(f"[views.api_question] Unexpected error: {e}")
        return JsonResponse(
            {'error': 'Could not load question. Please refresh and try again.'},
            status=500
        )

    qa = QuestionAnswer.objects.create(
        session         = session,
        round_type      = round_type,
        question_number = q_num,
        question_text   = text,
    )
    return JsonResponse({'question_id': qa.id, 'question': text})


@csrf_exempt
@require_POST
def api_answer(request, session_id):
    """
    Receive an answer, evaluate it via Gemini, save to DB.
    Body: { question_id, answer_text }
    Returns: { score, clarity, depth, feedback, session_total }

    NOTE: services.evaluate_answer() falls back to provisional scores
    if Gemini is rate-limited, so this view will always return 200.
    """
    session     = get_object_or_404(InterviewSession, id=session_id)
    data        = json.loads(request.body)
    question_id = data.get('question_id')
    answer_text = data.get('answer_text', '').strip()

    if not answer_text:
        return JsonResponse({'error': 'Answer cannot be empty.'}, status=400)

    qa = get_object_or_404(QuestionAnswer, id=question_id, session=session)

    try:
        ev = services.evaluate_answer(
            domain     = session.domain,
            language   = session.language,
            round_type = qa.round_type,
            question   = qa.question_text,
            answer     = answer_text,
        )
    except Exception as e:
        print(f"[views.api_answer] Unexpected error: {e}")
        # Graceful fallback — save the answer with neutral scores
        ev = {
            'score':    5,
            'clarity':  5,
            'depth':    5,
            'feedback': 'AI evaluator is temporarily busy. Your answer has been saved with a provisional score.',
        }

    qa.answer_text = answer_text
    qa.score       = ev['score']
    qa.clarity     = ev['clarity']
    qa.depth       = ev['depth']
    qa.feedback    = ev['feedback']
    qa.save()

    total = (
        session.answers
        .exclude(answer_text='')
        .aggregate(Sum('score'))['score__sum'] or 0
    )
    session.total_score = total
    session.save()

    return JsonResponse({
        'score':         ev['score'],
        'clarity':       ev['clarity'],
        'depth':         ev['depth'],
        'feedback':      ev['feedback'],
        'session_total': session.total_score,
    })


@csrf_exempt
@require_POST
def api_finish(request, session_id):
    """
    Mark session complete, generate AI verdict.
    Body: { per_round_scores: { hr: [7,8,...], technical: [...] } }
    Returns: { verdict, results_url }
    """
    session          = get_object_or_404(InterviewSession, id=session_id)
    data             = json.loads(request.body)
    per_round_scores = data.get('per_round_scores', {})

    try:
        verdict = services.generate_verdict(
            domain           = session.domain,
            rounds_completed = session.rounds,
            total_score      = session.total_score,
            max_score        = session.max_score,
            per_round_scores = per_round_scores,
        )
    except Exception:
        verdict = 'Interview complete. Review your detailed scores above.'

    session.completed = True
    session.save()

    return JsonResponse({
        'verdict':     verdict,
        'results_url': f'/results/{session_id}/',
    })