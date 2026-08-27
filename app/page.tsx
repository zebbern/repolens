"use client"

import { useEffect, useRef, useState } from "react"
import { MessageSquare } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ResizableLayout } from "@/components/layout/resizable-layout"
import { ChatSidebar } from "@/components/features/chat/chat-sidebar"
import { PreviewPanel } from "@/components/features/preview/preview-panel"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { useApp } from "@/providers"

export default function HomePage() {
  const isMobile = useIsMobile()
  const [isChatOpen, setIsChatOpen] = useState(false)
  const handledChatRequestRef = useRef(0)
  const { isChatCollapsed, chatFocusRequest, setChatCollapsed } = useApp()

  useEffect(() => {
    if (chatFocusRequest <= handledChatRequestRef.current) return
    handledChatRequestRef.current = chatFocusRequest
    if (isMobile) {
      queueMicrotask(() => setIsChatOpen(true))
    }
  }, [chatFocusRequest, isMobile])

  return (
    <div className="flex h-screen w-full flex-col bg-primary-background font-sans text-text-primary">
      <Header />
      <div className="flex-1 overflow-hidden px-2 pt-2">
        {isMobile ? (
          <>
            <PreviewPanel className="h-full rounded-lg overflow-hidden" />
            <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
              <SheetTrigger asChild>
                <Button
                  size="icon"
                  className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg"
                  aria-label="Open chat"
                >
                  <MessageSquare className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
                <SheetTitle className="sr-only">Chat</SheetTitle>
                <SheetDescription className="sr-only">
                  Chat with RepoLens about repository code and analysis.
                </SheetDescription>
                <ChatSidebar className="h-full" />
              </SheetContent>
            </Sheet>
          </>
        ) : isChatCollapsed ? (
          <PreviewPanel className="h-full rounded-lg overflow-hidden" />
        ) : (
          <ResizableLayout
            sidebarContent={<ChatSidebar onCollapse={() => setChatCollapsed(true)} />}
            mainContent={<PreviewPanel className="rounded-lg overflow-hidden" />}
          />
        )}
      </div>
    </div>
  )
}
