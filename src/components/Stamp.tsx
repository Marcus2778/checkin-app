export type StampState =
  /** 盖满了 */
  | 'done'
  /** 只完成了一部分，墨只填到相应高度 */
  | 'partial'
  /** 今天还没盖，留一个淡淡的印子等你 */
  | 'waiting'
  /** 空着，什么都不画 */
  | 'blank'

interface Props {
  state: StampState
  /** 0–1，只有 partial 用得上 */
  ratio?: number
  /** 用来稳定地推出倾角和墨色深浅 */
  seed: string
}

/** 每枚章歪的角度都不一样，但同一枚章每次渲染必须长一样，否则会看起来在抖 */
function rotationFor(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return ((hash % 9) - 4) * 0.85 // -3.4° ~ +3.4°
}

/** 墨色浓淡。真印章没有两枚是一模一样的。 */
function inkFor(seed: string): number {
  let hash = 0
  for (let i = seed.length - 1; i >= 0; i -= 1) hash = (hash * 37 + seed.charCodeAt(i)) >>> 0
  return 0.87 + (hash % 13) / 100 // 0.87 ~ 0.99
}

export function Stamp({ state, ratio = 0, seed }: Props) {
  if (state === 'blank') return <div className="aspect-square w-full" />

  const ink = inkFor(seed)
  const fill = state === 'done' ? 1 : Math.min(1, Math.max(0, ratio))

  return (
    <div className="aspect-square w-full" style={{ transform: `rotate(${rotationFor(seed)}deg)` }}>
      <div
        className={[
          'relative h-full w-full',
          state === 'done'
            ? 'motion-safe:animate-[stamp-press_420ms_cubic-bezier(0.2,0.8,0.3,1)]'
            : '',
        ].join(' ')}
        style={{ filter: 'url(#stamp-ink)' }}
      >
        {/* 先画墨量，再画轮廓 —— 轮廓压在最上面，边才利落 */}
        {fill > 0 && (
          <div
            className="absolute inset-x-0 bottom-0 rounded-b-[5px] bg-seal"
            style={{ height: `${fill * 100}%`, opacity: ink }}
          />
        )}
        {/* "今天还没盖"用灰色而不是淡红：红墨只出现在真正盖下的章上，
            这样整页的红色就只有一种含义 —— 你做到了。 */}
        <div
          className={[
            'absolute inset-0 rounded-[5px] border-[3px]',
            state === 'waiting' ? 'border-slot' : 'border-seal',
          ].join(' ')}
          style={{ opacity: state === 'waiting' ? 0.75 : ink }}
        />
      </div>
    </div>
  )
}
