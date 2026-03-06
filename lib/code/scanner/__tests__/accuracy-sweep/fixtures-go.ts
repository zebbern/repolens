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
      { ruleId: 'go-sql-concat', line: 9, verdict: 'tp' },
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
      { ruleId: 'go-http-no-timeout', line: 9, verdict: 'tp' },
    ],
  },
]
