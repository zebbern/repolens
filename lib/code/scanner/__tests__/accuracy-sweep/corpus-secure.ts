// Category B: Secure Code — files 11-15
// These files should NOT trigger any scanner findings.

import type { CorpusEntry } from './corpus-realworld'

// 11. Secure Express API — helmet, rate-limit, parameterized queries
const secureExpressApi: CorpusEntry = {
  id: 'express-api-secure',
  name: 'Express API with proper security controls',
  description: 'Express API with helmet, rate-limiting, parameterized queries, CORS config, proper error handling.',
  category: 'secure',
  file: {
    path: 'server/api/routes.ts',
    language: 'typescript',
    content: `import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cors from 'cors'
import { Pool } from 'pg'

const app = express()

app.use(helmet())
app.use(express.json({ limit: '10kb' }))
app.use(cors({
  origin: ['https://app.example.com'],
  credentials: true,
}))

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use(limiter)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 20,
})

app.get('/api/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10)
  if (isNaN(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid user ID' })
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [userId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error('Database error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/users', async (req, res) => {
  const { name, email } = req.body
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' })
  }
  if (typeof name !== 'string' || typeof email !== 'string') {
    return res.status(400).json({ error: 'Invalid input types' })
  }
  if (!email.includes('@') || name.length > 100) {
    return res.status(400).json({ error: 'Invalid input format' })
  }

  try {
    const result = await pool.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email',
      [name, email]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('Insert error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default app
`,
  },
  expected: [],
  groundTruth: { expectedVulnCount: 0, expectedClean: true },
}

// 12. Secure Next.js API Route — session auth, Zod validation, Prisma ORM
const secureNextjsApi: CorpusEntry = {
  id: 'nextjs-api-secure',
  name: 'Next.js API route with proper auth and validation',
  description: 'Next.js API route with session auth, Zod input validation, Prisma ORM, and proper error handling.',
  category: 'secure',
  file: {
    path: 'app/api/posts/route.ts',
    language: 'typescript',
    content: `import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

const CreatePostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  tags: z.array(z.string().max(50)).max(10).optional(),
})

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const offset = (page - 1) * limit

  const posts = await prisma.post.findMany({
    where: { authorId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: {
      id: true,
      title: true,
      createdAt: true,
      tags: true,
    },
  })

  return NextResponse.json({ posts, page, limit })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreatePostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const post = await prisma.post.create({
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags || [],
      authorId: session.user.id,
    },
  })

  return NextResponse.json(post, { status: 201 })
}
`,
  },
  expected: [],
  groundTruth: { expectedVulnCount: 0, expectedClean: true },
}

// 13. Secure Django View — ORM queries, CSRF, login_required
const secureDjangoView: CorpusEntry = {
  id: 'django-view-secure',
  name: 'Django view with ORM and CSRF protection',
  description: 'Django view using ORM queries, @login_required, CSRF protection, format_html.',
  category: 'secure',
  file: {
    path: 'blog/views.py',
    language: 'python',
    content: `"""Blog views with proper security practices."""

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, Http404
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from django.utils.html import format_html
from django.core.paginator import Paginator
from django.db.models import Q

from .models import Post, Comment


@login_required
@require_http_methods(["GET"])
def list_posts(request):
    """List posts with pagination and optional search."""
    query = request.GET.get('q', '').strip()
    page_num = request.GET.get('page', '1')

    posts = Post.objects.filter(published=True).select_related('author')
    if query:
        posts = posts.filter(
            Q(title__icontains=query) | Q(content__icontains=query)
        )
    posts = posts.order_by('-created_at')

    paginator = Paginator(posts, 20)
    page = paginator.get_page(page_num)

    return JsonResponse({
        'posts': [
            {
                'id': post.pk,
                'title': post.title,
                'author': post.author.username,
                'created_at': post.created_at.isoformat(),
            }
            for post in page.object_list
        ],
        'total_pages': paginator.num_pages,
        'current_page': page.number,
    })


@login_required
@csrf_protect
@require_http_methods(["POST"])
def create_comment(request, post_id):
    """Create a comment on a post with proper validation."""
    try:
        post = Post.objects.get(pk=post_id, published=True)
    except Post.DoesNotExist:
        raise Http404("Post not found")

    import json
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    content = data.get('content', '').strip()
    if not content or len(content) > 5000:
        return JsonResponse({'error': 'Content is required (max 5000 chars)'}, status=400)

    comment = Comment.objects.create(
        post=post,
        author=request.user,
        content=content,
    )

    return JsonResponse({
        'id': comment.pk,
        'content': comment.content,
        'author': comment.author.username,
        'created_at': comment.created_at.isoformat(),
    }, status=201)


@login_required
@require_http_methods(["GET"])
def post_detail(request, post_id):
    """Show post detail with safe HTML rendering."""
    try:
        post = Post.objects.get(pk=post_id, published=True)
    except Post.DoesNotExist:
        raise Http404("Post not found")

    safe_title = format_html('<h1>{}</h1>', post.title)

    return JsonResponse({
        'id': post.pk,
        'title': post.title,
        'title_html': safe_title,
        'content': post.content,
        'author': post.author.username,
        'created_at': post.created_at.isoformat(),
    })
`,
  },
  expected: [],
  groundTruth: { expectedVulnCount: 0, expectedClean: true },
}

// 14. Secure Crypto Module — bcrypt, AES-256-GCM, env secrets
const secureCryptoModule: CorpusEntry = {
  id: 'crypto-secure',
  name: 'Crypto module with strong algorithms and env secrets',
  description: 'Crypto module using bcrypt, AES-256-GCM, random IVs, env-based keys, timing-safe comparison.',
  category: 'secure',
  file: {
    path: 'lib/security/crypto.ts',
    language: 'typescript',
    content: `import crypto from 'crypto'
import bcrypt from 'bcrypt'

const SALT_ROUNDS = 12

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is required')
  return Buffer.from(key, 'hex')
}

function getHmacSecret(): Buffer {
  const secret = process.env.HMAC_SECRET
  if (!secret) throw new Error('HMAC_SECRET environment variable is required')
  return Buffer.from(secret, 'hex')
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey()
  const data = Buffer.from(ciphertext, 'base64')
  const iv = data.subarray(0, 12)
  const authTag = data.subarray(12, 28)
  const encrypted = data.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8')
}

export function signPayload(payload: string): string {
  const secret = getHmacSecret()
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifySignature(payload: string, signature: string): boolean {
  const expected = signPayload(payload)
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex')
  )
}

export function generateSecureToken(length = 32): string {
  return crypto.randomBytes(length).toString('base64url')
}
`,
  },
  expected: [],
  groundTruth: { expectedVulnCount: 0, expectedClean: true },
}

// 15. Secure Python Script — subprocess with list, yaml.safe_load, pathlib
const securePythonScript: CorpusEntry = {
  id: 'python-script-secure',
  name: 'Python script with safe subprocess and YAML handling',
  description: 'Python script using subprocess.run with list args, yaml.safe_load, pathlib, no eval/exec.',
  category: 'secure',
  file: {
    path: 'scripts/deploy.py',
    language: 'python',
    content: `"""Deployment script with safe process and file handling."""

import os
import sys
import subprocess
import logging
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


def load_config(config_path: Path) -> dict:
    """Load configuration using safe YAML loader."""
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")
    with open(config_path) as f:
        return yaml.safe_load(f.read()) or {}


def run_command(args: list[str], cwd: Path | None = None) -> str:
    """Run a subprocess with explicit argument list (no shell)."""
    logger.info("Running: %s", " ".join(args))
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=str(cwd) if cwd else None,
        timeout=300,
        check=False,
    )
    if result.returncode != 0:
        logger.error("Command failed (exit %d): %s", result.returncode, result.stderr)
        raise RuntimeError(f"Command failed: {' '.join(args)}")
    return result.stdout.strip()


def build_project(project_dir: Path, config: dict) -> None:
    """Build the project using configured build command."""
    build_cmd = config.get("build_command", ["npm", "run", "build"])
    if not isinstance(build_cmd, list):
        raise ValueError("build_command must be a list of strings")
    if not all(isinstance(arg, str) for arg in build_cmd):
        raise ValueError("All build_command arguments must be strings")
    run_command(build_cmd, cwd=project_dir)


def deploy(env: str) -> None:
    """Deploy to the specified environment."""
    allowed_envs = {"staging", "production"}
    if env not in allowed_envs:
        raise ValueError(f"Invalid environment: {env}. Must be one of {allowed_envs}")

    config_path = Path(__file__).parent / "config" / f"{env}.yaml"
    config = load_config(config_path)

    project_dir = Path(config.get("project_dir", ".")).resolve()
    if not project_dir.is_dir():
        raise FileNotFoundError(f"Project directory not found: {project_dir}")

    logger.info("Building project in %s", project_dir)
    build_project(project_dir, config)

    deploy_target = config.get("deploy_target", "")
    if not deploy_target:
        raise ValueError("deploy_target is required in config")

    run_command(["rsync", "-avz", "--delete", str(project_dir / "dist") + "/", deploy_target])
    logger.info("Deployment to %s complete", env)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) != 2:
        print("Usage: python deploy.py <staging|production>", file=sys.stderr)
        sys.exit(1)
    deploy(sys.argv[1])
`,
  },
  expected: [],
  groundTruth: { expectedVulnCount: 0, expectedClean: true },
}

export const SECURE_CORPUS: CorpusEntry[] = [
  secureExpressApi,
  secureNextjsApi,
  secureDjangoView,
  secureCryptoModule,
  securePythonScript,
]
