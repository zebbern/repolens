// Category A: Vulnerable Code — Part 1 (files 1-5)

import type { CorpusEntry } from './corpus-realworld'

// 1. Express.js REST API — SQL injection, missing security middleware
const expressApiVulnerable: CorpusEntry = {
  id: 'express-api-vulnerable',
  name: 'Express REST API with multiple security issues',
  description: 'Express.js API with SQL injection, missing helmet/rate-limit, CORS wildcard, hardcoded JWT secret, error stack exposure.',
  category: 'vulnerable',
  file: {
    path: 'server/api/users.ts',
    language: 'typescript',
    content: `import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { Pool } from 'pg'

const app = express()

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  database: 'userdb',
  user: 'admin',
  password: process.env.DB_PASSWORD,
})

app.use(cors({ origin: '*', credentials: true }))
app.use(express.json())

const JWT_SECRET = 'myapp-jwt-secret-key-2024'

function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return res.sendStatus(401)
  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403)
    req.user = user
    next()
  })
}

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body
  try {
    const result = await pool.query(
      \\\`SELECT id, email, role FROM users WHERE email = '\\\${email}' AND password_hash = crypt('\\\${password}', password_hash)\\\`
    )
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }
    const user = result.rows[0]
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user })
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

app.get('/api/users', authenticateToken, async (req: any, res) => {
  const { search, sort, page = '1' } = req.query
  try {
    let query = 'SELECT id, email, name, role FROM users'
    if (search) {
      query += \\\` WHERE name ILIKE '%\\\${search}%'\\\`
    }
    if (sort) {
      query += \\\` ORDER BY \\\${sort}\\\`
    }
    const limit = 20
    const offset = (parseInt(page as string) - 1) * limit
    query += \\\` LIMIT \\\${limit} OFFSET \\\${offset}\\\`
    const result = await pool.query(query)
    res.json({ users: result.rows, page: parseInt(page as string), limit })
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

app.delete('/api/users/:id', authenticateToken, async (req: any, res) => {
  try {
    const result = await pool.query(\\\`DELETE FROM users WHERE id = \\\${req.params.id}\\\`)
    res.json({ deleted: result.rowCount })
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(\\\`API server on port \\\${PORT}\\\`))

export default app
`,
  },
  expected: [
    { ruleId: 'express-cors-credentials-wildcard', line: 16, verdict: 'tp' },
    { ruleId: 'express-body-parser-no-limit', line: 17, verdict: 'tp' },
    { ruleId: 'hardcoded-secret', line: 19, verdict: 'tp' },
    { ruleId: 'sql-injection', line: 35, verdict: 'tp' },
    { ruleId: 'error-stack-exposure', line: 45, verdict: 'tp' },
    { ruleId: 'sql-injection', line: 55, verdict: 'tp' },
    { ruleId: 'error-stack-exposure', line: 66, verdict: 'tp' },
    { ruleId: 'sql-injection', line: 72, verdict: 'tp' },
    { ruleId: 'error-stack-exposure', line: 75, verdict: 'tp' },
    { ruleId: 'express-no-helmet', line: 6, verdict: 'tp' },
    { ruleId: 'express-no-rate-limit', line: 31, verdict: 'tp' },
    { ruleId: 'composite-csrf-missing-express', line: 31, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 12, expectedClean: false },
}

// 2. Next.js API Route — SSRF, no auth
const nextjsApiVulnerable: CorpusEntry = {
  id: 'nextjs-api-vulnerable',
  name: 'Next.js API route with SSRF and missing auth',
  description: 'Next.js App Router API handler that fetches user-provided URLs (SSRF) and has no auth checks.',
  category: 'vulnerable',
  file: {
    path: 'app/api/proxy/route.ts',
    language: 'typescript',
    content: `import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { url, method = 'GET', headers: customHeaders } = body

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  try {
    const response = await fetch(url, {
      method,
      headers: { 'User-Agent': 'Proxy/1.0', ...customHeaders },
    })

    const contentType = response.headers.get('content-type') || 'text/plain'
    const data = contentType.includes('json') ? await response.json() : await response.text()

    return NextResponse.json({ status: response.status, contentType, data }, {
      headers: { 'X-Proxy-Target': url },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  try {
    const response = await fetch(url)
    const text = await response.text()

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 })
  }
}
`,
  },
  expected: [
    { ruleId: 'nextjs-api-no-auth', line: 3, verdict: 'tp' },
    { ruleId: 'composite-ssrf', line: 12, verdict: 'tp' },
    { ruleId: 'cors-wildcard', line: 43, verdict: 'tp' },
    { ruleId: 'error-stack-exposure', line: 47, verdict: 'tp' },
    { ruleId: 'nextjs-api-no-auth', line: 28, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 5, expectedClean: false },
}

// 3. Django Views — raw SQL, csrf_exempt, DEBUG, mark_safe
const djangoViewsVulnerable: CorpusEntry = {
  id: 'django-views-vulnerable',
  name: 'Django views with SQL injection and CSRF issues',
  description: 'Django views using raw SQL with f-strings, @csrf_exempt, DEBUG=True, mark_safe with user data.',
  category: 'vulnerable',
  file: {
    path: 'core/views.py',
    language: 'python',
    content: `from django.shortcuts import render
from django.http import JsonResponse
from django.db import connection
from django.views.decorators.csrf import csrf_exempt
from django.utils.safestring import mark_safe
from django.contrib.auth.decorators import login_required
import json

DEBUG = True

@csrf_exempt
def search_users(request):
    query = request.GET.get('q', '')
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT id, username, email FROM auth_user WHERE username LIKE '%{query}%' ORDER BY date_joined DESC"
        )
        columns = [col[0] for col in cursor.description]
        users = [dict(zip(columns, row)) for row in cursor.fetchall()]
    return JsonResponse({'users': users})

@csrf_exempt
def update_profile(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    data = json.loads(request.body)
    bio = data.get('bio', '')
    user_id = data.get('user_id')
    with connection.cursor() as cursor:
        cursor.execute(f"UPDATE user_profiles SET bio = '{bio}' WHERE user_id = {user_id}")
    return JsonResponse({'status': 'updated'})

@login_required
def user_profile(request, username):
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT username, bio FROM auth_user u JOIN user_profiles p ON u.id = p.user_id WHERE u.username = '{username}'"
        )
        row = cursor.fetchone()
    if not row:
        return render(request, '404.html', status=404)
    user_data = {
        'username': row[0],
        'bio_html': mark_safe(f"<div class='bio'>{row[1]}</div>"),
    }
    return render(request, 'profile.html', user_data)

@csrf_exempt
def delete_account(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    data = json.loads(request.body)
    user_id = data.get('user_id')
    with connection.cursor() as cursor:
        cursor.execute(f"DELETE FROM auth_user WHERE id = {user_id}")
    return JsonResponse({'status': 'deleted'})
`,
  },
  expected: [
    { ruleId: 'python-django-debug', line: 9, verdict: 'tp' },
    { ruleId: 'django-csrf-exempt', line: 11, verdict: 'tp' },
    { ruleId: 'django-raw-sql', line: 15, verdict: 'tp' },
    { ruleId: 'django-csrf-exempt', line: 22, verdict: 'tp' },
    { ruleId: 'django-raw-sql', line: 30, verdict: 'tp' },
    { ruleId: 'django-raw-sql', line: 36, verdict: 'tp' },
    { ruleId: 'django-mark-safe', line: 44, verdict: 'tp' },
    { ruleId: 'django-csrf-exempt', line: 48, verdict: 'tp' },
    { ruleId: 'django-raw-sql', line: 54, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 9, expectedClean: false },
}

// 4. Flask App — debug, hardcoded secret, os.system, eval
const flaskAppVulnerable: CorpusEntry = {
  id: 'flask-app-vulnerable',
  name: 'Flask app with debug mode and command injection',
  description: 'Flask app with debug=True, hardcoded secret key, os.system, subprocess shell=True, and eval().',
  category: 'vulnerable',
  file: {
    path: 'app/main.py',
    language: 'python',
    content: `from flask import Flask, request, jsonify, render_template_string
import os
import subprocess

app = Flask(__name__)
app.secret_key = 'flask-super-secret-key-never-change'

@app.route('/api/convert', methods=['POST'])
def convert_file():
    uploaded = request.files.get('file')
    if not uploaded:
        return jsonify({'error': 'No file provided'}), 400
    filename = uploaded.filename
    tmp_path = f'/tmp/uploads/{filename}'
    uploaded.save(tmp_path)
    os.system(f'libreoffice --headless --convert-to pdf --outdir /tmp/output "{tmp_path}"')
    output_path = f'/tmp/output/{os.path.splitext(filename)[0]}.pdf'
    if os.path.exists(output_path):
        return jsonify({'status': 'converted', 'path': output_path})
    return jsonify({'error': 'Conversion failed'}), 500

@app.route('/api/search')
def search():
    pattern = request.args.get('pattern', '*')
    directory = request.args.get('dir', '/data')
    result = subprocess.run(
        f'find {directory} -name "{pattern}" -type f',
        shell=True, capture_output=True, text=True,
    )
    files = result.stdout.strip().split('\\n') if result.stdout else []
    return jsonify({'files': files, 'count': len(files)})

@app.route('/api/eval', methods=['POST'])
def evaluate_expression():
    data = request.get_json()
    expression = data.get('expression', '')
    try:
        result = eval(expression)
        return jsonify({'result': result})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/health')
def health():
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
`,
  },
  expected: [
    { ruleId: 'flask-secret-key-hardcoded', line: 6, verdict: 'tp' },
    { ruleId: 'python-os-system', line: 17, verdict: 'tp' },
    { ruleId: 'python-subprocess-shell', line: 27, verdict: 'tp' },
    { ruleId: 'python-exec', line: 38, verdict: 'tp' },
    { ruleId: 'flask-debug-mode', line: 48, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 5, expectedClean: false },
}

// 5. Java Spring Controller — CSRF disabled, dynamic SQL
const springControllerVulnerable: CorpusEntry = {
  id: 'spring-controller-vulnerable',
  name: 'Spring Boot controller with SQL injection and CSRF disabled',
  description: 'Spring Boot with CSRF disabled and dynamic SQL via string concatenation.',
  category: 'vulnerable',
  file: {
    path: 'src/main/java/com/acme/api/UserController.java',
    language: 'java',
    content: `package com.acme.api;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;
import javax.sql.DataSource;
import java.sql.*;
import java.io.*;
import java.util.*;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private DataSource dataSource;

    @Configuration
    public static class SecurityConfig extends WebSecurityConfigurerAdapter {
        @Override
        protected void configure(HttpSecurity http) throws Exception {
            http.csrf().disable()
                .authorizeRequests()
                    .antMatchers("/api/public/**").permitAll()
                    .anyRequest().authenticated();
        }
    }

    @GetMapping("/search")
    public ResponseEntity<?> searchUsers(
            @RequestParam String q,
            @RequestParam(defaultValue = "username") String sort) {
        List<Map<String, Object>> users = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            Statement stmt = conn.createStatement();
            String sql = "SELECT id, username, email FROM users WHERE username LIKE '%" + q + "%' ORDER BY " + sort;
            ResultSet rs = stmt.executeQuery(sql);
            while (rs.next()) {
                Map<String, Object> user = new HashMap<>();
                user.put("id", rs.getInt("id"));
                user.put("username", rs.getString("username"));
                users.add(user);
            }
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
        return ResponseEntity.ok(users);
    }

    @PostMapping("/import")
    public ResponseEntity<?> importUsers(@RequestBody byte[] data) {
        try {
            ByteArrayInputStream bis = new ByteArrayInputStream(data);
            ObjectInputStream ois = new ObjectInputStream(bis);
            List<?> users = (List<?>) ois.readObject();
            ois.close();
            return ResponseEntity.ok(Map.of("imported", users.size()));
        } catch (Exception e) {
            return ResponseEntity.status(400).body(Map.of("error", "Invalid data"));
        }
    }
}
`,
  },
  expected: [
    { ruleId: 'spring-csrf-disabled', line: 24, verdict: 'tp' },
    { ruleId: 'sql-injection', line: 38, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 2, expectedClean: false },
}

export const VULNERABLE_CORPUS_A: CorpusEntry[] = [
  expressApiVulnerable,
  nextjsApiVulnerable,
  djangoViewsVulnerable,
  flaskAppVulnerable,
  springControllerVulnerable,
]
