// C# fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const csharpFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. BinaryFormatter deserialization → TP
  // -----------------------------------------------------------------------
  {
    name: 'dotnet-binary-formatter',
    description: 'BinaryFormatter.Deserialize on same line — insecure deserialization, TP',
    file: {
      path: 'src/SessionLoader.cs',
      content: `using System.Runtime.Serialization.Formatters.Binary;
using System.IO;

public class SessionLoader {
    public object LoadSession(string path) {
        using var stream = File.OpenRead(path);
        return new BinaryFormatter().Deserialize(stream);
    }
}`,
      language: 'csharp',
    },
    expected: [
      { ruleId: 'dotnet-binary-formatter', line: 7, expectation: 'present' },
    ],
  },
]
