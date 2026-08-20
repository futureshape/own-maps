import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const MapIcon = (props: Props) => <Icon {...props}><path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3z"/><path d="M8 3v15M16 6v15"/></Icon>;
export const PlusIcon = (props: Props) => <Icon {...props}><path d="M12 5v14M5 12h14"/></Icon>;
export const ShareIcon = (props: Props) => <Icon {...props}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></Icon>;
export const CloseIcon = (props: Props) => <Icon {...props}><path d="m6 6 12 12M18 6 6 18"/></Icon>;
export const MoreIcon = (props: Props) => <Icon {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></Icon>;
export const SearchIcon = (props: Props) => <Icon {...props}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></Icon>;
export const ArrowIcon = (props: Props) => <Icon {...props}><path d="m9 18 6-6-6-6"/></Icon>;
export const TrashIcon = (props: Props) => <Icon {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></Icon>;
export const BackIcon = (props: Props) => <Icon {...props}><path d="m15 18-6-6 6-6"/></Icon>;
export const ChevronDownIcon = (props: Props) => <Icon {...props}><path d="m6 9 6 6 6-6"/></Icon>;
export const PanelLeftCloseIcon = (props: Props) => <Icon {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M16 9l-3 3 3 3"/></Icon>;
export const PanelLeftOpenIcon = (props: Props) => <Icon {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M12 9l3 3-3 3"/></Icon>;
