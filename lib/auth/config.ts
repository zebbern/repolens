import GitHub from "next-auth/providers/github"
import type { NextAuthConfig, DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      githubUserId?: string
      githubUsername?: string
      githubAvatar?: string
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string
    githubUserId?: string
    githubUsername?: string
    githubAvatar?: string
  }
}

export const authConfig: NextAuthConfig = {
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      // GitHub OAuth Apps have no read-only private-code scope. `repo` is the
      // narrowest OAuth scope that preserves RepoLens private-repository access.
      authorization: { params: { scope: "read:user repo" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token
        token.githubUserId = token.sub
        token.githubUsername = (profile as Record<string, unknown>)?.login as string
        token.githubAvatar = (profile as Record<string, unknown>)?.avatar_url as string
      }
      return token
    },
    session({ session, token }) {
      session.user.githubUserId = token.sub ?? token.githubUserId
      session.user.githubUsername = token.githubUsername
      session.user.githubAvatar = token.githubAvatar
      // Never expose accessToken to the client
      return session
    },
  },
}
