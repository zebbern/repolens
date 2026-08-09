"use client"

import { signOut, useSession } from "next-auth/react"
import Image from "next/image"
import { LogOut, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function UserMenu() {
  const { data: session } = useSession()

  if (!session?.user) {
    return null
  }

  const { githubUsername, githubAvatar } = session.user as {
    githubUsername?: string
    githubAvatar?: string
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full overflow-hidden hover:ring-2 hover:ring-foreground/10"
          aria-label={`Open user menu${githubUsername ? ` for ${githubUsername}` : ''}`}
        >
          {githubAvatar ? (
            <Image
              src={githubAvatar}
              alt={githubUsername ?? "User avatar"}
              className="h-5 w-5 rounded-full"
              width={20}
              height={20}
            />
          ) : (
            <User className="h-3.5 w-3.5 text-text-secondary" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium text-text-primary">
            {githubUsername ?? "GitHub User"}
          </p>
          <p className="text-xs text-text-secondary">Signed in via GitHub</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut()}
          className="text-text-secondary cursor-pointer"
        >
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
