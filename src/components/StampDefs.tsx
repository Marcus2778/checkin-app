/**
 * 印章质感的来源。整个应用只挂载一次（在 App 里）。
 *
 * 原理：先用 feTurbulence 造一张噪声图，再用 feDisplacementMap 拿它去"推"图形的像素，
 * 于是笔直的边被揉成不规则的手工边 —— 这正是真印章盖出来不完美的样子。
 * 之后再用第二层噪声调制 alpha，让墨色有浓有淡，而不是一块死平的色块。
 *
 * 平面色块是 AI 最容易生成的形状；而不规则和浓淡，恰恰是它最不会做的。
 */

export function StampDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute' }}
    >
      <defs>
        {/* 大章（记录带上的一周格子）*/}
        <filter id="stamp-ink" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves="4"
            seed="7"
            result="warp"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale="5"
            xChannelSelector="R"
            yChannelSelector="G"
            result="rough"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="23"
            result="grain"
          />
          <feColorMatrix in="grain" type="luminanceToAlpha" result="grainAlpha" />
          <feComponentTransfer in="grainAlpha" result="grainFade">
            <feFuncA type="linear" slope="0.5" intercept="0.55" />
          </feComponentTransfer>
          {/* 拿噪声的 alpha 去乘图形的 alpha —— 墨色就有了浓淡 */}
          <feComposite in="rough" in2="grainFade" operator="in" />
        </filter>

        {/* 小章（任务前的勾选框）。位移要小得多，否则 18px 上会糊成一团 */}
        <filter id="stamp-ink-small" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.14"
            numOctaves="3"
            seed="11"
            result="warp"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale="1.8"
            xChannelSelector="R"
            yChannelSelector="G"
            result="rough"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.2"
            numOctaves="2"
            seed="5"
            result="grain"
          />
          <feColorMatrix in="grain" type="luminanceToAlpha" result="grainAlpha" />
          <feComponentTransfer in="grainAlpha" result="grainFade">
            <feFuncA type="linear" slope="0.45" intercept="0.6" />
          </feComponentTransfer>
          <feComposite in="rough" in2="grainFade" operator="in" />
        </filter>
      </defs>
    </svg>
  )
}
