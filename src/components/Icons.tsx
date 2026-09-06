/** 线性图标集，统一 1.7 描边以贴合 SF Symbols 的视觉重量。 */
interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconWave = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11h2" />
  </svg>
);

export const IconVoice = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
  </svg>
);

export const IconClock = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const IconGear = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6h.08A1.6 1.6 0 0 0 10 3.13V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9v.08a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
);

export const IconPlay = ({ size = 15, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M7.5 4.8c0-.9 1-1.5 1.8-1l10 6.2c.7.4.7 1.5 0 2l-10 6.2c-.8.5-1.8-.1-1.8-1V4.8z" />
  </svg>
);

export const IconPause = ({ size = 15, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="6" y="4" width="4.2" height="16" rx="1.4" />
    <rect x="13.8" y="4" width="4.2" height="16" rx="1.4" />
  </svg>
);

export const IconStop = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" />
  </svg>
);

export const IconTrash = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6.5h16M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
    <path d="M6.5 6.5l.8 12.2A1.8 1.8 0 0 0 9.1 20.3h5.8a1.8 1.8 0 0 0 1.8-1.6l.8-12.2" />
    <path d="M10.5 10.5v6M13.5 10.5v6" />
  </svg>
);

export const IconDownload = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3.5v11M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </svg>
);

export const IconPlus = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconX = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconMic = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="2.8" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </svg>
);

export const IconSpeaker = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M11 5.5 6.8 9H3.5v6h3.3L11 18.5v-13z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

export const IconVolumeLow = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M11 5.5 6.8 9H3.5v6h3.3L11 18.5v-13z" />
  </svg>
);

export const IconRefresh = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M20.5 4v5h-5" />
  </svg>
);

export const IconCheck = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </svg>
);

export const IconAlert = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.2v.6" />
  </svg>
);

export const IconFolder = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h3.9a1.5 1.5 0 0 1 1.1.5l1.1 1.2H19a1.5 1.5 0 0 1 1.5 1.5v7.3A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-9z" />
  </svg>
);
