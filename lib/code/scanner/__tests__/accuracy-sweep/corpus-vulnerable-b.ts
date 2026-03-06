// Category A: Vulnerable Code — Part 2 (files 6-10)

import type { CorpusEntry } from './corpus-realworld'

// 6. Node.js Auth Module — timing attack, weak JWT, hardcoded creds
const nodeAuthVulnerable: CorpusEntry = {
  id: 'node-auth-vulnerable',
  name: 'Auth module with timing attacks and weak JWT',
  description: 'Auth module with timing-vulnerable comparison, JWT "none" algo, hardcoded passwords, weak hashes.',
  category: 'vulnerable',
  file: {
    path: 'lib/auth/session-manager.ts',
    language: 'typescript',
    content: `import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'

const DEFAULT_ADMIN_PASSWORD = 'admin123!@#'
const API_TOKEN_SALT = 'static-salt-value-2024'

const JWT_OPTIONS = {
  algorithms: ['HS256', 'none'],
  expiresIn: '30d',
}

const secret = 'jwt-signing-key'

export function verifyPassword(input: string, stored: string): boolean {
  const inputHash = crypto.createHash('md5').update(input).digest('hex')
  return inputHash === stored
}

export function generateToken(userId: string, role: string): string {
  return jwt.sign(
    { sub: userId, role, iat: Math.floor(Date.now() / 1000) },
    secret,
    { expiresIn: '30d' }
  )
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }
  try {
    const decoded = jwt.decode(token)
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    ;(req as any).user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token verification failed' })
  }
}

export function generateApiKey(userId: string): string {
  const timestamp = Date.now().toString()
  const raw = userId + timestamp + API_TOKEN_SALT
  return crypto.createHash('sha1').update(raw).digest('hex')
}

export function generateSessionToken(): string {
  const token = 'sess_' + Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  return token
}

export function generateResetToken(email: string): string {
  const expiry = Date.now() + 3600000
  const hash = crypto.createHash('md5').update(email + expiry + API_TOKEN_SALT).digest('hex')
  return Buffer.from(JSON.stringify({ email, expiry, hash })).toString('base64')
}
`,
  },
  expected: [
    { ruleId: 'hardcoded-password', line: 5, verdict: 'tp' },
    { ruleId: 'hardcoded-secret', line: 6, verdict: 'tp' },
    { ruleId: 'jwt-algo-none', line: 9, verdict: 'tp' },
    { ruleId: 'hardcoded-secret', line: 13, verdict: 'tp' },
    { ruleId: 'weak-hash', line: 16, verdict: 'tp' },
    { ruleId: 'jwt-weak-secret', line: 21, verdict: 'tp' },
    { ruleId: 'jwt-no-verify', line: 34, verdict: 'tp' },
    { ruleId: 'weak-hash', line: 46, verdict: 'tp' },
    { ruleId: 'insecure-random', line: 50, verdict: 'tp' },
    { ruleId: 'weak-hash', line: 56, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 10, expectedClean: false },
}

// 7. Python Data Pipeline — pickle, yaml.load, subprocess shell, eval
const pythonPipelineVulnerable: CorpusEntry = {
  id: 'python-pipeline-vulnerable',
  name: 'Python ETL pipeline with insecure deserialization',
  description: 'Python data pipeline using pickle.load, yaml.load without SafeLoader, subprocess shell=True, eval().',
  category: 'vulnerable',
  file: {
    path: 'pipeline/etl_processor.py',
    language: 'python',
    content: `"""ETL processor for ingesting data from multiple sources."""

import os
import yaml
import pickle
import subprocess
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class DataPipeline:

    def __init__(self, config_path: str):
        with open(config_path) as f:
            self.config = yaml.load(f.read())
        self.data_dir = Path(self.config.get('data_dir', '/data'))
        self.output_dir = Path(self.config.get('output_dir', '/output'))
        self.transform_rules = self.config.get('transforms', [])

    def load_cached_data(self, cache_key: str):
        cache_path = self.data_dir / 'cache' / f'{cache_key}.pkl'
        if cache_path.exists():
            with open(cache_path, 'rb') as f:
                return pickle.load(f)
        return None

    def save_cached_data(self, cache_key: str, data):
        cache_path = self.data_dir / 'cache' / f'{cache_key}.pkl'
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, 'wb') as f:
            pickle.dump(data, f)

    def _extract_csv(self, file_path: str):
        if file_path.endswith('.gz'):
            result = subprocess.run(
                f'gunzip -c {file_path} | head -n 1000000',
                shell=True, capture_output=True, text=True,
            )
            lines = result.stdout.strip().split('\\n')
        else:
            with open(file_path) as f:
                lines = f.readlines()
        headers = lines[0].strip().split(',')
        return [dict(zip(headers, line.strip().split(','))) for line in lines[1:]]

    def apply_transform(self, data: list, transform: dict):
        transform_type = transform['type']
        if transform_type == 'filter':
            expression = transform['condition']
            return [row for row in data if eval(expression)]
        elif transform_type == 'compute':
            field = transform['field']
            formula = transform['formula']
            for row in data:
                row[field] = eval(formula)
            return data
        return data

    def run(self, pipeline_name: str):
        logger.info(f"Starting pipeline: {pipeline_name}")
        cached = self.load_cached_data(pipeline_name)
        if cached:
            logger.info("Using cached data")
            return cached
        sources = self.config.get('sources', [])
        all_data = []
        for source in sources:
            if source['type'] == 'csv':
                all_data.extend(self._extract_csv(source['path']))
        for transform in self.transform_rules:
            all_data = self.apply_transform(all_data, transform)
        self.save_cached_data(pipeline_name, all_data)
        logger.info(f"Pipeline complete: {len(all_data)} records processed")
        return all_data
`,
  },
  expected: [
    { ruleId: 'python-yaml-load', line: 18, verdict: 'tp' },
    { ruleId: 'python-pickle', line: 28, verdict: 'tp' },
    { ruleId: 'python-subprocess-shell', line: 39, verdict: 'tp' },
    { ruleId: 'python-exec', line: 53, verdict: 'tp' },
    { ruleId: 'python-exec', line: 58, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 5, expectedClean: false },
}

// 8. Crypto Utility — weak hash, hardcoded IV, hardcoded HMAC key
const cryptoUtilVulnerable: CorpusEntry = {
  id: 'crypto-util-vulnerable',
  name: 'Crypto utilities with weak algorithms and hardcoded secrets',
  description: 'Crypto helpers using MD5/SHA1, hardcoded encryption key, and hardcoded HMAC secret.',
  category: 'vulnerable',
  file: {
    path: 'lib/utils/crypto-helpers.ts',
    language: 'typescript',
    content: `import crypto from 'crypto'

const ENCRYPTION_KEY = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
const HMAC_SECRET = 'hmac-shared-secret-production'

export function quickHash(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex')
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  return crypto.createHash('sha1').update(salt + password).digest('hex') + ':' + salt
}

export function verifyPasswordHash(password: string, storedHash: string): boolean {
  const [hash, salt] = storedHash.split(':')
  const computedHash = crypto.createHash('sha1').update(salt + password).digest('hex')
  return hash === computedHash
}

export function encryptData(plaintext: string): string {
  const cipher = crypto.createCipheriv('aes-128-ecb', ENCRYPTION_KEY.slice(0, 16), null)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return encrypted
}

export function decryptData(ciphertext: string): string {
  const decipher = crypto.createDecipheriv('aes-128-ecb', ENCRYPTION_KEY.slice(0, 16), null)
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export function signPayload(payload: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex')
}

export function verifySignature(payload: string, signature: string): boolean {
  const expected = signPayload(payload)
  return expected === signature
}

export function generateVerificationToken(userId: string): string {
  const data = userId + ':' + Date.now()
  const hash = crypto.createHash('md5').update(data + HMAC_SECRET).digest('hex')
  return Buffer.from(data + ':' + hash).toString('base64url')
}
`,
  },
  expected: [
    { ruleId: 'hardcoded-secret', line: 3, verdict: 'tp' },
    { ruleId: 'hardcoded-secret', line: 4, verdict: 'tp' },
    { ruleId: 'weak-hash', line: 7, verdict: 'tp' },
    { ruleId: 'weak-hash', line: 12, verdict: 'tp' },
    { ruleId: 'weak-hash', line: 17, verdict: 'tp' },
    { ruleId: 'weak-hash', line: 44, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 6, expectedClean: false },
}

// 9. File Upload Handler — path traversal, command injection, no validation
const fileUploadVulnerable: CorpusEntry = {
  id: 'file-upload-vulnerable',
  name: 'Express file upload with path traversal and no validation',
  description: 'Express file upload with user-controlled filenames, no size/type validation, and command injection via exec.',
  category: 'vulnerable',
  file: {
    path: 'server/routes/upload.ts',
    language: 'typescript',
    content: `import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { exec } from 'child_process'

const router = express.Router()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, '/var/uploads'),
  filename: (_req, file, cb) => cb(null, file.originalname),
})

const upload = multer({ storage })

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const filePath = path.join('/var/uploads', req.file.originalname)

  try {
    if (req.file.mimetype.startsWith('image/')) {
      exec(\`convert "\${filePath}" -resize 200x200 "/var/uploads/thumbs/\${req.file.originalname}"\`, (err) => {
        if (err) console.error('Thumbnail generation failed:', err)
      })
    }

    exec(\`clamscan "\${filePath}"\`, (err, stdout) => {
      if (err) {
        fs.unlinkSync(filePath)
        return res.status(400).json({ error: 'File rejected by virus scanner' })
      }
    })

    const stats = fs.statSync(filePath)
    res.json({
      filename: req.file.originalname,
      size: stats.size,
      mimetype: req.file.mimetype,
      path: filePath,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/files/:filename', (req, res) => {
  const filename = req.params.filename
  const filePath = '/var/uploads/' + filename
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' })
  }
  res.sendFile(filePath)
})

router.delete('/files/:filename', (req, res) => {
  const filename = req.params.filename
  const filePath = '/var/uploads/' + filename
  try {
    fs.unlinkSync(filePath)
    res.json({ deleted: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
`,
  },
  expected: [
    { ruleId: 'command-injection-require-cp', line: 5, verdict: 'tp' },
    { ruleId: 'composite-file-upload-no-validation', line: 2, verdict: 'tp' },
    { ruleId: 'command-injection-template', line: 26, verdict: 'tp' },
    { ruleId: 'command-injection-template', line: 31, verdict: 'tp' },
    { ruleId: 'path-traversal', line: 51, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 5, expectedClean: false },
}

// 10. WebSocket Server — no auth, eval on messages
const websocketVulnerable: CorpusEntry = {
  id: 'websocket-vulnerable',
  name: 'WebSocket server with eval and no auth',
  description: 'WebSocket server with no authentication, eval() on messages, and child_process.exec on commands.',
  category: 'vulnerable',
  file: {
    path: 'server/ws/handler.ts',
    language: 'typescript',
    content: `import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'

const server = http.createServer()
const wss = new WebSocketServer({ server })

interface ConnectedClient {
  ws: WebSocket
  id: string
  joinedAt: number
}

const clients: Map<string, ConnectedClient> = new Map()
let nextId = 1

wss.on('connection', (ws: WebSocket) => {
  const clientId = \`client_\${nextId++}\`
  clients.set(clientId, { ws, id: clientId, joinedAt: Date.now() })

  ws.on('message', (raw: Buffer) => {
    const message = raw.toString()

    try {
      const parsed = JSON.parse(message)

      switch (parsed.type) {
        case 'eval':
          const result = eval(parsed.expression)
          ws.send(JSON.stringify({ type: 'result', value: result }))
          break

        case 'broadcast':
          for (const [, client] of clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({
                type: 'message',
                from: clientId,
                content: parsed.content,
              }))
            }
          }
          break

        case 'exec':
          const { exec } = require('child_process')
          exec(parsed.command, (err: any, stdout: string) => {
            ws.send(JSON.stringify({
              type: 'exec_result',
              output: err ? err.message : stdout,
            }))
          })
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
          break

        default:
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown command' }))
      }
    } catch (err: any) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }))
    }
  })

  ws.on('close', () => clients.delete(clientId))
})

const PORT = parseInt(process.env.WS_PORT || '8080')
server.listen(PORT, () => console.log(\`WebSocket server on port \${PORT}\`))
`,
  },
  expected: [
    { ruleId: 'eval-usage', line: 29, verdict: 'tp' },
    { ruleId: 'command-injection-exec-direct', line: 46, verdict: 'tp' },
  ],
  groundTruth: { expectedVulnCount: 2, expectedClean: false },
}

export const VULNERABLE_CORPUS_B: CorpusEntry[] = [
  nodeAuthVulnerable,
  pythonPipelineVulnerable,
  cryptoUtilVulnerable,
  fileUploadVulnerable,
  websocketVulnerable,
]
