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

  // -----------------------------------------------------------------------
  // 13. Unsafe yaml.load → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-yaml-unsafe-load',
    description: 'yaml.load without SafeLoader — TP',
    file: {
      path: 'src/config/parser.py',
      content: `import yaml

def load_config(path):
    with open(path, 'r') as f:
        config = yaml.load(f)
    return config`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-yaml-load', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 14. exec(compile(...)) variant → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-exec-compile',
    description: 'exec() with compile() — dynamic code execution TP',
    file: {
      path: 'src/plugins/loader.py',
      content: `def run_plugin(code_str):
    compiled = compile(code_str, '<plugin>', 'exec')
    exec(compiled)`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-exec', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 15. subprocess.call with shell=True → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-subprocess-call-shell',
    description: 'subprocess.call with shell=True — command injection TP',
    file: {
      path: 'src/utils/converter.py',
      content: `import subprocess

def convert_file(filename):
    subprocess.call(f"convert {filename} output.pdf", shell=True)`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-subprocess-shell', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 16. SQL concat in Python → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-sql-string-concat',
    description: 'SQL query with string concatenation in Python — TP',
    file: {
      path: 'src/db/users.py',
      content: `import sqlite3

def get_user(conn, user_id):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = " + str(user_id))
    return cursor.fetchone()`,
      language: 'python',
    },
    expected: [
      { ruleId: 'sql-injection', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 17. Flask secret key hardcoded → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-flask-secret-key',
    description: 'app.secret_key hardcoded as string literal — TP',
    file: {
      path: 'src/app.py',
      content: `from flask import Flask

app = Flask(__name__)
app.secret_key = "super-secret-key-12345"

@app.route('/')
def index():
    return "Hello"`,
      language: 'python',
    },
    expected: [
      { ruleId: 'flask-secret-key-hardcoded', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 18. Django raw SQL with string formatting → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-django-raw-sql',
    description: 'Model.objects.raw with % formatting — TP for django-raw-sql',
    file: {
      path: 'views/search.py',
      content: `from myapp.models import User

def search_user(request):
    name = request.GET.get('name')
    users = User.objects.raw("SELECT * FROM users WHERE name = '%s'" % name)
    return render(request, 'results.html', {'users': users})`,
      language: 'python',
    },
    expected: [
      { ruleId: 'django-raw-sql', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 19. ast.literal_eval — should NOT fire eval-usage (FP test)
  // -----------------------------------------------------------------------
  {
    name: 'python-eval-safe-ast',
    description: 'ast.literal_eval is safe — eval-usage should NOT fire',
    file: {
      path: 'src/parsers/config_reader.py',
      content: `import ast

def parse_config_value(raw: str):
    return ast.literal_eval(raw)

def parse_list(data: str):
    return ast.literal_eval(data)`,
      language: 'python',
    },
    expected: [
      // ast.literal_eval doesn't match \beval\s*\( due to word boundary
      // Should NOT trigger eval-usage
    ],
  },

  // -----------------------------------------------------------------------
  // 20. Python SSL verify=False → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-ssl-no-verify',
    description: 'requests.get with verify=False — TP for python-ssl-no-verify',
    file: {
      path: 'src/clients/api.py',
      content: `import requests

def fetch_data(url: str):
    response = requests.get(url, verify=False)
    return response.json()`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-ssl-no-verify', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 21. Python tempfile.mktemp → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-tempfile-mktemp',
    description: 'tempfile.mktemp() insecure temp file — TP',
    file: {
      path: 'src/utils/temp.py',
      content: `import tempfile
import os

def create_temp_config():
    path = tempfile.mktemp(suffix='.conf')
    with open(path, 'w') as f:
        f.write('key=value')
    return path`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-tempfile-mktemp', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 22. Python bare except → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-bare-except',
    description: 'bare except: catches everything including SystemExit — TP',
    file: {
      path: 'src/utils/loader.py',
      content: `def load_data(path):
    try:
        with open(path) as f:
            return f.read()
    except:
        return None`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-bare-except', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 23. Python os.system with f-string → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-os-system',
    description: 'os.system with f-string — command injection risk, TP',
    file: {
      path: 'src/admin/services.py',
      content: `import os

def restart_service(name):
    os.system(f"systemctl restart {name}")`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-os-system', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 24. SSTI Python — render_template_string with request → TP
  // -----------------------------------------------------------------------
  {
    name: 'ssti-python',
    description: 'render_template_string(request.form.get(...)) — SSTI, TP',
    file: {
      path: 'views/preview.py',
      content: `from flask import render_template_string, request

def preview():
    return render_template_string(request.form.get('template'))`,
      language: 'python',
    },
    expected: [
      { ruleId: 'ssti-python', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 25. Python marshal.load → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-marshal-load',
    description: 'marshal.load from file — insecure deserialization, TP',
    file: {
      path: 'src/cache/loader.py',
      content: `import marshal

def load_cached(path):
    with open(path, 'rb') as f:
        return marshal.load(f)`,
      language: 'python',
    },
    expected: [
      { ruleId: 'python-marshal-load', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 26. XXE Python — xml.etree.ElementTree.parse → TP
  // -----------------------------------------------------------------------
  {
    name: 'xxe-python',
    description: 'xml.etree.ElementTree.parse — vulnerable to XXE, TP',
    file: {
      path: 'src/parsers/xml_loader.py',
      content: `import xml.etree.ElementTree as ET

def load_xml(path):
    tree = xml.etree.ElementTree.parse(path)
    return tree.getroot()`,
      language: 'python',
    },
    expected: [
      { ruleId: 'xxe-python', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 27. Python timing attack — == with secret → TP
  // -----------------------------------------------------------------------
  {
    name: 'python-timing-attack',
    description: '== comparison with secret variable — timing attack, TP',
    file: {
      path: 'src/auth/verify.py',
      content: `def check_auth(provided, secret):
    if provided == secret:
        return True
    return False`,
      language: 'python',
    },
    expected: [
      { ruleId: 'timing-attack-py', line: 2, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 28. Python os.system with f-string — composite cmd injection TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-python-os-cmd',
    description: 'os.system(f"...") + os.popen("%s" %) — Python cmd injection TP',
    file: {
      path: 'src/ops/process_mgr.py',
      content: `import os
def kill_process(pid):
    os.system(f"kill -9 {pid}")
def list_files(directory):
    os.popen("ls %s" % directory)`,
      language: 'python',
    },
    expected: [
      { ruleId: 'composite-python-os-cmd', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 29. Django view without CSRF protection — composite TP
  // -----------------------------------------------------------------------
  {
    name: 'composite-csrf-missing-django-view',
    description: 'Django class-based view post() without csrf_protect — CSRF TP',
    file: {
      path: 'src/views/orders.py',
      content: `from django.http import JsonResponse
import json
class OrderView:
    def post(self, request):
        data = json.loads(request.body)
        return JsonResponse({"status": "created"})`,
      language: 'python',
    },
    expected: [
      { ruleId: 'composite-csrf-missing-django-view', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 30. NEGATIVE: Django view WITH csrf_protect — safe
  // -----------------------------------------------------------------------
  {
    name: 'composite-csrf-safe-django',
    description: 'Django view with @csrf_protect — CSRF rule should NOT fire',
    file: {
      path: 'src/views/payments.py',
      content: `from django.views.decorators.csrf import csrf_protect
from django.http import JsonResponse
import json
class PaymentView:
    @csrf_protect
    def post(self, request):
        data = json.loads(request.body)
        return JsonResponse({"paid": True})`,
      language: 'python',
    },
    expected: [
      // @csrf_protect present — composite-csrf-missing-django-view should NOT fire
    ],
  },
]
