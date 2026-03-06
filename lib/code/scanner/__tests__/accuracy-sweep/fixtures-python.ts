// Python fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const pythonFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. Flask route with debug mode → TP
  // -----------------------------------------------------------------------
  {
    name: 'flask-debug-mode',
    description: 'Flask app.run(debug=True) in __main__ block — TP',
    file: {
      path: 'app.py',
      content: `from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/api/health')
def health():
    return jsonify({"status": "ok"})

if __name__ == '__main__':
    app.run(debug=True, port=5000)`,
      language: 'python',
    },
    expected: [
      { ruleId: 'flask-debug-mode', line: 10, verdict: 'tp' },
      { ruleId: 'debug-mode-production', line: 10, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 2. Django view with mark_safe → TP
  // -----------------------------------------------------------------------
  {
    name: 'django-mark-safe',
    description: 'mark_safe with dynamic content — scanner flags as TP',
    file: {
      path: 'views/render.py',
      content: `from django.utils.safestring import mark_safe

def render_content(request):
    user_html = request.POST.get('content', '')
    escaped = str(user_html)
    return mark_safe(f"<div>{escaped}</div>")`,
      language: 'python',
    },
    expected: [
      { ruleId: 'django-mark-safe', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 3. Python type hints with sensitive names → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'python-type-hints-sensitive-names',
    description: 'Dataclass with password/secret fields as type annotations — not secrets',
    file: {
      path: 'src/models/user.py',
      content: `from dataclasses import dataclass
from typing import Optional

@dataclass
class UserCreate:
    username: str
    password: str
    api_key: str
    secret_key: Optional[str] = None

@dataclass
class TokenConfig:
    access_token: str
    refresh_token: str
    expires_in: int = 3600`,
      language: 'python',
    },
    expected: [
      // Python dataclass field annotations — should not trigger secret rules
      // Context-classifier may not cover Python class syntax fully
    ],
  },

  // -----------------------------------------------------------------------
  // 4. subprocess.run with hardcoded safe command (list form) → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'subprocess-safe-list-form',
    description: 'subprocess.run with list args, no shell=True — should NOT fire',
    file: {
      path: 'scripts/deploy.py',
      content: `import subprocess

def run_deploy():
    result = subprocess.run(["git", "pull", "origin", "main"], check=True)
    subprocess.run(["pip", "install", "-r", "requirements.txt"], check=True)
    return result.returncode`,
      language: 'python',
    },
    expected: [
      // No shell=True, list form — python-subprocess-shell should NOT fire
    ],
  },

  // -----------------------------------------------------------------------
  // 5. pickle.loads in ML pipeline → TP
  // -----------------------------------------------------------------------
  {
    name: 'pickle-loads-ml',
    description: 'pickle.loads for model deserialization — always risky, TP',
    file: {
      path: 'src/ml/model_loader.py',
      content: `import pickle

def load_model(model_path: str):
    with open(model_path, 'rb') as f:
        model_bytes = f.read()
    model = pickle.loads(model_bytes)
    return model`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-pickle', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 6. pytest fixtures with credentials → should NOT fire in test files
  // -----------------------------------------------------------------------
  {
    name: 'pytest-fixtures-credentials',
    description: 'Test fixture returning mock credentials — test-file suppression',
    file: {
      path: 'tests/conftest.py',
      content: `import pytest

@pytest.fixture
def mock_credentials():
    return {
        "username": "testuser",
        "password": "testpass123",
        "api_key": "test-key-abcdef12345",
    }

@pytest.fixture
def db_config():
    return {
        "host": "localhost",
        "port": 5432,
        "password": "test-db-password",
    }`,
      language: 'python',
    },
    expected: [
      // Test file detected by path → non-security quality rules suppressed
      // But hardcoded-password is security+critical → still fires on test files
      // The values contain "test" prefix which excludePattern should catch
    ],
  },

  // -----------------------------------------------------------------------
  // 7. SQL with parameterized queries → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'python-parameterized-sql',
    description: 'Parameterized SQL queries — sql-injection should NOT fire',
    file: {
      path: 'src/db/queries.py',
      content: `import sqlite3

def get_user(conn: sqlite3.Connection, user_id: int):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    return cursor.fetchone()

def search_users(conn: sqlite3.Connection, name: str):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE name = %s", (name,))
    return cursor.fetchall()`,
      language: 'python',
    },
    expected: [
      // Parameterized queries — no SQL injection
    ],
  },

  // -----------------------------------------------------------------------
  // 8. yaml.safe_load usage → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'yaml-safe-load',
    description: 'yaml.safe_load instead of yaml.load — safe API',
    file: {
      path: 'src/config/loader.py',
      content: `import yaml

def load_config(path: str):
    with open(path, 'r') as f:
        config = yaml.safe_load(f)
    return config`,
      language: 'python',
    },
    expected: [
      // safe_load is explicitly excluded by the yaml rule's excludePattern
    ],
  },

  // -----------------------------------------------------------------------
  // 9. subprocess with shell=True → TP
  // -----------------------------------------------------------------------
  {
    name: 'subprocess-shell-true',
    description: 'subprocess.run with shell=True and user input — TP',
    file: {
      path: 'src/utils/runner.py',
      content: `import subprocess

def run_command(user_cmd: str):
    result = subprocess.run(user_cmd, shell=True, capture_output=True)
    return result.stdout.decode()`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-subprocess-shell', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 10. Python exec() usage → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-exec-usage',
    description: 'exec() with user-provided code — TP',
    file: {
      path: 'src/sandbox/executor.py',
      content: `def execute_user_code(code: str):
    namespace = {}
    exec(code, namespace)
    return namespace.get('result')`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-exec', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 11. Django CSRF exempt on webhook → TP (but debatable)
  // -----------------------------------------------------------------------
  {
    name: 'django-csrf-exempt-webhook',
    description: 'csrf_exempt on webhook receiver — TP per scanner (necessary for webhooks)',
    file: {
      path: 'webhooks/stripe.py',
      content: `from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
import json

@csrf_exempt
def stripe_webhook(request):
    payload = json.loads(request.body)
    return JsonResponse({"received": True})`,
      language: 'python',
    },
    expected: [
      { ruleId: 'django-csrf-exempt', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 12. Python hardcoded secret in config → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-hardcoded-secret-config',
    description: 'Hardcoded secret in Python config — TP',
    file: {
      path: 'config/settings.py',
      content: `SECRET_KEY = "django-insecure-abc123def456ghi789jkl"
DATABASE_URL = "postgresql://user:password@localhost/db"

ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
DEBUG = True`,
      language: 'python',
    },
    expected: [
      { ruleId: 'hardcoded-secret', line: 1, verdict: 'tp' },
      { ruleId: 'python-django-debug', line: 5, verdict: 'tp' },
      { ruleId: 'flask-secret-key-hardcoded', line: 1, verdict: 'tp' },
      { ruleId: 'debug-mode-production', line: 5, verdict: 'tp' },
    ],
  },
]
