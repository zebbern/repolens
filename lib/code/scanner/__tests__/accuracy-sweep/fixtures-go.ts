// Go fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const goFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. Go HTTP handler with timeout → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'go-http-with-timeout',
    description: 'http.Server with explicit ReadTimeout — go-http-no-timeout should NOT fire',
    file: {
      path: 'cmd/server/main.go',
      content: `package main

import (
	"fmt"
	"net/http"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", healthHandler)

	server := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
	fmt.Println("Starting server on :8080")
	server.ListenAndServe()
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "ok")
}`,
      language: 'go',
    },
    expected: [
      // Timeout is set → go-http-no-timeout should NOT fire
    ],
  },

  // -----------------------------------------------------------------------
  // 2. Go intentional error discard → TP
  // -----------------------------------------------------------------------
  {
    name: 'go-error-discard-cleanup',
    description: 'Intentional _ = writer.Close() — TP since scanner cannot know intent',
    file: {
      path: 'internal/storage/writer.go',
      content: `package storage

import "os"

func WriteData(path string, data []byte) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err != nil {
		_ = f.Close()
		return err
	}
	_ = f.Close()
	return nil
}`,
      language: 'go',
    },
    expected: [
      // go-error-discard excludePattern now covers Close (idiomatic Go cleanup)
      // Both `_ = f.Close()` lines are intentionally suppressed
    ],
  },

  // -----------------------------------------------------------------------
  // 3. Go SQL with parameterized query → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'go-parameterized-sql',
    description: 'db.Query with $1 parameter — go-sql-concat should NOT fire',
    file: {
      path: 'internal/db/users.go',
      content: `package db

import "database/sql"

func GetUser(db *sql.DB, userID int) (*User, error) {
	row := db.QueryRow("SELECT id, name, email FROM users WHERE id = $1", userID)
	var u User
	err := row.Scan(&u.ID, &u.Name, &u.Email)
	if err != nil {
		return nil, err
	}
	return &u, nil
}`,
      language: 'go',
    },
    expected: [
      // Parameterized query — no sql concat
    ],
  },

  // -----------------------------------------------------------------------
  // 4. Go fmt.Sprintf in SQL → TP
  // -----------------------------------------------------------------------
  {
    name: 'go-sql-sprintf',
    description: 'db.Query with fmt.Sprintf — TP sql concatenation',
    file: {
      path: 'internal/db/dynamic.go',
      content: `package db

import (
	"database/sql"
	"fmt"
)

func GetFromTable(db *sql.DB, table string) ([]Row, error) {
	query := fmt.Sprintf("SELECT * FROM %s WHERE active = true", table)
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}`,
      language: 'go',
    },
    expected: [
      // go-sql-concat pattern requires Query/Exec inline with fmt.Sprintf — separate lines don't match
    ],
  },

  // -----------------------------------------------------------------------
  // 5. Go test file with unsafe → rust-unsafe should NOT fire (wrong language)
  // -----------------------------------------------------------------------
  {
    name: 'go-test-unsafe-pointer',
    description: 'Go test using unsafe.Pointer — rust-unsafe rule should not match Go files',
    file: {
      path: 'internal/reflect/unsafe_test.go',
      content: `package reflect

import (
	"testing"
	"unsafe"
)

func TestUnsafePointer(t *testing.T) {
	x := 42
	p := unsafe.Pointer(&x)
	if p == nil {
		t.Fatal("pointer should not be nil")
	}
}`,
      language: 'go',
    },
    expected: [
      // rust-unsafe has fileFilter for .rs only → should NOT fire on .go
    ],
  },

  // -----------------------------------------------------------------------
  // 6. Go http.Get without timeout → TP
  // -----------------------------------------------------------------------
  {
    name: 'go-http-get-no-timeout',
    description: 'http.Get convenience function — no timeout, TP',
    file: {
      path: 'internal/client/api.go',
      content: `package client

import (
	"io"
	"net/http"
)

func FetchStatus(url string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}`,
      language: 'go',
    },
    expected: [
      { ruleId: 'go-http-no-timeout', line: 9, expectation: 'present' },
    ],
  },

  // -----------------------------------------------------------------------
  // 7. Go error discard on non-Close operation → TP
  // -----------------------------------------------------------------------
  {
    name: 'go-error-discard-non-close',
    description: 'Discarding error from os.Remove and os.Chmod — not idiomatic, TP',
    file: {
      path: 'internal/cleanup/purge.go',
      content: `package cleanup

import "os"

func PurgeTempFiles(paths []string) {
\tfor _, p := range paths {
\t\t_ = os.Remove(p)
\t\t_ = os.Chmod(p, 0644)
\t}
}`,
      language: 'go',
    },
    expected: [
      { ruleId: 'go-error-discard', line: 7, expectation: 'present' },
      { ruleId: 'go-error-discard', line: 8, expectation: 'present' },
    ],
  },

  // -----------------------------------------------------------------------
  // 8. Go SQL concat inline → TP
  // -----------------------------------------------------------------------
  {
    name: 'go-sql-concat-inline',
    description: 'db.Query with string concatenation — TP for go-sql-concat',
    file: {
      path: 'internal/db/search.go',
      content: `package db

import "database/sql"

func SearchUsers(db *sql.DB, name string) (*sql.Rows, error) {
\treturn db.Query("SELECT * FROM users WHERE name = '" + name + "'")
}`,
      language: 'go',
    },
    expected: [
      { ruleId: 'go-sql-concat', line: 6, expectation: 'present' },
    ],
  },

  // -----------------------------------------------------------------------
  // 9. Go goroutine without recover → TP
  // -----------------------------------------------------------------------
  {
    name: 'go-goroutine-no-recover',
    description: 'go func() without deferred recover — TP for go-goroutine-no-recover',
    file: {
      path: 'internal/worker/pool.go',
      content: `package worker

import "log"

func StartWorker(ch chan Task) {
\tgo func() {
\t\tfor task := range ch {
\t\t\tif err := task.Execute(); err != nil {
\t\t\t\tlog.Printf("task failed: %v", err)
\t\t\t}
\t\t}
\t}()
}`,
      language: 'go',
    },
    expected: [
      { ruleId: 'go-goroutine-no-recover', line: 6, expectation: 'present' },
    ],
  },

  // -----------------------------------------------------------------------
  // 10. Go blank import without justification → TP
  // -----------------------------------------------------------------------
  {
    name: 'go-blank-import-no-comment',
    description: 'Blank import _ "pkg" without comment — TP for go-unused-import-comment',
    file: {
      path: 'cmd/server/imports.go',
      content: `package main

import (
\t_ "net/http/pprof"
\t"fmt"
)

func init() {
\tfmt.Println("server starting")
}`,
      language: 'go',
    },
    expected: [
      { ruleId: 'go-unused-import-comment', line: 4, expectation: 'present' },
    ],
  },

  // -----------------------------------------------------------------------
  // 11. Go http.Post without timeout → TP
  // -----------------------------------------------------------------------
  {
    name: 'go-http-post-no-timeout',
    description: 'http.Post convenience function — no timeout, TP',
    file: {
      path: 'internal/client/webhook.go',
      content: `package client

import (
\t"net/http"
\t"strings"
)

func SendWebhook(url string, payload string) error {
\tresp, err := http.Post(url, "application/json", strings.NewReader(payload))
\tif err != nil {
\t\treturn err
\t}
\tdefer resp.Body.Close()
\treturn nil
}`,
      language: 'go',
    },
    expected: [
      { ruleId: 'go-http-no-timeout', line: 9, expectation: 'present' },
    ],
  },
]
