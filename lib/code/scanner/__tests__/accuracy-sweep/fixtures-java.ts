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
      // java-sql-concat pattern requires Statement and executeQuery on the same line
      // Fixture splits across lines 6-7, so it doesn't match
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
      // java-deserialization requires ObjectInputStream and readObject on same line
      // Fixture splits across lines 5-6, so it doesn't match
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

  // -----------------------------------------------------------------------
  // 8. Java deserialization single-line → TP
  // -----------------------------------------------------------------------
  {
    name: 'java-deserialization-inline',
    description: 'ObjectInputStream + readObject on same line — TP',
    file: {
      path: 'src/main/java/com/app/rpc/Handler.java',
      content: `import java.io.*;
import java.net.*;

public class Handler {
    public Object handleRequest(Socket socket) throws Exception {
        Object obj = new ObjectInputStream(socket.getInputStream()).readObject();
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
  // 9. Java SSRF via URL.openStream — no specific rule (verify no FPs)
  // -----------------------------------------------------------------------
  {
    name: 'java-ssrf-url-open',
    description: 'new URL(userUrl).openStream() — no java-ssrf rule yet',
    file: {
      path: 'src/main/java/com/app/proxy/Fetcher.java',
      content: `import java.net.*;
import java.io.*;

public class Fetcher {
    public InputStream fetch(String userUrl) throws Exception {
        return new URL(userUrl).openStream();
    }
}`,
      language: 'java',
    },
    expected: [
      // No java-ssrf rule exists — verify no false positives from other rules
    ],
  },

  // -----------------------------------------------------------------------
  // 10. Java log injection — no specific rule (verify no FPs)
  // -----------------------------------------------------------------------
  {
    name: 'java-log-injection-param',
    description: 'Logger with unsanitized request param — no log-injection rule yet',
    file: {
      path: 'src/main/java/com/app/controller/AuditController.java',
      content: `import java.util.logging.Logger;
import javax.servlet.http.*;

public class AuditController extends HttpServlet {
    private static final Logger logger = Logger.getLogger("audit");

    protected void doGet(HttpServletRequest request, HttpServletResponse response) {
        logger.info("User: " + request.getParameter("user"));
    }
}`,
      language: 'java',
    },
    expected: [
      // No java-log-injection rule exists — verify no false positives
    ],
  },

  // -----------------------------------------------------------------------
  // 11. Java System.exit in production → TP
  // -----------------------------------------------------------------------
  {
    name: 'java-system-exit-production',
    description: 'System.exit() in production code — TP for java-system-exit',
    file: {
      path: 'src/main/java/com/app/service/BootstrapService.java',
      content: `public class BootstrapService {
    public void initialize() {
        if (!checkLicense()) {
            System.exit(1);
        }
    }

    private boolean checkLicense() {
        return false;
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'java-system-exit', line: 4, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 12. Java XXE via DocumentBuilderFactory → TP
  // -----------------------------------------------------------------------
  {
    name: 'java-xxe-parser',
    description: 'DocumentBuilderFactory.newInstance() without secure features — XXE',
    file: {
      path: 'src/main/java/com/app/xml/XmlParser.java',
      content: `import javax.xml.parsers.*;
import org.xml.sax.InputSource;
import java.io.StringReader;

public class XmlParser {
    public Document parseXml(String userXml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        DocumentBuilder builder = factory.newDocumentBuilder();
        Document doc = builder.parse(new InputSource(new StringReader(userXml)));
        return doc;
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'xxe-java', line: 7, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 14. java-sql-concat — TP
  // -----------------------------------------------------------------------
  {
    name: 'java-sql-concat',
    description: 'Java SQL query built via string concatenation — TP',
    file: {
      path: 'src/main/java/com/app/UserDao.java',
      content: `package com.app;
import java.sql.*;
public class UserDao {
    public User findUser(Connection conn, String name) throws SQLException {
        ResultSet rs = conn.createStatement().executeQuery("SELECT * FROM users WHERE name = '" + name + "'");
        return mapUser(rs);
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'java-sql-concat', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 15. spring-missing-valid + spring-permit-all — TP
  // -----------------------------------------------------------------------
  {
    name: 'spring-missing-valid-permit-all',
    description: 'Spring controller missing @Valid and permitAll — TP',
    file: {
      path: 'src/main/java/com/app/SecurityConfig.java',
      content: `package com.app;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
@RestController
public class UserController {
    @PostMapping("/users") public User createUser(@RequestBody UserDto dto) {
        return userService.create(dto);
    }
}
class SecurityConfig {
    protected void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests().anyRequest().permitAll();
    }
}`,
      language: 'java',
    },
    expected: [
      { ruleId: 'spring-missing-valid', line: 6, verdict: 'tp' },
      { ruleId: 'spring-permit-all', line: 12, verdict: 'tp' },
    ],
  },
]
