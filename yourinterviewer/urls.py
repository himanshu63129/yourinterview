from django.urls import path
from . import views

urlpatterns = [

    # ── Pages ─────────────────────────────────────────────────────
    path(
        '',
        views.landing_page,
        name='landing'
    ),
    path(
        'setup/',
        views.setup_page,
        name='setup'
    ),
    path(
        'signup/',
        views.signup_view,
        name='signup'
    ),
    path(
        'login/',
        views.login_view,
        name='login'
    ),
    path(
        'logout/',
        views.logout_view,
        name='logout'
    ),
    path(
        'interview/<uuid:session_id>/',
        views.interview_page,
        name='interview'
    ),
    path(
        'results/<uuid:session_id>/',
        views.results_page,
        name='results'
    ),

    # ── API ───────────────────────────────────────────────────────
    path(
        'api/start/',
        views.api_start,
        name='api_start'
    ),
    path(
        'api/<uuid:session_id>/question/',
        views.api_question,
        name='api_question'
    ),
    path(
        'api/<uuid:session_id>/answer/',
        views.api_answer,
        name='api_answer'
    ),
    path(
        'api/<uuid:session_id>/finish/',
        views.api_finish,
        name='api_finish'
    ),

]
