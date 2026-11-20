import logoImg from '../assets/logo.png'

export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <img
      src={logoImg}
      alt="ReelStar"
      width={size}
      height={size}
      className="shrink-0 rounded-[8px] object-cover shadow-xs"
      style={{ width: size, height: size }}
    />
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={34} />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[21px] font-bold tracking-[-0.01em] text-ink">ReelStar</span>
        <span className="mt-[3px] text-[11px] font-medium tracking-wide text-muted">short drama ai</span>
      </span>
    </span>
  )
}
