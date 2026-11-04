'use client'

import { Button } from '@/components/ui/button'
import { Menu, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useTasks } from '@/components/app-layout'
import { User } from '@/components/auth/user'

interface SharedHeaderProps {
  leftActions?: React.ReactNode
  extraActions?: React.ReactNode
  initialStars?: number
  hideStars?: boolean
  hideDeployButton?: boolean
}

export function SharedHeader({ leftActions, extraActions }: SharedHeaderProps) {
  const { toggleSidebar } = useTasks()

  return (
    <div className="px-3 pt-3 pb-2 sm:px-5 md:pt-4">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between gap-2 rounded-2xl border border-white/80 bg-white/75 px-2.5 shadow-[0_12px_36px_-28px_rgba(37,99,235,0.58)] backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Button
            onClick={toggleSidebar}
            variant="ghost"
            size="sm"
            className="h-9 w-9 flex-shrink-0 rounded-xl p-0 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <Link href="/" aria-label="Plainvest AI home" className="group inline-flex shrink-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/25 transition-transform group-hover:-rotate-3 group-hover:scale-105">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="hidden whitespace-nowrap text-[15px] font-semibold tracking-tight text-slate-900 sm:inline">
              Plainvest <span className="text-blue-600">AI</span>
            </span>
          </Link>
          {leftActions}
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
          {extraActions}
          <User />
        </div>
      </div>
    </div>
  )
}
