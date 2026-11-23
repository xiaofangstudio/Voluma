type Props = { size?: number | string; className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ size = 20, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconOpen = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M2.6 7.2V5.6c0-.8.6-1.4 1.4-1.4h3.3l1.5 1.5h6.1c.8 0 1.4.6 1.4 1.4v1.6" />
    <path {...stroke} d="M2.2 8.6h15.6l-1.9 6.4c-.2.7-.8 1.1-1.5 1.1H4.3c-.7 0-1.3-.4-1.5-1.1L2.2 8.6Z" />
  </Svg>
);

export const IconZoomIn = (p: Props) => (
  <Svg {...p}>
    <circle {...stroke} cx="8.6" cy="8.6" r="4.8" />
    <path {...stroke} d="M12.2 12.2 17 17" />
    <path {...stroke} d="M6.4 8.6h4.4M8.6 6.4v4.4" />
  </Svg>
);

export const IconZoomOut = (p: Props) => (
  <Svg {...p}>
    <circle {...stroke} cx="8.6" cy="8.6" r="4.8" />
    <path {...stroke} d="M12.2 12.2 17 17" />
    <path {...stroke} d="M6.4 8.6h4.4" />
  </Svg>
);

export const IconFitWidth = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M2.6 3.4v13.2" />
    <path {...stroke} d="M17.4 3.4v13.2" />
    <path {...stroke} d="M5.4 6.6 2.9 10l2.5 3.4M14.6 6.6 17.1 10l-2.5 3.4M5.4 10h9.2" />
  </Svg>
);

export const IconSingle = (p: Props) => (
  <Svg {...p}>
    <rect {...stroke} x="5.2" y="2.8" width="9.6" height="14.4" rx="1" />
  </Svg>
);

export const IconDouble = (p: Props) => (
  <Svg {...p}>
    <rect {...stroke} x="2.4" y="3.6" width="6.6" height="12.8" rx="0.9" />
    <rect {...stroke} x="11" y="3.6" width="6.6" height="12.8" rx="0.9" />
  </Svg>
);

export const IconMoon = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M16.4 12.1A6.6 6.6 0 1 1 7.9 3.6a5.4 5.4 0 0 0 8.5 8.5Z" />
    <circle {...stroke} cx="15.2" cy="4.9" r="0.9" />
  </Svg>
);

export const IconSearch = (p: Props) => (
  <Svg {...p}>
    <circle {...stroke} cx="8.7" cy="8.7" r="4.7" />
    <path {...stroke} d="M12.2 12.2 17 17" />
  </Svg>
);

export const IconOutline = (p: Props) => (
  <Svg {...p}>
    <circle {...stroke} cx="4.4" cy="5.4" r="0.9" />
    <circle {...stroke} cx="4.4" cy="10" r="0.9" />
    <circle {...stroke} cx="4.4" cy="14.6" r="0.9" />
    <path {...stroke} d="M8 5.4h8.4M8 10h6.4M8 14.6h8.4" />
  </Svg>
);

export const IconThumbs = (p: Props) => (
  <Svg {...p}>
    <rect {...stroke} x="3" y="3.4" width="6" height="5.8" rx="0.9" />
    <rect {...stroke} x="11" y="3.4" width="6" height="5.8" rx="0.9" />
    <rect {...stroke} x="3" y="10.8" width="6" height="5.8" rx="0.9" />
    <rect {...stroke} x="11" y="10.8" width="6" height="5.8" rx="0.9" />
  </Svg>
);

export const IconContinuous = (p: Props) => (
  <Svg {...p}>
    <rect {...stroke} x="3.2" y="2.6" width="13.6" height="5" rx="1" />
    <rect {...stroke} x="3.2" y="8" width="13.6" height="4" rx="1" />
    <rect {...stroke} x="3.2" y="13.4" width="13.6" height="4" rx="1" />
  </Svg>
);

export const IconChevronLeft = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M11.6 4.6 6.2 10l5.4 5.4" />
  </Svg>
);

export const IconChevronRight = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M8.4 4.6 13.8 10l-5.4 5.4" />
  </Svg>
);

export const IconClose = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M5 5l10 10M15 5 5 15" />
  </Svg>
);

/* ---------- 注释工具 ---------- */

export const IconHighlight = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M3.4 16.8l1-4.1 7.5-7.5 3 3-7.5 7.5z" />
    <path {...stroke} d="M11.2 5.9l2.9 2.9M3.4 16.8l4.1-1" />
    <path {...stroke} d="M12.6 14.4h4.6" />
  </Svg>
);

export const IconUnderline = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M6 3.4v5.2a4 4 0 0 0 8 0V3.4" />
    <path {...stroke} d="M4 16.4h12" />
  </Svg>
);

export const IconStrike = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M13.4 5.2c-.7-1-1.9-1.6-3.4-1.6-2 0-3.4 1-3.4 2.5 0 1.2.8 1.9 2.6 2.4" />
    <path {...stroke} d="M6.6 14.8c.7 1 1.9 1.6 3.4 1.6 2 0 3.4-1 3.4-2.5 0-1.2-.8-1.9-2.6-2.4" />
    <path {...stroke} d="M3.2 10h13.6" />
  </Svg>
);

export const IconRect = (p: Props) => (
  <Svg {...p}>
    <rect {...stroke} x="3" y="4.4" width="14" height="11.2" rx="1.2" />
  </Svg>
);

export const IconEllipse = (p: Props) => (
  <Svg {...p}>
    <ellipse {...stroke} cx="10" cy="10" rx="7" ry="5.6" />
  </Svg>
);

export const IconPen = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M3.2 16.8l1.3-4.5 8.7-8.7 3 3-8.7 8.7z" />
    <path {...stroke} d="M12.1 4.6l3.3 3.3" />
    <circle {...stroke} cx="6.4" cy="13.6" r="1" />
  </Svg>
);

export const IconNote = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M4 3.4h8.8l3.2 3.2v10H4z" />
    <path {...stroke} d="M12.8 3.4v3.2h3.2" />
    <path {...stroke} d="M6.6 9h6.4M6.6 12h4.4" />
  </Svg>
);

export const IconPin = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M10 17.2s5-4.4 5-8.2a5 5 0 1 0-10 0c0 3.8 5 8.2 5 8.2Z" />
    <circle {...stroke} cx="10" cy="9" r="1.9" />
  </Svg>
);

export const IconAnnotList = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M3.4 4.6h13.2v9.6H8.4L5.2 17v-2.8H3.4z" />
    <path {...stroke} d="M6.6 7.8h6.8M6.6 10.6h4.6" />
  </Svg>
);

export const IconPages = (p: Props) => (
  <Svg {...p}>
    <rect {...stroke} x="3" y="3.4" width="6" height="7.6" rx=".8" />
    <rect {...stroke} x="11" y="3.4" width="6" height="7.6" rx=".8" />
    <rect {...stroke} x="3" y="12.6" width="6" height="4.4" rx=".8" />
    <rect {...stroke} x="11" y="12.6" width="6" height="4.4" rx=".8" />
  </Svg>
);

export const IconRotate = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M4.4 9.4A6 6 0 1 1 7 15.4" />
    <path {...stroke} d="M4.2 4.6v4.8h4.8" />
  </Svg>
);

export const IconExtract = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M4.2 3.4h8.4v13.2H4.2z" />
    <path {...stroke} d="M9 7.2h7v9.4H9" />
    <path {...stroke} d="M12.4 9.8v4.2M10.6 12.2l1.8 1.8 1.8-1.8" />
  </Svg>
);

export const IconInsert = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M3.6 3.4h8.4v13.2H3.6z" />
    <path {...stroke} d="M8 7.2h8.4v9.4H8" />
    <path {...stroke} d="M12.2 9.4v5M10 11.6l2.2-2.2 2.2 2.2" />
  </Svg>
);

export const IconForm = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M4.2 3h10.6v14H4.2z" />
    <path {...stroke} d="M6.6 6.4h4.8M6.6 9.4h2.4" />
    <rect {...stroke} x="10.4" y="8.4" width="2.4" height="2.4" rx=".4" />
    <path {...stroke} d="M6.6 13h6.2" />
  </Svg>
);

export const IconDoc = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M5 2.8h7l3 3v11.4H5z" />
    <path {...stroke} d="M12 2.8v3h3" />
    <path {...stroke} d="M7.4 9h5.2M7.4 12h3.6" />
  </Svg>
);

/** 20px 版应用标：两页错位 + 缎带 */
export const IconPrint = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M5.2 7.4V3.4h9.6v4" />
    <rect {...stroke} x="2.8" y="7.4" width="14.4" height="6.4" rx="1" />
    <path {...stroke} d="M5.2 11.4h9.6v5H5.2z" />
    <rect fill="currentColor" stroke="none" x="12.9" y="9" width="1.4" height="1.4" rx=".3" />
  </Svg>
);

export const IconExport = (p: Props) => (
  <Svg {...p}>
    <path {...stroke} d="M4 3.4h7.4l3.8 3.8v9.4H4z" />
    <path {...stroke} d="M11.2 3.4v4h4" />
    <path {...stroke} d="M7 13.6v-4.4M5.2 10.6l1.8-1.8 1.8 1.8" />
  </Svg>
);

export const BrandMark = ({ size = 20, className }: Props) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="4" y="4" width="56" height="56" rx="14" fill="#b02a37" />
    <rect x="25" y="19" width="22" height="31" rx="1.5" fill="#f3d7db" />
    <rect x="21" y="16" width="22" height="31" rx="1.5" fill="#ffffff" />
    <path d="M36 16h7v7z" fill="#e7c4c9" />
    <path d="M23 16v8l2-2 2 2v-8z" fill="#b02a37" />
  </svg>
);
