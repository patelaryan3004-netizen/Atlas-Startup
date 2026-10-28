// The small drawings the map's chrome uses, one stroke weight, in the colour of the text around them. They are decoration: each is hidden from a
// screen reader, and whatever it sits in carries the words.
const base = { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' };
const icon = (children, extra = {}) => function Icon({ size = 20, ...rest }) {
  return <svg {...base} {...extra} width={size} height={size} {...rest}>{children}</svg>;
};

// Australia's outline, the mainland and Tasmania, for the brand mark: the same coast the landing page draws in dots (landing/australia.js),
// projected into a 24 by 24 box and thinned to a point every half unit.
export const AustraliaMark = icon(
  <path d="M16.9 2.1L17.4 3.5L18.4 5L19 6.7L20.2 7.9L21.2 9.1L22.2 10.6L22.8 12.6L22.6 13.9L22.1 15.3L21.3 16.8L20.9 18.2L19.5 18.5L18 18.7L16.9 18.7L15.4 18L14.6 16.4L14.3 16.1L14.3 15.2L13.5 16.3L12.4 15.4L10.8 14.6L8.1 15.1L5.9 16L3.7 16.7L2.3 16.3L2.6 14.9L2 13L1.2 11.4L1.4 9.8L3.1 8.1L5.4 7.3L6.4 5.6L7.6 4.7L9 4.4L9.6 4.5L10.7 3.1L11.8 2.9L13.1 2.7L13.9 3.1L13.1 4.7L15.3 6.4L16.4 4.7L16.7 2.6zM18 20.1L20 20.2L19.2 21.9L18.1 20.6z" />,
  { viewBox: '0 0 24 24', strokeWidth: 1.3 },
);
export const PinIcon = icon(<><path d="M12 21s-6.5-5.6-6.5-10.8a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.3" /></>);
export const SearchIcon = icon(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.2 4.2" /></>);
export const SlidersIcon = icon(<><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>);
export const ChevronDown = icon(<path d="m6 9.5 6 6 6-6" />);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />, { strokeWidth: 2 });
export const MapIcon = icon(<path d="M9 5 3.5 7v12L9 17l6 2 5.5-2V5L15 7zM9 5v12M15 7v12" />);
export const ListIcon = icon(<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" />, { strokeWidth: 2 });
export const BookmarkIcon = icon(<path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V5.5a1 1 0 0 1 1-1z" />);
export const ArrowRight = icon(<path d="M4 12h15M13 6l6 6-6 6" />);
export const LinkIcon = icon(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />);
export const NavigateIcon =icon(<path d="M3.5 11 20.5 3.5 13 20.5l-2-7.5z" />);
export const ArrowUpRight =icon(<path d="M7 17 17 7M8 7h9v9" />, { strokeWidth: 1.6 });
export const MoreIcon = icon(<path d="M5 12h.01M12 12h.01M19 12h.01" />, { strokeWidth: 3 });
export const CloseIcon = icon(<path d="m6 6 12 12M18 6 6 18" />);
export const CheckIcon = icon(<path d="m5 12.5 4.5 4.5L19 7.5" />, { strokeWidth: 2 });
export const GridIcon = icon(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>);
export const TableIcon = icon(<><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14" /></>);
export const ChevronRight = icon(<path d="m9.5 6 6 6-6 6" />);
export const ExternalIcon = icon(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />);
export const SunIcon = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></>);
export const MoonIcon = icon(<path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />);
export const ChevronLeft = icon(<path d="m14.5 6-6 6 6 6" />);
export const GlobeIcon = icon(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z" /></>);

// The community's: home, discover, opportunities (the three places), and what a post and a profile need.
export const HomeIcon = icon(<path d="M4 11.2 12 4l8 7.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />);
export const CompassIcon = icon(<><circle cx="12" cy="12" r="8.5" /><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z" /></>);
export const BriefcaseIcon = icon(<><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" /></>);
export const CalendarIcon = icon(<><rect x="3.5" y="5.5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3.5v4M16 3.5v4" /></>);
export const UserIcon = icon(<><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20c.6-3.6 3.4-5.6 7-5.6s6.4 2 7 5.6" /></>);
export const HeartIcon = icon(<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z" />);
export const ChatIcon = icon(<path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3.5V16.5h0a2 2 0 0 1-2-2z" />);
export const FlagIcon = icon(<path d="M5.5 20.5V4.5M5.5 5h11l-2 3.5 2 3.5h-11" />);
export const PencilIcon = icon(<path d="M4.5 19.5 5.3 15 15.8 4.5a1.8 1.8 0 0 1 2.5 0l1.2 1.2a1.8 1.8 0 0 1 0 2.5L9 18.7z" />);
export const TrashIcon = icon(<path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12.5h8.4L17 7M10.5 10.5v6M13.5 10.5v6" />);
