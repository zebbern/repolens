"use client"

import { useState } from "react"
import { MessageSquare } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ResizableLayout } from "@/components/layout/resizable-layout"
import { ChatSidebar } from "@/components/features/chat/chat-sidebar"
import { PreviewPanel } from "@/components/features/preview/preview-panel"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"

export default function HomePage() {
  const isMobile = useIsMobile()
  const [isChatOpen, setIsChatOpen] = useState(false)

  return (
    <div className="flex h-screen w-full flex-col bg-primary-background font-sans text-text-primary">
      <Header />
      <div className="flex-1 overflow-hidden px-2 pt-2">
        {isMobile ? (
          <>
            <PreviewPanel className="h-full rounded-lg overflow-hidden" />
            <Button
              size="icon"
              className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg"
              onClick={() => setIsChatOpen(true)}
              aria-label="Open chat"
            >
              <MessageSquare className="h-5 w-5" />
            </Button>
            <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
              <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
                <SheetTitle className="sr-only">Chat</SheetTitle>
                <ChatSidebar className="h-full" />
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <ResizableLayout
            sidebarContent={<ChatSidebar />}
            mainContent={<PreviewPanel className="rounded-lg overflow-hidden" />}
          />
        )}
      </div>
    </div>
  )
}
