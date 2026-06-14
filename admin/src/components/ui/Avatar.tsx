import { cn } from '@/lib/utils'

interface AvatarProps {
  src?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASSES = {
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-11 text-base',
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full',
        SIZE_CLASSES[size],
        !src && 'bg-slate-200 dark:bg-slate-600',
        className,
      )}
      aria-label={name}
    >
      {src ? (
        // Using img for simplicity; swap to next/image when domain is configured
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span className="font-medium text-slate-600 dark:text-slate-300 select-none">
          {initials(name)}
        </span>
      )}
    </div>
  )
}
