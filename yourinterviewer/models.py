from django.db import models
import uuid


class InterviewSession(models.Model):
    id              = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    domain          = models.CharField(max_length=120)
    language        = models.CharField(max_length=50, blank=True, null=True, help_text="e.g., Java, Python, React")
    rounds          = models.JSONField(default=list)       # ["hr","technical","coding"]
    questions_per_round = models.PositiveSmallIntegerField(default=5)  # user picks this
    total_score     = models.FloatField(default=0)
    max_score       = models.FloatField(default=0)
    experience_level = models.CharField(max_length=50, default='fresher') # fresher, experienced, more_experienced
    completed       = models.BooleanField(default=False)
    created_at      = models.DateTimeField(auto_now_add=True)

    def grade(self):
        pct = self.percentage()
        if pct >= 90: return 'A+'
        if pct >= 80: return 'A'
        if pct >= 70: return 'B'
        if pct >= 60: return 'C'
        if pct >= 50: return 'D'
        return 'F'

    def percentage(self):
        if not self.max_score:
            return 0
        return round((self.total_score / self.max_score) * 100, 1)

    def __str__(self):
        return f"{self.domain} | {self.questions_per_round}Q/round | {self.created_at:%Y-%m-%d %H:%M}"


class QuestionAnswer(models.Model):
    session         = models.ForeignKey(InterviewSession, on_delete=models.CASCADE, related_name='answers')
    round_type      = models.CharField(max_length=20)      # hr | technical | coding
    question_number = models.PositiveSmallIntegerField()
    question_text   = models.TextField()
    answer_text     = models.TextField(blank=True)
    score           = models.FloatField(default=0)         # 0-10
    clarity         = models.FloatField(default=0)
    depth           = models.FloatField(default=0)
    feedback        = models.TextField(blank=True)
    emotion         = models.CharField(max_length=50, blank=True, null=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['round_type', 'question_number']

    def __str__(self):
        return f"[{self.round_type}] Q{self.question_number} — {self.score}/10"