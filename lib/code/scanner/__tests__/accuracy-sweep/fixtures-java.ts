// Java fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const javaFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. Spring controller with @Valid → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'spring-controller-with-valid',
    description: '@Valid @RequestBody annotation present — spring-missing-valid should NOT fire',
    file: {
      path: 'src/main/java/com/app/controller/UserController.java',
      content: `import org.springframework.web.bind.annotation.*;
import javax.validation.Valid;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @PostMapping
    public User createUser(@Valid @RequestBody UserDTO dto) {
        return userService.create(dto);
    }

    @PutMapping("/{id}")
    public User updateUser(@PathVariable Long id, @Valid @RequestBody UserDTO dto) {
        return userService.update(id, dto);
    }
}`,
      language: 'java',
    },
    expected: [
      // @Valid is present → spring-missing-valid should NOT fire
    ],
  },

  // -----------------------------------------------------------------------
  // 2. Java PreparedStatement → should NOT fire
  // -----------------------------------------------------------------------
  {
    name: 'java-prepared-statement',
    description: 'Parameterized SQL with PreparedStatement — java-sql-concat should NOT fire',
    file: {
      path: 'src/main/java/com/app/dao/UserDAO.java',
      content: `import java.sql.*;

public class UserDAO {
    public User findById(Connection conn, int id) throws SQLException {
        PreparedStatement stmt = conn.prepareStatement(
            "SELECT * FROM users WHERE id = ?"
        );
        stmt.setInt(1, id);
        ResultSet rs = stmt.executeQuery();
        if (rs.next()) {
            return mapUser(rs);
        }
        return null;
    }
}`,
      language: 'java',
    },
    expected: [
      // PreparedStatement with ? placeholder — safe, no sql injection
    ],
  },

  // -----------------------------------------------------------------------
  // 3. Java string concat in SQL → TP
  // -----------------------------------------------------------------------
  {
    name: 'java-sql-string-concat',
    description: 'SQL string concatenation with user input — TP',
    file: {
      path: 'src/main/java/com/app/dao/SearchDAO.java',
      content: `import java.sql.*;

public class SearchDAO {
    public ResultSet searchByName(Connection conn, String name) throws SQLException {
        Statement stmt = conn.createStatement();
        ResultSet rs = stmt.executeQuery(
            "SELECT * FROM users WHERE name = '" + name + "'"
        );
        return rs;
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'java-sql-concat', line: 7, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 4. Java Runtime.exec with hardcoded command → TP
  // -----------------------------------------------------------------------
  {
    name: 'java-runtime-exec-hardcoded',
    description: 'Runtime.getRuntime().exec with hardcoded command — TP (still flagged)',
    file: {
      path: 'src/main/java/com/app/util/GitHelper.java',
      content: `public class GitHelper {
    public String getStatus() throws Exception {
        Process proc = Runtime.getRuntime().exec("git status");
        byte[] output = proc.getInputStream().readAllBytes();
        proc.waitFor();
        return new String(output);
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'java-runtime-exec', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 5. Java ObjectInputStream deserialization → TP
  // -----------------------------------------------------------------------
  {
    name: 'java-deserialization',
    description: 'ObjectInputStream.readObject without type validation — TP',
    file: {
      path: 'src/main/java/com/app/util/Loader.java',
      content: `import java.io.*;

public class Loader {
    public Object loadObject(String path) throws Exception {
        ObjectInputStream ois = new ObjectInputStream(new FileInputStream(path));
        Object obj = ois.readObject();
        ois.close();
        return obj;
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'java-deserialization', line: 6, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 6. Java Spring missing CSRF → TP
  // -----------------------------------------------------------------------
  {
    name: 'java-spring-csrf-disabled',
    description: 'Spring Security with CSRF disabled — TP',
    file: {
      path: 'src/main/java/com/app/config/SecurityConfig.java',
      content: `import org.springframework.security.config.annotation.web.builders.HttpSecurity;

public class SecurityConfig {
    protected void configure(HttpSecurity http) throws Exception {
        http.csrf().disable()
            .authorizeRequests()
            .anyRequest().authenticated();
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'spring-csrf-disabled', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 7. Java hardcoded password in connection string → TP
  // -----------------------------------------------------------------------
  {
    name: 'java-hardcoded-db-password',
    description: 'Hardcoded database password in JDBC URL — TP',
    file: {
      path: 'src/main/java/com/app/db/Database.java',
      content: `import java.sql.*;

public class Database {
    private static final String URL = "jdbc:mysql://localhost:3306/mydb";
    private static final String USER = "root";
    private static final String PASSWORD = "rootpassword123";

    public Connection getConnection() throws SQLException {
        return DriverManager.getConnection(URL, USER, PASSWORD);
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'hardcoded-password', line: 6, verdict: 'tp' },
    ],
  },
]
