/**
 * Validates GitHub owner/repo names per the
 * {@link https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-on-github GitHub name rules}.
 */
export const GITHUB_NAME_RE = /^[\w][\w.-]*$/
