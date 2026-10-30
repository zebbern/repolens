import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/parsers/tree-sitter', () => import('@/lib/code/scanner/__tests__/tree-sitter-mock'))

import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { clearScanCache } from '@/lib/code/scanner'
import type { CodeIssue } from '../types'
import { scan } from './scan-test-helpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepoSnippet {
  id: string
  description: string
  path: string
  language: string
  content: string
  expectedRules: string[]
  category: 'vulnerable' | 'secure'
}

// ---------------------------------------------------------------------------
// Code snippets modeled after real open-source vulnerability patterns
// ---------------------------------------------------------------------------

const SNIPPETS: RepoSnippet[] = [
  // 1. Express app with SQL injection, missing security middleware
  {
    id: 'express-insecure-api',
    description: 'Express REST API with SQL injection, error stack exposure, insecure random, no helmet/rate-limit',
    path: 'server/routes/users.js',
    language: 'javascript',
    content: `const express = require('express');
const app = express();

app.get('/api/users/:id', (req, res) => {
  const query = "SELECT * FROM users WHERE id = '" + req.params.id + "'";
  db.query(query, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message, stack: err.stack });
    }
    res.json(result);
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const token = Math.random().toString(36).substring(2);
  res.json({ token });
});

app.listen(3000);
`,
    expectedRules: [
      'sql-injection',
      'error-stack-exposure',
      'insecure-random',
      'express-no-helmet',
      'express-no-rate-limit',
    ],
    category: 'vulnerable',
  },

  // 2. Python Flask app with command injection
  {
    id: 'flask-command-injection',
    description: 'Flask app with os.system command injection, subprocess shell=True, hardcoded secret',
    path: 'app/views.py',
    language: 'python',
    content: `from flask import Flask, request
import os
import subprocess

app = Flask(__name__)

SECRET_KEY = 'my-super-secret-flask-key-2024'

@app.route('/ping')
def ping():
    host = request.args.get('host')
    result = os.system('ping -c 4 ' + host)
    return str(result)

@app.route('/convert')
def convert():
    filename = request.args.get('file')
    subprocess.call('convert ' + filename + ' output.png', shell=True)
    return 'Done'
`,
    expectedRules: [
      'hardcoded-secret',
      'python-os-system',
      'python-subprocess-shell',
    ],
    category: 'vulnerable',
  },

  // 3. React component with dangerouslySetInnerHTML XSS
  {
    id: 'react-xss-component',
    description: 'React component using dangerouslySetInnerHTML with dynamic content',
    path: 'src/components/UserProfile.tsx',
    language: 'typescriptreact',
    content: `import React from 'react';

function UserProfile({ user }) {
  return (
    <div>
      <h1>{user.name}</h1>
      <div dangerouslySetInnerHTML={{ __html: user.bio }} />
    </div>
  );
}

export default UserProfile;
`,
    expectedRules: [
      'nextjs-dangerous-html-prop',
    ],
    category: 'vulnerable',
  },

  // 4. Node.js crypto with weak settings
  {
    id: 'node-weak-crypto',
    description: 'Node.js using MD5, weak JWT secret, hardcoded API key',
    path: 'lib/auth/crypto-helpers.js',
    language: 'javascript',
    content: `const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const API_KEY = 'sk-live-abcdef1234567890abcdef';

function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex');
}

function generateToken(user) {
  return jwt.sign({ id: user.id }, 'secret123', { expiresIn: '7d' });
}

function verifyCallback(token) {
  try {
    return jwt.verify(token, 'secret123');
  } catch (e) {
    return null;
  }
}

module.exports = { hashPassword, generateToken, verifyCallback };
`,
    expectedRules: [
      'hardcoded-secret',
      'weak-hash',
      'jwt-weak-secret',
    ],
    category: 'vulnerable',
  },

  // 5. Django model with raw SQL injection
  {
    id: 'django-raw-sql-injection',
    description: 'Django views using raw SQL with f-string interpolation',
    path: 'myapp/views.py',
    language: 'python',
    content: `from django.db import connection
from django.http import JsonResponse

def search_users(request):
    query = request.GET.get('q', '')
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT * FROM users WHERE name LIKE '%{query}%'")
        rows = cursor.fetchall()
    return JsonResponse({'users': rows})

def delete_user(request, user_id):
    with connection.cursor() as cursor:
        cursor.execute(f"DELETE FROM users WHERE id = {user_id}")
    return JsonResponse({'status': 'deleted'})
`,
    expectedRules: [
      'django-raw-sql',
    ],
    category: 'vulnerable',
  },

  // 6. Secure Express app — should produce minimal findings
  {
    id: 'express-secure-api',
    description: 'Express app with helmet, rate limiting, parameterized queries, proper error handling',
    path: 'server/routes/secure-users.js',
    language: 'javascript',
    content: `const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.get('/api/users/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
`,
    expectedRules: [],
    category: 'secure',
  },

  // 7. Secure Python with bcrypt, env vars, parameterized queries
  {
    id: 'python-secure-crypto',
    description: 'Python with bcrypt, environ secrets, parameterized queries, secrets module',
    path: 'app/auth/secure_helpers.py',
    language: 'python',
    content: `import bcrypt
import secrets
import os
from django.db import connection

SECRET_KEY = os.environ.get('SECRET_KEY')

def hash_password(password):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode(), salt)

def get_user(user_id):
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM users WHERE id = %s", [user_id])
        return cursor.fetchone()

def generate_token():
    return secrets.token_urlsafe(32)
`,
    expectedRules: [],
    category: 'secure',
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Real repository pattern validation', () => {
  beforeEach(() => {
    clearScanCache()
  })

  // Track results for summary
  const allResults: {
    id: string
    category: string
    totalFindings: number
    expectedHit: string[]
    expectedMiss: string[]
    allRuleIds: string[]
  }[] = []

  for (const snippet of SNIPPETS) {
    describe(snippet.id, () => {
      let findings: CodeIssue[]

      beforeEach(async () => {
        clearScanCache()
        let index = createEmptyIndex()
        index = indexFile(index, snippet.path, snippet.content, snippet.language)
        const result = await scan(index, null)
        findings = result.issues
      })

      if (snippet.expectedRules.length > 0) {
        for (const ruleId of snippet.expectedRules) {
          it(`should detect ${ruleId}`, () => {
            const found = findings.some(
              f => f.ruleId === ruleId || f.ruleId.includes(ruleId) || ruleId.includes(f.ruleId),
            )
            if (!found) {
              console.log(`MISSED ${ruleId} in ${snippet.id}:`)
              console.log('  Found rules:', [...new Set(findings.map(f => f.ruleId))].join(', '))
            }
            expect(found).toBe(true)
          })
        }
      }

      if (snippet.category === 'secure') {
        it('should have minimal findings (<=2 non-info)', () => {
          const nonInfoFindings = findings.filter(f => f.severity !== 'info')
          if (nonInfoFindings.length > 2) {
            console.log(`HIGH NOISE on secure file ${snippet.id}:`)
            for (const f of nonInfoFindings) {
              console.log(`  ${f.ruleId} L${f.line}: ${f.snippet?.slice(0, 80)}`)
            }
          }
          expect(nonInfoFindings.length).toBeLessThanOrEqual(2)
        })
      }

      // Always log what was found for diagnosis
      it('should log all findings for review', () => {
        const hit: string[] = []
        const miss: string[] = []
        for (const ruleId of snippet.expectedRules) {
          const found = findings.some(
            f => f.ruleId === ruleId || f.ruleId.includes(ruleId) || ruleId.includes(f.ruleId),
          )
          if (found) hit.push(ruleId)
          else miss.push(ruleId)
        }
        allResults.push({
          id: snippet.id,
          category: snippet.category,
          totalFindings: findings.length,
          expectedHit: hit,
          expectedMiss: miss,
          allRuleIds: [...new Set(findings.map(f => f.ruleId))],
        })

        console.log(`\n--- ${snippet.id} (${snippet.category}) ---`)
        console.log(`  Total findings: ${findings.length}`)
        console.log(`  Expected hit: ${hit.length}/${snippet.expectedRules.length}`)
        if (miss.length > 0) console.log(`  Missed: ${miss.join(', ')}`)
        console.log(`  All rule IDs found: ${[...new Set(findings.map(f => f.ruleId))].join(', ')}`)
        for (const f of findings) {
          console.log(`    [${f.severity}] ${f.ruleId} L${f.line}: ${f.title}`)
        }
        expect(true).toBe(true) // diagnostic test, always passes
      })
    })
  }

  // Overall summary
  describe('Overall accuracy', () => {
    it('should have >= 80% recall on vulnerable snippets', async () => {
      clearScanCache()
      let totalExpected = 0
      let totalHit = 0

      for (const snippet of SNIPPETS.filter(s => s.category === 'vulnerable')) {
        let index = createEmptyIndex()
        index = indexFile(index, snippet.path, snippet.content, snippet.language)
        const result = await scan(index, null)

        for (const ruleId of snippet.expectedRules) {
          totalExpected++
          const found = result.issues.some(
            f => f.ruleId === ruleId || f.ruleId.includes(ruleId) || ruleId.includes(f.ruleId),
          )
          if (found) totalHit++
          else console.log(`  MISS: ${ruleId} in ${snippet.id}`)
        }
        clearScanCache()
      }

      const recall = totalExpected > 0 ? (totalHit / totalExpected) * 100 : 100
      console.log(`\n=== OVERALL RECALL: ${totalHit}/${totalExpected} = ${recall.toFixed(1)}% ===`)
      expect(recall).toBeGreaterThanOrEqual(80)
    })

    it('should have low false positive rate on secure snippets', async () => {
      clearScanCache()
      let totalFP = 0
      let totalSecure = 0

      for (const snippet of SNIPPETS.filter(s => s.category === 'secure')) {
        let index = createEmptyIndex()
        index = indexFile(index, snippet.path, snippet.content, snippet.language)
        const result = await scan(index, null)
        const nonInfoFindings = result.issues.filter(f => f.severity !== 'info')
        totalFP += nonInfoFindings.length
        totalSecure++
        clearScanCache()
      }

      const avgFP = totalSecure > 0 ? totalFP / totalSecure : 0
      console.log(`\n=== SECURE FILES: ${totalFP} non-info findings across ${totalSecure} files (avg ${avgFP.toFixed(1)}) ===`)
      expect(avgFP).toBeLessThanOrEqual(2)
    })
  })
})
