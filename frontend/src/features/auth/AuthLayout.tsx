import { motion } from 'framer-motion'
import { Activity, CalendarRange, Gauge, Users } from 'lucide-react'
import { Logo } from '@/components/Logo'

const HIGHLIGHTS = [
  { icon: Gauge, title: 'Know what is at risk', text: 'Health, forecasts and blockers surface before deadlines slip.' },
  { icon: CalendarRange, title: 'Plan with confidence', text: 'Timelines with dependencies and milestones your team can trust.' },
  { icon: Users, title: 'Balance the load', text: 'See capacity vs. planned work for every person, every week.' },
  { icon: Activity, title: 'Move together, live', text: 'Comments, mentions and updates in real time.' },
]

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-sm"
          >
            {children}
          </motion.div>
        </div>
        <p className="text-xs text-subtle">© {new Date().getFullYear()} ProjectHub</p>
      </div>

      <div className="relative hidden overflow-hidden border-l border-border bg-surface lg:block">
        <div className="absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <div className="absolute -right-32 -top-32 size-[520px] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute -bottom-40 left-10 size-[420px] rounded-full bg-fuchsia-500/10 blur-[120px]" />
        <div className="relative flex h-full flex-col justify-center gap-10 px-14 xl:px-20">
          <div>
            <p className="text-sm font-medium text-primary">Work management for teams that ship</p>
            <h2 className="mt-3 max-w-md text-balance text-3xl font-semibold tracking-tight xl:text-4xl">
              Every project, every person, one clear picture.
            </h2>
          </div>
          <div className="grid max-w-lg gap-3">
            {HIGHLIGHTS.map((h, i) => (
              <motion.div
                key={h.title}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.07, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="flex gap-3 rounded-xl border border-border bg-background/60 p-4 shadow-elev-1 backdrop-blur"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <h.icon className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{h.title}</p>
                  <p className="text-sm text-muted-foreground">{h.text}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
