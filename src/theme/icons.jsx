// ─────────────────────────────────────────────
//  ICON SYSTEM — pengganti emoji dengan vector icon (lucide-react)
// ─────────────────────────────────────────────
// Kenapa diganti dari emoji? Emoji dirender pakai font emoji bawaan
// OS/browser (beda-beda tiap platform: Windows, Android WebView, dst),
// sehingga tampilannya bisa jadi kotak-kotak/monokrom kasar di sistem
// tertentu. Icon vector di bawah ini konsisten di semua platform, bisa
// diberi warna sesuai brand (lihat theme/tokens.js), dan diberi ukuran
// presisi — sehingga UI terlihat lebih halus & modern (bukan gaya
// "Windows XP jadul").
//
// Cara pakai:
//   import { Icon } from "../theme/icons";
//   <Icon.save size={16} strokeWidth={2} />
//
import {
  Menu, Ban, CheckCircle2, Database, Save, FolderOpen, Link2, Cloud, Zap,
  Trash2, Wallet, ArrowLeft, XCircle, LogOut, Download, X, ArrowRight, Eye,
  Wrench, Lock, AlertOctagon, Settings, AlertTriangle, Crown, Package,
  Circle, RefreshCw, Calendar, WifiOff, Pencil, CheckSquare, Image, Globe,
  Upload, ArrowUp, BarChart3, FileText, Check, ClipboardList, MapPin,
  TrendingUp, FlaskConical, Route, Store, Files, User, Pin, Banknote,
  ChevronDown, ChevronUp, CalendarDays, TrendingDown, Handshake,
  CircleDollarSign, Shuffle, Tag, Search, RotateCw, Stethoscope, ArrowDown,
  Plus, PartyPopper, NotebookPen, Minus, Lightbulb, Map, ArrowLeftRight,
  Gift, Medal, Trophy, Award, Flame, Inbox, Eraser, Siren, Leaf, Rocket,
  DoorOpen, LayoutDashboard, Users, Palette, ShieldAlert, SkipForward, Undo2, Sparkles,
  Hourglass,
} from "lucide-react";

export const Icon = {
  // navigasi / tab utama
  dashboard: LayoutDashboard,
  wilayah: MapPin,
  rute: Route,
  toko: Store,
  produk: FlaskConical,
  kontrol: ClipboardList,
  rekap: BarChart3,
  bagihasil: Handshake,
  pengguna: Users,

  // status & feedback
  check: Check,
  checkCircle: CheckCircle2,
  checkSquare: CheckSquare,
  close: X,
  closeCircle: XCircle,
  warning: AlertTriangle,
  danger: AlertOctagon,
  ban: Ban,
  siren: Siren,
  hourglass: Hourglass,

  // aksi umum
  save: Save,
  edit: Pencil,
  delete: Trash2,
  add: Plus,
  remove: Minus,
  refresh: RefreshCw,
  repeat: RotateCw,
  search: Search,
  shuffle: Shuffle,
  eraser: Eraser,

  // file & data
  folder: FolderOpen,
  file: FileText,
  files: Files,
  archive: Database,
  image: Image,
  download: Download,
  upload: Upload,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  link: Link2,

  // arah / navigasi
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  arrowLeftRight: ArrowLeftRight,
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
  menu: Menu,

  // uang / bisnis
  wallet: Wallet,
  money: CircleDollarSign,
  banknote: Banknote,
  trendingUp: TrendingUp,
  trendingDown: TrendingDown,
  gift: Gift,
  tag: Tag,

  // status koneksi & sistem
  cloud: Cloud,
  wifiOff: WifiOff,
  zap: Zap,
  lock: Lock,
  settings: Settings,
  wrench: Wrench,
  logout: DoorOpen,
  eye: Eye,
  bomb: AlertOctagon,
  globe: Globe,
  calendar: Calendar,
  calendarDays: CalendarDays,
  pin: Pin,

  // orang / peran
  user: User,
  users: Users,
  crown: Crown,
  shield: ShieldAlert,

  // ranking / apresiasi
  trophy: Trophy,
  medal: Medal,
  award: Award,
  flame: Flame,
  party: PartyPopper,
  inbox: Inbox,
  package: Package,
  note: NotebookPen,
  idea: Lightbulb,
  map: Map,
  stethoscope: Stethoscope,
  leaf: Leaf,
  rocket: Rocket,
  palette: Palette,
  dot: Circle,
  skip: SkipForward,
  undo: Undo2,
  new: Sparkles,
};

// Titik status kecil berwarna (pengganti 🟢🟡🔴🟠🔵⚪)
// Dipakai untuk indikator online/offline, status catatan, dsb.
export function StatusDot({ color = "#9CA3AF", size = 8, style, ...rest }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    />
  );
}
