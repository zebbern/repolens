// PHP fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const phpFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. PHP eval with user input → TP
  // -----------------------------------------------------------------------
  {
    name: 'php-eval-usage',
    description: 'eval($_GET["code"]) — direct code injection via user input',
    file: {
      path: 'app/controllers/eval-handler.php',
      content: `<?php
function handleRequest() {
    $code = $_GET['code'];
    $result = eval($code);
    echo $result;
}`,
      language: 'php',
    },
    expected: [
      { ruleId: 'php-eval', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 2. PHP SQL injection via string concat → TP
  // -----------------------------------------------------------------------
  {
    name: 'php-sql-injection-concat',
    description: 'mysqli_query with concatenated user input — SQL injection',
    file: {
      path: 'app/models/user-lookup.php',
      content: `<?php
function findUser($conn) {
    $id = $_GET['id'];
    $result = mysqli_query($conn, "SELECT * FROM users WHERE id = $id");
    return mysqli_fetch_assoc($result);
}`,
      language: 'php',
    },
    expected: [
      { ruleId: 'php-sql-injection', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 3. PHP include with variable path → TP
  // -----------------------------------------------------------------------
  {
    name: 'php-include-variable-path',
    description: 'include($_GET["page"]) — Local File Inclusion',
    file: {
      path: 'app/controllers/page-loader.php',
      content: `<?php
function loadPage() {
    $page = $_GET['page'];
    include($page . '.php');
}`,
      language: 'php',
    },
    expected: [
      { ruleId: 'php-include-var', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 4. PHP unserialize with cookie data → TP
  // -----------------------------------------------------------------------
  {
    name: 'php-deserialize-cookie',
    description: 'unserialize($_COOKIE["user_data"]) — insecure deserialization',
    file: {
      path: 'app/middleware/session-handler.php',
      content: `<?php
function restoreSession() {
    $raw = $_COOKIE['user_data'];
    $data = unserialize($raw);
    return $data;
}`,
      language: 'php',
    },
    expected: [
      { ruleId: 'php-unserialize', line: 4, verdict: 'tp' },
    ],
  },
]
